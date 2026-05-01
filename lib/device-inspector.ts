
// ─── Audio output / source device inspector ───────────────────────────────────
// Provides: enumeration of output devices, label-based categorisation
// (DAC / Bluetooth / HDMI / built-in), audio file metadata via decodeAudioData,
// codec inference, and bit-perfect comparison.

export interface OutputDevice {
  deviceId: string;
  label: string;
  groupId: string;
  category: DeviceCategory;
  isHiFiCapable: boolean;
}

export type DeviceCategory =
  | 'usb-dac'
  | 'usb-audio'
  | 'bluetooth'
  | 'hdmi'
  | 'optical'
  | 'headphone'
  | 'speaker'
  | 'builtin'
  | 'unknown';

// ─── Permission & IDB Caching ──────────────────────────────────────────────────

export async function probePermissionState(): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as any });
    return status.state;
  } catch {
    return 'unknown';
  }
}

const DB_NAME = 'sonic_ai_device_cache';
const STORE_NAME = 'labels';

function openLabelDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadCachedLabels(): Promise<Record<string, string>> {
  if (typeof indexedDB === 'undefined') return {};
  try {
    const db = await openLabelDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      const keysReq = store.getAllKeys();
      
      tx.oncomplete = () => {
        const res: Record<string, string> = {};
        keysReq.result.forEach((k, i) => {
          res[k as string] = req.result[i] as string;
        });
        resolve(res);
      };
    });
  } catch {
    return {};
  }
}

export async function saveLabelCache(deviceId: string, label: string): Promise<void> {
  if (typeof indexedDB === 'undefined' || !deviceId || !label) return;
  try {
    const db = await openLabelDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(label, deviceId);
      tx.oncomplete = () => resolve();
    });
  } catch {}
}

export function startDeviceChangeObserver(onChanged: () => void) {
  if (typeof navigator === 'undefined') return;
  navigator.mediaDevices?.addEventListener('devicechange', async () => {
    const state = await probePermissionState();
    if (state === 'granted') {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        for (const d of all) {
          if (d.deviceId && d.label && d.label !== 'Unknown device') {
            await saveLabelCache(d.deviceId, d.label);
          }
        }
      } catch {}
    }
    onChanged();
  });
}

export interface SourceMetadata {
  url: string;
  codec: string;             // 'flac', 'wav', 'mp3', 'aac', 'opus', 'ogg', 'unknown'
  isLossless: boolean;
  isHiRes: boolean;          // sampleRate > 48 kHz OR known hi-res container
  sampleRate?: number;       // Hz
  channels?: number;
  duration?: number;         // seconds
  bytes?: number;
  inferredBitDepth?: number; // best-effort guess
  decodeError?: string;
}

// ─── Codec inference from URL/extension ───────────────────────────────────────

const LOSSLESS_EXT = /\.(flac|alac|wav|aiff?|aif|wv|ape|dsf|dff|m4a)$/i;
const LOSSY_EXT    = /\.(mp3|ogg|opus|aac|m4a|webm|weba)$/i;
const HIRES_EXT    = /\.(flac|alac|wav|aiff?|dsf|dff|wv)$/i;

const CODEC_MAP: Record<string, string> = {
  flac: 'FLAC',
  alac: 'ALAC',
  wav:  'WAV',
  aiff: 'AIFF',
  aif:  'AIFF',
  wv:   'WavPack',
  ape:  'Monkey’s Audio',
  dsf:  'DSD (DSF)',
  dff:  'DSD (DFF)',
  mp3:  'MP3',
  ogg:  'Vorbis',
  opus: 'Opus',
  aac:  'AAC',
  m4a:  'AAC / ALAC',
  webm: 'WebM (Opus)',
  weba: 'WebM (Opus)',
};

export function inferCodecFromUrl(url: string): string {
  const cleanPath = url.split('?')[0].split('#')[0].toLowerCase();
  const m = cleanPath.match(/\.([a-z0-9]{2,5})$/);
  if (!m) return 'unknown';
  return CODEC_MAP[m[1]] ?? m[1].toUpperCase();
}

export function isLosslessUrl(url: string): boolean {
  return LOSSLESS_EXT.test(url.split('?')[0].split('#')[0]);
}

export function isHiResContainer(url: string): boolean {
  return HIRES_EXT.test(url.split('?')[0].split('#')[0]);
}

// ─── Source metadata via Web Audio decodeAudioData ────────────────────────────
// Best for short files / cached streams; for very large files we still get a
// sampleRate + channel count cheaply because decodeAudioData fully decodes.
// For huge files we fall back to URL-only inference.

const SOURCE_META_CACHE = new Map<string, SourceMetadata>();
const MAX_DECODE_BYTES = 50 * 1024 * 1024; // 50 MB safety cap

export async function fetchSourceMetadata(
  url: string,
  ctx: AudioContext | null,
): Promise<SourceMetadata> {
  if (SOURCE_META_CACHE.has(url)) return SOURCE_META_CACHE.get(url)!;

  const codec = inferCodecFromUrl(url);
  const lossless = isLosslessUrl(url);

  const result: SourceMetadata = {
    url,
    codec,
    isLossless: lossless,
    isHiRes: false,
  };

  // blob: URLs (file picker) don't expose Content-Length; just decode them.
  // remote URLs: HEAD first to bail on huge files.
  let contentLength = 0;
  if (!url.startsWith('blob:')) {
    try {
      const head = await fetch(url, { method: 'HEAD' });
      const cl = head.headers.get('content-length');
      if (cl) {
        contentLength = parseInt(cl, 10);
        result.bytes = contentLength;
      }
    } catch { /* CORS or offline — ignore */ }
  }

  if (contentLength > 0 && contentLength > MAX_DECODE_BYTES) {
    SOURCE_META_CACHE.set(url, result);
    return result;
  }

  if (!ctx) {
    SOURCE_META_CACHE.set(url, result);
    return result;
  }

  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    if (!result.bytes) result.bytes = buf.byteLength;
    // decodeAudioData can be slow but reliably yields SR + channel count.
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    result.sampleRate = decoded.sampleRate;
    result.channels = decoded.numberOfChannels;
    result.duration = decoded.duration;
    result.isHiRes = lossless && (decoded.sampleRate > 48000 || isHiResContainer(url));
    result.inferredBitDepth = lossless
      ? (decoded.sampleRate >= 88200 ? 24 : 16)
      : undefined;
  } catch (err: any) {
    result.decodeError = err?.message ?? String(err);
  }

  SOURCE_META_CACHE.set(url, result);
  return result;
}

// ─── Output device enumeration & categorisation ───────────────────────────────

const DEVICE_PATTERNS: { rx: RegExp; cat: DeviceCategory; hifi: boolean }[] = [
  { rx: /\b(scarlett|focusrite|motu|rme|apogee|prism|topping|smsl|fiio|ifi|chord|schiit|audient|presonus|ssl|antelope|babyface|rolland|roland)\b/i, cat: 'usb-dac', hifi: true },
  { rx: /\b(dac|hi-?res|hi-?fi|asio|audio interface|audiointerface)\b/i, cat: 'usb-dac', hifi: true },
  { rx: /\b(usb audio|usb-audio|usb headset|class[\- ]?compliant)\b/i, cat: 'usb-audio', hifi: true },
  { rx: /\b(bluetooth|airpods|beats|sony wh|bose qc|jabra|galaxy buds|pixel buds|wireless earbuds|wireless headphones)\b/i, cat: 'bluetooth', hifi: false },
  { rx: /\b(hdmi|displayport|dp audio)\b/i, cat: 'hdmi', hifi: true },
  { rx: /\b(optical|toslink|s\/?pdif|spdif)\b/i, cat: 'optical', hifi: true },
  { rx: /\b(headphone|headphones|earphone|earbud|3\.5\s?mm)\b/i, cat: 'headphone', hifi: false },
  { rx: /\b(speaker|speakers|monitor|krk|genelec|adam audio|yamaha hs)\b/i, cat: 'speaker', hifi: false },
  { rx: /\b(internal|built[- ]?in|macbook|laptop|realtek|conexant|cirrus)\b/i, cat: 'builtin', hifi: false },
];

export function categorizeDevice(label: string): { category: DeviceCategory; isHiFiCapable: boolean } {
  if (!label) return { category: 'unknown', isHiFiCapable: false };
  for (const { rx, cat, hifi } of DEVICE_PATTERNS) {
    if (rx.test(label)) return { category: cat, isHiFiCapable: hifi };
  }
  return { category: 'unknown', isHiFiCapable: false };
}

export const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  'usb-dac':    'USB DAC',
  'usb-audio':  'USB Audio',
  'bluetooth':  'Bluetooth',
  'hdmi':       'HDMI',
  'optical':    'Optical',
  'headphone':  'Headphones',
  'speaker':    'Speakers',
  'builtin':    'Built-in',
  'unknown':    'Output',
};

export const CATEGORY_ICONS: Record<DeviceCategory, string> = {
  'usb-dac':    '◆',
  'usb-audio':  '◇',
  'bluetooth':  '✦',
  'hdmi':       '▭',
  'optical':    '○',
  'headphone':  '◐',
  'speaker':    '◭',
  'builtin':    '▣',
  'unknown':    '·',
};

export async function listOutputDevices(): Promise<OutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const [all, cached] = await Promise.all([
      navigator.mediaDevices.enumerateDevices(),
      loadCachedLabels(),
    ]);
    
    for (const d of all) {
      if (d.deviceId && d.label && d.label !== 'Unknown output device' && d.label !== 'Unknown device') {
        saveLabelCache(d.deviceId, d.label).catch(() => {});
      }
    }

    return all
      .filter((d) => d.kind === 'audiooutput')
      .map((d) => {
        const finalLabel = d.label || cached[d.deviceId] || 'Unknown output device';
        const { category, isHiFiCapable } = categorizeDevice(finalLabel);
        return {
          deviceId: d.deviceId,
          label: finalLabel,
          groupId: d.groupId,
          category,
          isHiFiCapable,
        };
      });
  } catch {
    return [];
  }
}

/** Force Chrome/Edge/Firefox to expose device labels by briefly opening a mic stream. */
export async function requestPermissionForLabels(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

// ─── Output device routing on AudioContext (Chrome 110+) ──────────────────────

interface SetSinkIdContext extends AudioContext {
  setSinkId?: (sinkId: string) => Promise<void>;
}

export function isSetSinkIdSupported(ctx: AudioContext | null): boolean {
  if (!ctx) return false;
  return typeof (ctx as SetSinkIdContext).setSinkId === 'function';
}

export async function setOutputSink(ctx: AudioContext, deviceId: string): Promise<boolean> {
  const c = ctx as SetSinkIdContext;
  if (!c.setSinkId) return false;
  try {
    await c.setSinkId(deviceId);
    return true;
  } catch (err) {
    console.warn('setSinkId failed:', err);
    return false;
  }
}

// ─── Bit-perfect comparison ───────────────────────────────────────────────────

export interface BitPerfectStatus {
  /** true when no sample-rate conversion will occur in Web Audio. */
  bitPerfect: boolean;
  /** Source rate (file). */
  sourceRate?: number;
  /** AudioContext output rate (engine). */
  contextRate: number;
  /** Hint for the user — what would need to change to be bit-perfect. */
  message: string;
}

export function checkBitPerfect(
  sourceRate: number | undefined,
  contextRate: number,
): BitPerfectStatus {
  if (!sourceRate) {
    return {
      bitPerfect: false,
      contextRate,
      message: 'Source rate unknown — cannot verify bit-perfect.',
    };
  }
  if (sourceRate === contextRate) {
    return {
      bitPerfect: true,
      sourceRate,
      contextRate,
      message: `No resampling — source matches output (${sourceRate / 1000} kHz).`,
    };
  }
  const ratio = sourceRate / contextRate;
  return {
    bitPerfect: false,
    sourceRate,
    contextRate,
    message:
      `Web Audio is resampling ${(sourceRate / 1000).toFixed(1)} → ${(contextRate / 1000).toFixed(1)} kHz ` +
      `(${ratio.toFixed(3)}×). Re-init the engine at ${sourceRate / 1000} kHz to remove resampling.`,
  };
}

export function formatRate(hz?: number): string {
  if (!hz) return '—';
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
  return `${hz} Hz`;
}

export function formatBytes(b?: number): string {
  if (!b || b <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

// ─── File-input accept attribute (extended) ───────────────────────────────────

export const AUDIO_ACCEPT_ATTR =
  'audio/*,.flac,.alac,.wav,.aif,.aiff,.wv,.ape,.dsf,.dff,.opus,.ogg,.m4a,.webm';
