
import { EQBand } from './audio-engine';
import { DeviceProfile } from './ai-engine';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SavedProfile {
  id: string;
  name: string;
  description?: string;
  genre?: string;
  color?: string;
  bands: EQBand[];
  preAmp: number;
  createdAt: number;
  updatedAt: number;
  source: 'ai' | 'manual' | 'import';
  contextPreferences?: Record<string, number[]>;
}

export interface SessionSummary {
  W: number[][];           // regression matrix cuối session
  b: number[];             // bias vector
  stability: number;
  timestamp: number;
}

export interface ProfileStore {
  profiles: SavedProfile[];
  deviceProfiles: DeviceProfile[];
  lastActiveId: string | null;
  activeDeviceId: string | null;
  sessionHistory?: SessionSummary[];
}

// ─── Frequency-band naming (used by exports & report) ────────────────────────

export function bandZoneLabel(freq: number): string {
  if (freq < 60)    return 'Sub-Bass';
  if (freq < 250)   return 'Bass';
  if (freq < 500)   return 'Low-Mid';
  if (freq < 2000)  return 'Mid';
  if (freq < 4000)  return 'High-Mid';
  if (freq < 6000)  return 'Presence';
  return 'Air';
}

export function formatFreq(freq: number): string {
  if (freq >= 1000) return `${(freq / 1000).toFixed(freq % 1000 === 0 ? 0 : 1)}k`;
  return `${Math.round(freq)}`;
}

// ─── EqualizerAPO / AutoEq Format Parser ─────────────────────────────────────
// Supports lines like:
//   Filter 1: ON PK Fc 1000 Hz Gain 3.0 dB BW Oct 1.0
//   Filter 2: ON LSC Fc 105 Hz Gain 4.5 dB Q 0.71
//   Filter 3: ON HSC Fc 10000 Hz Gain -2.0 dB Q 0.71
//   Preamp: -6.5 dB

export interface ParseResult {
  bands: EQBand[];
  preAmp: number;
  errors: string[];
}

const APO_FILTER_TYPES: Record<string, BiquadFilterType> = {
  PK:  'peaking',
  LSC: 'lowshelf',
  HSC: 'highshelf',
  NO:  'notch',
  BP:  'bandpass',
  LP:  'lowpass',
  HP:  'highpass',
};

export function parseEqualizerAPO(text: string): ParseResult {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const bands: EQBand[] = [];
  let preAmp = 0;
  const errors: string[] = [];

  for (const line of lines) {
    if (line.startsWith('#') || line.startsWith('//')) continue;

    const preampMatch = line.match(/^Preamp:\s*([-\d.]+)\s*dB/i);
    if (preampMatch) {
      const rawPre = parseFloat(preampMatch[1]);
      preAmp = Math.max(-20, Math.min(20, rawPre));  // SEC-01: clamp preAmp to ±20 dB
      continue;
    }

    const filterMatch = line.match(
      /Filter\s+\d+:\s+ON\s+(\w+)\s+Fc\s+([\d.]+)\s+Hz\s+Gain\s+([-\d.]+)\s+dB(?:\s+(?:Q|BW\s+Oct)\s+([\d.]+))?/i
    );
    if (filterMatch) {
      const [, typeStr, freqStr, gainStr, qStr] = filterMatch;
      const filterType = APO_FILTER_TYPES[typeStr.toUpperCase()];

      if (!filterType) {
        errors.push(`Unknown filter type "${typeStr}" — skipped.`);
        continue;
      }

      let q = qStr ? parseFloat(qStr) : 1.4;
      if (line.match(/BW\s+Oct/i) && qStr) {
        const bw = parseFloat(qStr);
        q = 1 / (2 * Math.sinh((Math.LN2 / 2) * bw));
      }

      const rawGain = parseFloat(gainStr);
      if (Math.abs(rawGain) > 30) {
        errors.push(`Gain ${rawGain} dB on filter ${bands.length + 1} exceeds ±30 dB safety limit — clamped.`);
      }
      bands.push({
        frequency: parseFloat(freqStr),
        gain: Math.max(-30, Math.min(30, rawGain)),  // SEC-01: clamp to ±30 dB
        q: Math.max(0.1, Math.min(10, q)),
        type: filterType,
      });
      continue;
    }
  }

  if (bands.length === 0 && errors.length === 0) {
    errors.push('No valid filter lines found. Check the format.');
  }

  return { bands, preAmp, errors };
}

// ─── Q ↔ Bandwidth(oct) helpers ──────────────────────────────────────────────

export function qToBandwidthOct(q: number): number {
  // Bandwidth in octaves from Q (RBJ cookbook)
  return (2 / Math.LN2) * Math.asinh(1 / (2 * q));
}

// ─── Export: EqualizerAPO (.txt) ─────────────────────────────────────────────

const APO_TYPE_MAP: Partial<Record<BiquadFilterType, string>> = {
  peaking:   'PK',
  lowshelf:  'LSC',
  highshelf: 'HSC',
  notch:     'NO',
  bandpass:  'BP',
  lowpass:   'LP',
  highpass:  'HP',
};

export function exportToEqualizerAPO(profile: SavedProfile): string {
  const lines: string[] = [
    `# SONIC AI — EqualizerAPO Profile`,
    `# Profile : ${profile.name}`,
    `# Source  : ${profile.source}`,
    `# Created : ${new Date(profile.createdAt).toISOString()}`,
    `# Bands   : ${profile.bands.length}`,
    `#`,
    `Preamp: ${profile.preAmp.toFixed(2)} dB`,
    ``,
  ];

  profile.bands.forEach((band, i) => {
    const typeStr = APO_TYPE_MAP[band.type] ?? 'PK';
    lines.push(
      `Filter ${i + 1}: ON ${typeStr} Fc ${Math.round(band.frequency)} Hz ` +
      `Gain ${band.gain.toFixed(2)} dB Q ${band.q.toFixed(3)}`
    );
  });

  return lines.join('\n');
}

// REW filter export
export function exportToREWFilters(profile: SavedProfile, sampleRate = 44100): string {
  const lines = [`# REW Filter Export — ${new Date().toISOString()}`];
  profile.bands.forEach((band, i) => {
    lines.push(`Filter  ${i+1}: ON  PEQ  Fc   ${band.frequency.toFixed(1)} Hz  Gain  ${band.gain.toFixed(1)} dB  Q  ${band.q.toFixed(2)}`);
  });
  return lines.join('\n');
}

// ─── Export: AutoEq Parametric (.txt) ────────────────────────────────────────
// Format used by oratory1990 / AutoEq parametric outputs.

export function exportToAutoEqParametric(profile: SavedProfile): string {
  const lines: string[] = [
    `Preamp: ${profile.preAmp.toFixed(1)} dB`,
  ];
  profile.bands.forEach((band, i) => {
    const typeName =
      band.type === 'lowshelf' ? 'LSC' :
      band.type === 'highshelf' ? 'HSC' :
      'PK';
    lines.push(
      `Filter ${i + 1}: ON ${typeName} Fc ${Math.round(band.frequency)} Hz ` +
      `Gain ${band.gain.toFixed(1)} dB Q ${band.q.toFixed(2)}`
    );
  });
  return lines.join('\n');
}

// ─── Export: Wavelet / Poweramp Pro (.txt) ───────────────────────────────────
// Wavelet (Android) understands the AutoEq parametric layout. We output the
// minimal lines without comments for direct paste-in.

export function exportToWavelet(profile: SavedProfile): string {
  return exportToAutoEqParametric(profile);
}

// ─── Export: CamillaDSP YAML (.yml) ──────────────────────────────────────────
// Generates a minimal pipeline of Biquad filters chained on channel 0 & 1.

export function exportToCamillaDSP(profile: SavedProfile): string {
  const out: string[] = [];
  out.push(`# SONIC AI — CamillaDSP config`);
  out.push(`# Profile: ${profile.name}`);
  out.push(`# Generated: ${new Date(profile.createdAt).toISOString()}`);
  out.push(``);
  out.push(`filters:`);
  out.push(`  Preamp:`);
  out.push(`    type: Gain`);
  out.push(`    parameters:`);
  out.push(`      gain: ${profile.preAmp.toFixed(2)}`);
  out.push(`      inverted: false`);
  out.push(`      mute: false`);
  out.push(``);

  profile.bands.forEach((b, i) => {
    const camillaType =
      b.type === 'lowshelf' ? 'Lowshelf' :
      b.type === 'highshelf' ? 'Highshelf' :
      b.type === 'notch' ? 'Notch' :
      b.type === 'bandpass' ? 'Bandpass' :
      b.type === 'lowpass' ? 'Lowpass' :
      b.type === 'highpass' ? 'Highpass' :
      'Peaking';
    out.push(`  EQ${i + 1}_${camillaType}_${Math.round(b.frequency)}Hz:`);
    out.push(`    type: Biquad`);
    out.push(`    parameters:`);
    out.push(`      type: ${camillaType}`);
    out.push(`      freq: ${Math.round(b.frequency)}`);
    if (camillaType === 'Lowshelf' || camillaType === 'Highshelf') {
      out.push(`      slope: 12`);
      out.push(`      gain: ${b.gain.toFixed(2)}`);
    } else {
      out.push(`      q: ${b.q.toFixed(3)}`);
      out.push(`      gain: ${b.gain.toFixed(2)}`);
    }
    out.push(``);
  });

  out.push(`pipeline:`);
  for (const ch of [0, 1]) {
    out.push(`  - type: Filter`);
    out.push(`    channel: ${ch}`);
    out.push(`    names:`);
    out.push(`      - Preamp`);
    profile.bands.forEach((b, i) => {
      const camillaType =
        b.type === 'lowshelf' ? 'Lowshelf' :
        b.type === 'highshelf' ? 'Highshelf' :
        b.type === 'notch' ? 'Notch' :
        b.type === 'bandpass' ? 'Bandpass' :
        b.type === 'lowpass' ? 'Lowpass' :
        b.type === 'highpass' ? 'Highpass' :
        'Peaking';
      out.push(`      - EQ${i + 1}_${camillaType}_${Math.round(b.frequency)}Hz`);
    });
  }

  return out.join('\n');
}

// ─── Export: CSV ─────────────────────────────────────────────────────────────

export function exportToCSV(profile: SavedProfile): string {
  const rows: string[] = [];
  rows.push(`# Sonic AI EQ Profile — ${profile.name}`);
  rows.push(`# Pre-Amp,${profile.preAmp.toFixed(2)} dB`);
  rows.push(``);
  rows.push(`Band,Zone,Frequency (Hz),Gain (dB),Q,Bandwidth (oct),Type`);
  profile.bands.forEach((b, i) => {
    rows.push(
      `${i + 1},${bandZoneLabel(b.frequency)},${Math.round(b.frequency)},` +
      `${b.gain.toFixed(2)},${b.q.toFixed(3)},${qToBandwidthOct(b.q).toFixed(3)},${b.type}`
    );
  });
  return rows.join('\n');
}

// ─── Export: Sonic AI native JSON (full fidelity) ────────────────────────────

export interface SonicAIExport {
  format: 'sonic-ai-eq';
  formatVersion: 2;
  generator: { name: 'Sonic AI'; version: string };
  exportedAt: string;
  profile: {
    id: string;
    name: string;
    description?: string;
    genre?: string;
    color?: string;
    source: SavedProfile['source'];
    createdAt: string;
    updatedAt: string;
  };
  preAmp: number;
  bands: Array<{
    index: number;
    frequency: number;
    gain: number;
    q: number;
    bandwidthOct: number;
    type: BiquadFilterType;
    zone: string;
  }>;
}

export function buildSonicAIExport(profile: SavedProfile): SonicAIExport {
  return {
    format: 'sonic-ai-eq',
    formatVersion: 2,
    generator: { name: 'Sonic AI', version: '1.0' },
    exportedAt: new Date().toISOString(),
    profile: {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      genre: profile.genre,
      color: profile.color,
      source: profile.source,
      createdAt: new Date(profile.createdAt).toISOString(),
      updatedAt: new Date(profile.updatedAt).toISOString(),
    },
    preAmp: profile.preAmp,
    bands: profile.bands.map((b, i) => ({
      index: i + 1,
      frequency: b.frequency,
      gain: b.gain,
      q: b.q,
      bandwidthOct: qToBandwidthOct(b.q),
      type: b.type,
      zone: bandZoneLabel(b.frequency),
    })),
  };
}

export function exportToSonicJSON(profile: SavedProfile): string {
  return JSON.stringify(buildSonicAIExport(profile), null, 2);
}

// ─── Export: Markdown report (human-readable) ────────────────────────────────

export function exportToMarkdown(profile: SavedProfile): string {
  const md: string[] = [];
  md.push(`# ${profile.name}`);
  md.push(``);
  md.push(`> Sonic AI parametric EQ profile`);
  md.push(``);
  md.push(`| Property | Value |`);
  md.push(`| --- | --- |`);
  md.push(`| Source   | ${profile.source} |`);
  if (profile.genre) md.push(`| Genre    | ${profile.genre} |`);
  md.push(`| Bands    | ${profile.bands.length} |`);
  md.push(`| Pre-Amp  | **${profile.preAmp.toFixed(2)} dB** |`);
  md.push(`| Created  | ${new Date(profile.createdAt).toLocaleString()} |`);
  if (profile.description) {
    md.push(``);
    md.push(`${profile.description}`);
  }
  md.push(``);
  md.push(`## Bands`);
  md.push(``);
  md.push(`| # | Zone | Freq | Gain | Q | BW (oct) | Type |`);
  md.push(`| - | ---- | ---- | ---- | - | -------- | ---- |`);
  profile.bands.forEach((b, i) => {
    md.push(
      `| ${i + 1} | ${bandZoneLabel(b.frequency)} | ${formatFreq(b.frequency)}Hz | ` +
      `${b.gain >= 0 ? '+' : ''}${b.gain.toFixed(2)} dB | ${b.q.toFixed(2)} | ` +
      `${qToBandwidthOct(b.q).toFixed(2)} | ${b.type} |`
    );
  });
  md.push(``);
  md.push(`*Generated by Sonic AI · ${new Date().toISOString()}*`);
  return md.join('\n');
}

// ─── Export format registry (used by the ExportDialog) ───────────────────────

export type ExportFormatId =
  | 'sonic-json'
  | 'apo'
  | 'autoeq'
  | 'wavelet'
  | 'camilla'
  | 'csv'
  | 'markdown'
  | 'rew';

export interface ExportFormatDef {
  id: ExportFormatId;
  label: string;
  extension: string;
  mime: string;
  description: string;
  build: (p: SavedProfile) => string;
}

export const EXPORT_FORMATS: ExportFormatDef[] = [
  {
    id: 'sonic-json',
    label: 'Sonic AI JSON',
    extension: 'json',
    mime: 'application/json',
    description: 'Full fidelity. Q, type, zone, bandwidth — re-importable into Sonic AI.',
    build: exportToSonicJSON,
  },
  {
    id: 'rew',
    label: 'REW Filter Output',
    extension: 'txt',
    mime: 'text/plain',
    description: 'Room EQ Wizard filter text output.',
    build: exportToREWFilters,
  },
  {
    id: 'apo',
    label: 'Equalizer APO',
    extension: 'txt',
    mime: 'text/plain',
    description: 'Windows EqualizerAPO / Peace GUI. Drop into config.txt.',
    build: exportToEqualizerAPO,
  },
  {
    id: 'autoeq',
    label: 'AutoEq Parametric',
    extension: 'txt',
    mime: 'text/plain',
    description: 'oratory1990 / AutoEq style. Roon, EAPO, etc.',
    build: exportToAutoEqParametric,
  },
  {
    id: 'wavelet',
    label: 'Wavelet / Poweramp',
    extension: 'txt',
    mime: 'text/plain',
    description: 'Android Wavelet & Poweramp Pro EQ — parametric paste.',
    build: exportToWavelet,
  },
  {
    id: 'camilla',
    label: 'CamillaDSP YAML',
    extension: 'yml',
    mime: 'text/yaml',
    description: 'Linux / Raspberry Pi DSP. Full pipeline with stereo channels.',
    build: exportToCamillaDSP,
  },
  {
    id: 'csv',
    label: 'CSV (Spreadsheet)',
    extension: 'csv',
    mime: 'text/csv',
    description: 'Open in Excel / Numbers / Sheets for analysis.',
    build: exportToCSV,
  },
  {
    id: 'markdown',
    label: 'Markdown Report',
    extension: 'md',
    mime: 'text/markdown',
    description: 'Human-readable summary. Great for sharing on forums.',
    build: exportToMarkdown,
  },
];

// ─── Build a SavedProfile-shape from the live editor state ───────────────────
// Lets the Export dialog work on the *current* (un-saved) EQ.

export function buildLiveProfile(
  bands: EQBand[],
  preAmp: number,
  opts?: { name?: string; genre?: string; color?: string; source?: SavedProfile['source'] }
): SavedProfile {
  const now = Date.now();
  return {
    id: `live_${now}`,
    name: opts?.name?.trim() || 'Sonic AI Live EQ',
    genre: opts?.genre,
    color: opts?.color ?? '#F27D26',
    bands: bands.map((b) => ({ ...b })),
    preAmp,
    createdAt: now,
    updatedAt: now,
    source: opts?.source ?? 'manual',
  };
}

// ─── Helpers: trigger a download from a string ───────────────────────────────

export function downloadString(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadProfile(profile: SavedProfile, formatId: ExportFormatId): void {
  const fmt = EXPORT_FORMATS.find((f) => f.id === formatId);
  if (!fmt) return;
  const content = fmt.build(profile);
  const safeName = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  downloadString(`sonic-${safeName}.${fmt.extension}`, content, fmt.mime);
}

// ─── localStorage CRUD ────────────────────────────────────────────────────────

const STORE_KEY = 'sonic_profiles';
const CURRENT_BANDS_KEY = 'sonic_current_bands';
const CURRENT_PREAMP_KEY = 'sonic_current_preamp';
const LEARNER_STATE_KEY = 'sonic_learner_state';

function loadStore(): ProfileStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        profiles: parsed.profiles || [],
        deviceProfiles: parsed.deviceProfiles || [],
        lastActiveId: parsed.lastActiveId || null,
        activeDeviceId: parsed.activeDeviceId || null,
        sessionHistory: parsed.sessionHistory || [],
      };
    }
  } catch {}
  return { profiles: [], deviceProfiles: [], lastActiveId: null, activeDeviceId: null, sessionHistory: [] };
}

function saveStore(store: ProfileStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('ProfileStore: localStorage write failed', e);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getAllProfiles(): SavedProfile[] {
  return loadStore().profiles.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveProfile(
  name: string,
  bands: EQBand[],
  preAmp: number,
  opts?: { 
    description?: string; 
    genre?: string; 
    color?: string; 
    source?: SavedProfile['source'];
    contextPreferences?: Record<string, number[]>;
  }
): SavedProfile {
  const store = loadStore();
  const now = Date.now();
  const profile: SavedProfile = {
    id: `profile_${now}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    description: opts?.description,
    genre: opts?.genre,
    color: opts?.color,
    bands: bands.map((b) => ({ ...b })),
    preAmp,
    createdAt: now,
    updatedAt: now,
    source: opts?.source ?? 'manual',
    contextPreferences: opts?.contextPreferences,
  };
  store.profiles.unshift(profile);
  store.lastActiveId = profile.id;
  saveStore(store);
  return profile;
}

export function updateProfile(id: string, updates: Partial<Pick<SavedProfile, 'name' | 'bands' | 'preAmp' | 'description'>>): boolean {
  const store = loadStore();
  const idx = store.profiles.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  store.profiles[idx] = { ...store.profiles[idx], ...updates, updatedAt: Date.now() };
  saveStore(store);
  return true;
}

export function deleteProfile(id: string): boolean {
  const store = loadStore();
  const before = store.profiles.length;
  store.profiles = store.profiles.filter((p) => p.id !== id);
  if (store.lastActiveId === id) store.lastActiveId = store.profiles[0]?.id ?? null;
  saveStore(store);
  return store.profiles.length < before;
}

export function getProfile(id: string): SavedProfile | undefined {
  return loadStore().profiles.find((p) => p.id === id);
}

// ─── Device Profiles ──────────────────────────────────────────────────────────

export function saveDeviceProfile(name: string, deviations: number[]): DeviceProfile {
  const store = loadStore();
  const device: DeviceProfile = {
    id: `device_${Date.now()}`,
    name,
    deviations: [...deviations],
    timestamp: Date.now(),
  };
  store.deviceProfiles.unshift(device);
  store.activeDeviceId = device.id;
  saveStore(store);
  return device;
}

export function getDeviceProfiles(): DeviceProfile[] {
  return loadStore().deviceProfiles;
}

export function getActiveDevice(): DeviceProfile | undefined {
  const store = loadStore();
  return store.deviceProfiles.find(d => d.id === store.activeDeviceId);
}

export function setActiveDevice(id: string | null): void {
  const store = loadStore();
  store.activeDeviceId = id;
  saveStore(store);
}

export function deleteDeviceProfile(id: string): void {
  const store = loadStore();
  store.deviceProfiles = store.deviceProfiles.filter(d => d.id !== id);
  if (store.activeDeviceId === id) store.activeDeviceId = null;
  saveStore(store);
}

// ─── Current session persistence (auto-save current EQ state) ────────────────

export function persistCurrentState(bands: EQBand[], preAmp: number): void {
  try {
    localStorage.setItem(CURRENT_BANDS_KEY, JSON.stringify(bands));
    localStorage.setItem(CURRENT_PREAMP_KEY, String(preAmp));
  } catch {}
}

export function loadCurrentState(): { bands: EQBand[] | null; preAmp: number } {
  try {
    const bandsRaw = localStorage.getItem(CURRENT_BANDS_KEY);
    const preAmpRaw = localStorage.getItem(CURRENT_PREAMP_KEY);
    return {
      bands: bandsRaw ? JSON.parse(bandsRaw) : null,
      preAmp: preAmpRaw ? parseFloat(preAmpRaw) : 0,
    };
  } catch {
    return { bands: null, preAmp: 0 };
  }
}

export function clearCurrentState(): void {
  try {
    localStorage.removeItem(CURRENT_BANDS_KEY);
    localStorage.removeItem(CURRENT_PREAMP_KEY);
  } catch {}
}

/** 
 * Invalidate session state for a specific source.
 * If source is 'ai', it clears the learner state forcing a re-tune.
 */
export function invalidateProfileSource(source: 'ai' | 'manual'): void {
  try {
    if (source === 'ai') {
      localStorage.removeItem(LEARNER_STATE_KEY);
    }
  } catch {}
}

export function persistLearnerState(state: any): void {
  try {
    localStorage.setItem(LEARNER_STATE_KEY, JSON.stringify(state));
  } catch {}
}

/**
 * Tầng 3: Record session summary to history for future priors.
 */
export function recordSessionSummary(state: any): void {
  const store = loadStore();
  if (!store.sessionHistory) store.sessionHistory = [];

  const summary: SessionSummary = {
    W: state.W,
    b: state.b,
    stability: state.stability,
    timestamp: Date.now(),
  };

  // Keep last 10 sessions
  store.sessionHistory.unshift(summary);
  store.sessionHistory = store.sessionHistory.slice(0, 10);
  saveStore(store);
}

/**
 * Tầng 3: Aggregate Bayesian Prior from history using time-decay.
 */
export function aggregateBayesianPrior(): { W: number[][]; b: number[] } | null {
  const store = loadStore();
  const history = store.sessionHistory || [];
  if (history.length === 0) return null;

  const NUM_BANDS = 10;
  const NUM_DIMS = 8;
  const DECAY_CONSTANT = 1 / (7 * 24 * 60 * 60 * 1000); // 1 week half-life approx

  let totalWeight = 0;
  const aggregatedW = Array.from({ length: NUM_BANDS }, () => new Array(NUM_DIMS).fill(0));
  const aggregatedB = new Array(NUM_BANDS).fill(0);

  const now = Date.now();

  history.forEach(session => {
    // Time decay: w_i = exp(-λ * daysSince)
    const age = now - session.timestamp;
    const weight = Math.exp(-DECAY_CONSTANT * age) * session.stability;
    totalWeight += weight;

    if (session.W) {
      for (let i = 0; i < NUM_BANDS; i++) {
        for (let d = 0; d < NUM_DIMS; d++) {
          aggregatedW[i][d] += (session.W[i]?.[d] || 0) * weight;
        }
      }
    }
    if (session.b) {
      for (let i = 0; i < NUM_BANDS; i++) {
        aggregatedB[i] += (session.b[i] || 0) * weight;
      }
    }
  });

  if (totalWeight < 0.1) return null;

  // Normalize
  for (let i = 0; i < NUM_BANDS; i++) {
    for (let d = 0; d < NUM_DIMS; d++) {
      aggregatedW[i][d] /= totalWeight;
    }
    aggregatedB[i] /= totalWeight;
  }

  return { W: aggregatedW, b: aggregatedB };
}

export function loadLearnerState(): any | null {
  try {
    const raw = localStorage.getItem(LEARNER_STATE_KEY);
    if (raw) return JSON.parse(raw);
    
    // Cold start: try to aggregate from history
    const prior = aggregateBayesianPrior();
    if (prior) {
      return {
        globalPreference: new Array(10).fill(0),
        W: prior.W,
        b: prior.b,
        uncertainty: new Array(10).fill(0.7), // Start with some confidence from history
        stability: 0.3,
        interactionCount: 0,
        contextPreferences: {}
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Legacy convenience exporters (kept for backward compatibility) ──────────

export function exportProfileAsJSON(profile: SavedProfile): void {
  downloadProfile(profile, 'sonic-json');
}

export function exportProfileAsAPO(profile: SavedProfile): void {
  downloadProfile(profile, 'apo');
}
