
import { webUSB } from './webusb-audio';
import { TemporalDynamicsModel, EQProfileMorphing } from './audio-engine-improvements';

import {
  spectralFlatnessFromDb,
  crestFactorDb,
  findPeaksParabolic,
  parabolicInterpolate,
  binToHz,
  fftInPlace,
  PeakInfo,
  magnitudeCorrectionDb,
  filterHarmonicPeaks,
  integratedLufs,
  tonalityFromBandFlatness,
  coherence,
} from './math';

export interface EQBand {
  frequency: number;
  type: BiquadFilterType;
  gain: number;
  q: number;
  // Dynamic EQ params
  dynEnabled?: boolean;
  threshold?: number; // dBFS
  ratio?: number;     // e.g. 2:1
  attack?: number;    // ms
  release?: number;   // ms
  range?: number;     // max dB adjust
}

// ─── Enhancement Parameters ────────────────────────────────────────────────
export interface EnhancementParams {
  // Harmonic Exciter: adds subtle even-order harmonics for perceived clarity/air
  exciterAmount: number;    // 0–1, default 0.18
  exciterFreq: number;      // HPF cutoff for exciter (Hz), default 2800

  // Stereo Widener (M/S processing): expands stereo image without mono issues
  stereoWidth: number;      // 0–2 (1 = original, 0 = mono, 2 = full wide), default 1.0

  // Soft Clipper / Limiter: transparent brick-wall ceiling, NO pumping
  // Replaces the destructive DynamicsCompressor in lossless mode
  softClipEnabled: boolean; // default true (lossless-friendly)
  outputCeiling: number;    // dBFS, default -0.3

  // Bass Harmonic Synthesis: generates 2nd harmonic of sub frequencies
  // Makes bass feel fuller on small speakers without adding mud
  bassEnhance: number;      // 0–1, default 0
  bassEnhanceFreq: number;  // fundamental cutoff (Hz), default 80

  // Transient Shaper: attack/sustain envelope (non-destructive)
  transientAttack: number;  // −6 to +6 dB punch, default 0
  transientSustain: number; // −6 to +6 dB sustain, default 0

  // Headphone Crossfeed: reduces stereo fatigue on headphones by simulating speakers
  crossFeed: number;        // 0–1, default 0

  // Dynamic EQ Global Master
  dynamicEqMaster: boolean; // default false

  // Ultra-High Precision Mode: increases internal processing fidelity (Worklet-only)
  highQualityMode: boolean; // default true

  // Lossless mode: bypasses compressor entirely for transparent EQ
  losslessMode: boolean;    // default true
}

export const DEFAULT_ENHANCEMENT: EnhancementParams = {
  exciterAmount: 0,
  exciterFreq: 2800,
  stereoWidth: 1.0,
  softClipEnabled: true,
  outputCeiling: -0.3,
  bassEnhance: 0,
  bassEnhanceFreq: 80,
  transientAttack: 0,
  transientSustain: 0,
  crossFeed: 0,
  dynamicEqMaster: false,
  highQualityMode: true,
  losslessMode: true,
};

export const DEFAULT_BANDS: EQBand[] = [
  { frequency: 32,    type: 'lowshelf', gain: 0, q: 0.7, dynEnabled: false, threshold: -24, ratio: 2, attack: 10, release: 100, range: 6 },
  { frequency: 64,    type: 'peaking',  gain: 0, q: 1.4, dynEnabled: false, threshold: -24, ratio: 2, attack: 10, release: 100, range: 6 },
  { frequency: 125,   type: 'peaking',  gain: 0, q: 1.4, dynEnabled: false, threshold: -24, ratio: 2, attack: 10, release: 100, range: 6 },
  { frequency: 250,   type: 'peaking',  gain: 0, q: 1.4, dynEnabled: false, threshold: -24, ratio: 2, attack: 10, release: 100, range: 6 },
  { frequency: 500,   type: 'peaking',  gain: 0, q: 1.4, dynEnabled: false, threshold: -24, ratio: 2, attack: 10, release: 100, range: 6 },
  { frequency: 1000,  type: 'peaking',  gain: 0, q: 1.4, dynEnabled: false, threshold: -24, ratio: 2, attack: 10, release: 100, range: 6 },
  { frequency: 2000,  type: 'peaking',  gain: 0, q: 1.4, dynEnabled: false, threshold: -24, ratio: 2, attack: 10, release: 100, range: 6 },
  { frequency: 4000,  type: 'peaking',  gain: 0, q: 1.4, dynEnabled: false, threshold: -24, ratio: 2, attack: 10, release: 100, range: 6 },
  { frequency: 8000,  type: 'peaking',  gain: 0, q: 1.4, dynEnabled: false, threshold: -24, ratio: 2, attack: 10, release: 100, range: 6 },
  { frequency: 16000, type: 'highshelf',gain: 0, q: 0.7, dynEnabled: false, threshold: -24, ratio: 2, attack: 10, release: 100, range: 6 },
];

// A/B preview gains per TuningWizard scenario
// A/B preview gains per TuningWizard scenario: Competing Spectral Hypotheses
export const AB_PREVIEW_GAINS: Record<string, { A: number[]; B: number[] }> = {
  // Hypothesis: Massive Sub-extension vs Tight Mid-bass Impact
  bass_depth:      { A: [7, 4, 1.5, 0, 0, 0, 0, 0, 0, 0], B: [0, 3.2, 8, 3.2, 0, 0, 0, 0, 0, 0] },
  
  // Hypothesis: Warm Body (Low-mid) vs Crisp Definition (Upper-mid)
  vocal_clarity:    { A: [0,  0,  2.4, 6.4, 4,  0,  0,  0,  0,  0], B: [0,  0,  0,  0,  1.6, 5.6, 7.2, 3.2, 0, 0] },
  
  // Hypothesis: Deep Floor Shake vs Controlled Low-end
  sub_bass:         { A: [8, 2.3, 0,  0,  0,  0,  0,  0,  0,  0], B: [-2.3, 1.1, 3.4, 0,  0,  0,  0,  0,  0, 0] },
  
  // Hypothesis: Soundstage Width (High-mids) vs Instrument Core (Low-mids)
  instrument_sep:   { A: [0,  0,  0,  0,  0.8, 4.8, 7.2, 5.6, 3.2, 0], B: [0,  1.6, 4,  3.2,  0,  0,  0,  0,  0, 0] },
  
  // Hypothesis: Chest-hitting Thump (125Hz) vs Snare Crack (500Hz)
  mid_punch:        { A: [0,  2.4, 7.2, 3.2, 0,  0,  0,  0,  0,  0], B: [0,  0,  0,  3.2, 6.4, 3.2, 0,  0,  0, 0] },
  
  // Hypothesis: Natural Roll-off vs Hyper-detailed Air
  high_frequency:   { A: [0,  0,  0,  0,  0,  0,  0,  -1.3, -3.3, -5.3], B: [0,  0,  0,  0,  0,  1.3, 2.7, 4.7, 6.0, 8.0] },
  
  // Hypothesis: Laid-back Presence vs Forward "In-your-face" Presence
  presence:         { A: [0,  0,  0,  0,  0,  -2.4, -4.0, -2.4,  0,  0], B: [0,  0,  0,  0,  0,  3.2, 6.4, 4.8, 1.6, 0] },
  
  // Hypothesis: Harmonic Fullness vs Clinical Transparency
  warmth_body:      { A: [0.8, 2.4, 5.6, 5.6, 3.2, 0,  0,  0,  0,  0], B: [0,  0,  0,  -1.6, -3.2, -1.6,  0,  0,  0, 0] },
  
  // Hypothesis: De-esser Safe Mode vs Full-frequency Sibilance
  sibilance:        { A: [0,  0,  0,  0,  0,  0,  -1.6, -4.8,-7.2, -3.2], B: [0,  0,  0,  0,  0,  0,  0.8, 4,  5.6, 3.2] },
  
  // Hypothesis: V-Shaped Excitement vs Studio Reference Flat
  overall_balance:  { A: [4.8, 3.2, 0, -2.4, -4.0,-2.4,  0,  3.2, 4.8, 6.4], B: [0,  0,  0,  0,  0,  0,  0,  0,  0, 0] },

  // Hypothesis: Sub/Mid Transition Masking vs Clean Cross-over
  sub_mid_blend:    { A: [3.2, 4.8, 6.4, 3.2, 0.8, 0, 0, 0, 0, 0], B: [6.4, 1.6, -3.2, -4.8, -1.6, 0, 0, 0, 0, 0] },

  // Hypothesis: Super-tweeter Extension vs Narrow HF focus
  high_air_only:    { A: [0, 0, 0, 0, 0, 0, 0, 0, 1.3, 8.0], B: [0, 0, 0, 0, 0, 0.3, 2, 4, 5.3, 2.7] },

  // Hypothesis: Dense Warmth vs Punchy Clarity
  warmth_no_mud:    { A: [0, 0, 1.6, 6.4, 6.4, 2.4, 0, 0, 0, 0], B: [0, 4, 6.4, 3.2, 1.6, 0, 0, 0, 0, 0] },

  // Hypothesis: Edge Definition vs Sweetness
  presence_no_harshness: { A: [0, 0, 0, 0, 1.6, 6.4, 6.4, 1.6, 0, 0], B: [0, 0, 0, 0, 0, 3.2, 3.2, 6.4, 4.8, 0] },
};

// ─── Spectral Analysis Helpers ────────────────────────────────────────────────

export interface TrackCharacter {
  subBassStrong: boolean;    // peak energy band 0 > ngưỡng
  bassStrong: boolean;       // band 1-2 dominant
  brightAir: boolean;        // centroid > 6000 Hz và highs energy cao
  dynamicWide: boolean;      // crest factor > 14 dB
  tonal: boolean;            // flatness < 0.15 (nhiều tonal content, ít noise)
  genre: 'bass-heavy' | 'vocal-mid' | 'bright-electronic' | 'acoustic' | 'balanced';
}

export function computeOctaveBandEnergies(
  data: Float32Array,
  sampleRate: number,
  numBands = 10
): number[] {
  const minFreq = 20, maxFreq = sampleRate / 2;
  const bins = data.length;
  const result: number[] = new Array(numBands).fill(0);
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);
  const bandwidth = (logMax - logMin) / numBands;

  for (let i = 1; i < bins; i++) {
    const freq = (i / bins) * maxFreq;
    if (freq < minFreq) continue;
    const logF = Math.log10(freq);
    const bandIdx = Math.floor((logF - logMin) / bandwidth);
    if (bandIdx >= 0 && bandIdx < numBands) {
      const lin = Math.pow(10, data[i] / 20);
      result[bandIdx] += lin * lin;
    }
  }

  return result.map(e => 10 * Math.log10(Math.max(1e-10, e)));
}

export function aWeightedLoudness(data: Float32Array, sampleRate: number): number {
  const bins = data.length;
  const maxFreq = sampleRate / 2;
  let weightedPower = 0;

  for (let i = 1; i < bins; i++) {
    const f = (i / bins) * maxFreq;
    if (f < 10) continue;
    const f2 = f * f;
    const f4 = f2 * f2;
    const ra = (12194 * 12194 * f4) /
               ((f2 + 20.6 * 20.6) *
                Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) *
                (f2 + 12194 * 12194));
    const aWeight = 20 * Math.log10(ra) + 2.0;
    const linPower = Math.pow(10, (data[i] + aWeight) / 10);
    weightedPower += linPower;
  }

  return 10 * Math.log10(Math.max(1e-10, weightedPower));
}

// ─── AudioWorklet Soft Clipper ─────────────────────────────────────────────
// We implement a ScriptProcessor-style soft clipper using a WaveShaperNode
// with a mathematically optimal transfer curve: tanh-based with adjustable knee

function buildSoftClipCurve(ceiling: number, samples = 4096): Float32Array {
  // ceiling in dBFS (e.g. -0.3)
  const linCeil = Math.pow(10, ceiling / 20);
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1; // -1 to +1
    // Polynomial soft clip: cubic when |x| < threshold, hard limit beyond
    // More musical than tanh alone — preserves transient shape better
    const abs = Math.abs(x);
    let y: number;
    if (abs < linCeil * 0.667) {
      y = x; // linear passthrough below knee
    } else if (abs < linCeil) {
      // Cubic knee region: smooth transition
      const t = (abs - linCeil * 0.667) / (linCeil * 0.333);
      y = Math.sign(x) * (linCeil * 0.667 + linCeil * 0.333 * (1.5 * t - 0.5 * t * t * t));
    } else {
      // Tanh saturation above ceiling — adds natural harmonic content
      const over = (abs - linCeil) * 4;
      y = Math.sign(x) * linCeil * (1 - Math.exp(-over) * 0.08);
    }
    curve[i] = y;
  }
  return curve;
}

// Harmonic exciter transfer curve: gentle 2nd-order waveshaping
// Applied only to high-frequencies (post-HPF), adds air without distortion
function buildExciterCurve(amount: number, samples = 4096): Float32Array {
  const curve = new Float32Array(samples);
  const a = amount * 0.3; // scale to subtle range
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    // Chebyshev 2nd-order term: emphasizes even harmonics (warm, musical)
    // T2(x) = 2x² - 1, but we blend: y = x + a*(2x²-1)*|x|
    const harm = 2 * x * x - 1;
    curve[i] = x + a * harm * Math.abs(x) * 0.5;
  }
  return curve;
}

// Bass harmonic synthesis: create 2nd harmonic of sub-bass
// Makes sub frequencies audible on speakers that can't reproduce fundamentals
function buildBassExciterCurve(amount: number, samples = 4096): Float32Array {
  const curve = new Float32Array(samples);
  const a = amount * 0.4;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    // 3rd order odd harmonic (octave + fifth) - punchy bass character
    const harm = x * x * x - 0.3 * x;
    curve[i] = x + a * harm;
  }
  return curve;
}

// ─── FIR Kernel Generation ──────────────────────────────────────────────────

function ifftInPlace(re: Float64Array, im: Float64Array) {
  const N = re.length;
  for (let i = 0; i < N; i++) im[i] = -im[i];
  fftInPlace(re, im);
  for (let i = 0; i < N; i++) {
    re[i] /= N;
    im[i] = -im[i] / N;
  }
}

/**
 * Computes a linear-phase FIR impulse response based on EQ bands.
 * Uses frequency-sampling method.
 */
// pre-calculated coefficients for a single band
interface BiquadCoeffs {
  b0: number; b1: number; b2: number;
  a0: number; a1: number; a2: number;
}

function getBiquadCoeffs(
  type: 'peaking' | 'lowshelf' | 'highshelf' | 'lowpass' | 'highpass' | string,
  f0: number,
  gainDb: number,
  Q: number,
  sampleRate: number
): BiquadCoeffs {
  const A     = Math.pow(10, gainDb / 40);
  const w0    = (2 * Math.PI * f0) / sampleRate;
  const sinW0 = Math.sin(w0);
  const cosW0 = Math.cos(w0);
  const alpha = sinW0 / (2 * Q);

  let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

  switch (type) {
    case 'peaking':
      b0 =  1 + alpha * A;  b1 = -2 * cosW0;  b2 = 1 - alpha * A;
      a0 =  1 + alpha / A;  a1 = -2 * cosW0;  a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s2A = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A+1) - (A-1)*cosW0 + s2A);
      b1 = 2 * A * ((A-1) - (A+1)*cosW0);
      b2 = A * ((A+1) - (A-1)*cosW0 - s2A);
      a0 = (A+1) + (A-1)*cosW0 + s2A;
      a1 = -2 * ((A-1) + (A+1)*cosW0);
      a2 = (A+1) + (A-1)*cosW0 - s2A;
      break;
    }
    case 'highshelf': {
      const s2A = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A+1) + (A-1)*cosW0 + s2A);
      b1 = -2 * A * ((A-1) + (A+1)*cosW0);
      b2 = A * ((A+1) + (A-1)*cosW0 - s2A);
      a0 = (A+1) - (A-1)*cosW0 + s2A;
      a1 = 2 * ((A-1) - (A+1)*cosW0);
      a2 = (A+1) - (A-1)*cosW0 - s2A;
      break;
    }
  }
  return { b0, b1, b2, a0, a1, a2 };
}

function biquadMagnitudeDbFast(
  coeffs: BiquadCoeffs,
  f: number,
  sampleRate: number
): number {
  const { b0, b1, b2, a0, a1, a2 } = coeffs;
  const w = (2 * Math.PI * f) / sampleRate;
  
  const cosW  = Math.cos(w),  sinW  = Math.sin(w);
  const cos2W = Math.cos(2*w), sin2W = Math.sin(2*w);

  const numR = b0 + b1*cosW  + b2*cos2W;
  const numI =    - b1*sinW  - b2*sin2W;
  const denR = a0 + a1*cosW  + a2*cos2W;
  const denI =    - a1*sinW  - a2*sin2W;

  const num2 = numR*numR + numI*numI;
  const den2 = denR*denR + denI*denI;
  if (den2 < 1e-20) return 0;

  return 10 * Math.log10(Math.max(1e-20, num2 / den2));
}

function computeFIRKernel(bands: EQBand[], sampleRate: number, N = 2048): Float32Array {
  const halfN = N / 2;
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  // Pre-calculate coefficients once per band
  const bandCoeffs = bands
    .filter(b => b.gain !== 0 || b.type === 'lowpass' || b.type === 'highpass')
    .map(b => getBiquadCoeffs(b.type, b.frequency, b.gain, b.q, sampleRate));

  // Target magnitude response (linear gain)
  const targetMag = new Float64Array(halfN + 1);
  for (let k = 0; k <= halfN; k++) {
    const f = (k / halfN) * (sampleRate / 2);

    let totalGainDb = 0;
    for (let j = 0; j < bandCoeffs.length; j++) {
      totalGainDb += biquadMagnitudeDbFast(bandCoeffs[j], f, sampleRate);
    }
    targetMag[k] = Math.pow(10, totalGainDb / 20);
  }

  // Construct complex spectrum for Linear Phase
  // Phase = -omega * delaySamples
  const delaySamples = Math.floor(N / 2);
  for (let k = 0; k <= halfN; k++) {
    const omega = (2 * Math.PI * k) / N;
    const phase = -omega * delaySamples;
    re[k] = targetMag[k] * Math.cos(phase);
    im[k] = targetMag[k] * Math.sin(phase);

    // Conjugate symmetry for real impulse response
    if (k > 0 && k < halfN) {
      re[N - k] = re[k];
      im[N - k] = -im[k];
    }
  }
  re[halfN] = targetMag[halfN] * Math.cos(-Math.PI * delaySamples);
  im[halfN] = 0;

  ifftInPlace(re, im);

  // Apply Window (Hann) to smooth the impulse response edges
  const kernel = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    kernel[i] = (re[i] as any) * window;
  }

  return kernel;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;

  private filtersA: BiquadFilterNode[] = [];
  private filtersB: BiquadFilterNode[] = [];
  private gainA: GainNode | null = null;
  private gainB: GainNode | null = null;
  private gainAMakeup: GainNode | null = null;
  private gainBMakeup: GainNode | null = null;
  private _lastGainMatch: { aDb: number; bDb: number } = { aDb: 0, bDb: 0 };
  private currentBands: EQBand[] = JSON.parse(JSON.stringify(DEFAULT_BANDS));
  private baseCorrectionGains: number[] = new Array(10).fill(0);

  // ─── FIR State ───────────────────────────────────────────────────────────
  private phaseMode: 'iir' | 'fir' | 'hybrid' = 'iir';
  private convolver: ConvolverNode | null = null;
  private firGain: GainNode | null = null;
  private iirGain: GainNode | null = null;
  private iirDelay: DelayNode | null = null; // Compensation for FIR delay

  // ─── Shared DSP chain ────────────────────────────────────────────────────
  private analyzer: AnalyserNode | null = null;
  private analyzerFloat: AnalyserNode | null = null;
  private analyzerL: AnalyserNode | null = null; // Left channel for phase correlation
  private analyzerR: AnalyserNode | null = null; // Right channel for phase correlation
  private preGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private truePeakLimiter: DynamicsCompressorNode | null = null;
  private stereoPanner: StereoPannerNode | null = null;
  public tapNode: AudioWorkletNode | null = null;
  private visWorker: Worker | null = null;

  // OS Bypass Sample Rate status
  public actualSampleRate: number = 0;
  public targetSampleRate: number = 0;
  public isResampled: boolean = false;

  // ─── NEW: Enhancement nodes ───────────────────────────────────────────────
  // Soft clipper (replaces compressor in lossless mode)
  private softClipper: WaveShaperNode | null = null;
  private softClipperGain: GainNode | null = null;

  // Harmonic Exciter: HPF → WaveShaper → makeup gain → mix
  private exciterHPF: BiquadFilterNode | null = null;
  private exciterShape: WaveShaperNode | null = null;
  private exciterGain: GainNode | null = null;
  private exciterDry: GainNode | null = null; // dry passthrough
  private exciterWet: GainNode | null = null; // wet (shaped) signal

  // Bass Enhancer: LPF → WaveShaper → mix
  private bassHPF: BiquadFilterNode | null = null;
  private bassShape: WaveShaperNode | null = null;
  private bassGain: GainNode | null = null;
  private bassDry: GainNode | null = null;
  private bassWet: GainNode | null = null;

  // Enhancement bypass node
  private enhancementInput: GainNode | null = null;
  private enhancementOutput: GainNode | null = null;

  // ─── NEW: AudioWorklet Core ──────────────────────────────────────────────
  private workletNode: AudioWorkletNode | null = null;
  private dynamicEqNode: AudioWorkletNode | null = null;

  private activeChain: 'A' | 'B' | 'none' = 'none';
  private isABMode = false;
  private readonly CROSSFADE_TIME = 0.12;
  private enhancement: EnhancementParams = { ...DEFAULT_ENHANCEMENT };

  // ─── Metering Data ───────────────────────────────────────────────────────
  private _momentaryLoudness = -70;
  private _shortTermLoudness = -70;
  private _integratedLoudness = -70;
  private _peakLevel = -96;
  private _psr = 0;
  private _lufsWindow: number[] = []; // Energy buffer for short-term LUFS

  private floatBuffer: Float32Array | null = null;
  private timeDomainBuffer: Float32Array | null = null;

  // ─── WebUSB core ─────────────────────────────────────────────────────────
  private usbNode: AudioWorkletNode | null = null;

  // ─── AI Improvements ─────────────────────────────────────────────────────
  private temporalModel = new TemporalDynamicsModel();
  private eqMorphing = new EQProfileMorphing();
  private lastTime = 0;

  constructor() {
    // AE-01: Do NOT create AudioContext here.
    // Browsers require a user gesture before AudioContext is allowed.
    // Context is created lazily inside reinitializeAtRate() on first user interaction.
    if (typeof window !== 'undefined') {
      this.lastTime = performance.now();
    }
  }

  public async reinitializeAtRate(audioElement: HTMLAudioElement, sampleRate: number) {
    if (this.context && this.context.sampleRate === sampleRate) {
      return; // Already matched
    }
    
    // Completely kill the old context to avoid memory leak
    if (this.context) {
      try {
        if (this.source) { this.source.disconnect(); }
        if (this.preGain) { this.preGain.disconnect(); }
        if (this.analyzer) { this.analyzer.disconnect(); }
        if (this.analyzerFloat) { this.analyzerFloat.disconnect(); }
        if (this.analyzerL) { this.analyzerL.disconnect(); }
        if (this.analyzerR) { this.analyzerR.disconnect(); }
        if (this.compressor) { this.compressor.disconnect(); }
        if (this.truePeakLimiter) { this.truePeakLimiter.disconnect(); }
        if (this.masterGain) { this.masterGain.disconnect(); }
        if (this.stereoPanner) { this.stereoPanner.disconnect(); }
        if (this.convolver) { this.convolver.disconnect(); }
        if (this.firGain) { this.firGain.disconnect(); }
        if (this.iirGain) { this.iirGain.disconnect(); }
        if (this.iirDelay) { this.iirDelay.disconnect(); }
        if (this.softClipper) { this.softClipper.disconnect(); }
        if (this.softClipperGain) { this.softClipperGain.disconnect(); }
        if (this.exciterHPF) { this.exciterHPF.disconnect(); }
        if (this.bassHPF) { this.bassHPF.disconnect(); }
        if (this.enhancementInput) { this.enhancementInput.disconnect(); }
        if (this.enhancementOutput) { this.enhancementOutput.disconnect(); }
        if (this.workletNode) { this.workletNode.disconnect(); }
        if (this.dynamicEqNode) { this.dynamicEqNode.disconnect(); }
        if (this.usbNode) { this.usbNode.disconnect(); }
        if (this.tapNode) { this.tapNode.disconnect(); }
        
        this.filtersA.forEach(f => f.disconnect());
        this.filtersB.forEach(f => f.disconnect());
        if (this.gainA) { this.gainA.disconnect(); }
        if (this.gainB) { this.gainB.disconnect(); }
        if (this.gainAMakeup) { this.gainAMakeup.disconnect(); }
        if (this.gainBMakeup) { this.gainBMakeup.disconnect(); }

        await this.context.close();
      } catch (e) {}
    }

    if (typeof window !== 'undefined') {
      try {
         this.context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate });
      } catch (e) {
         console.warn("Could not set exact sample rate", e);
         this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      (this.context as any).id = Math.random().toString(36).substring(7);
      this.actualSampleRate = this.context!.sampleRate;
      this.targetSampleRate = sampleRate;
      this.isResampled = this.actualSampleRate !== this.targetSampleRate;
    }

    // Reset nodes so they get recreated
    this.source = null;
    this.preGain = null;
    this.analyzer = null;
    this.analyzerFloat = null;
    this.analyzerL = null;
    this.analyzerR = null;
    this.compressor = null;
    this.truePeakLimiter = null;
    this.masterGain = null;
    this.stereoPanner = null;
    this.convolver = null;
    this.firGain = null;
    this.iirGain = null;
    this.iirDelay = null;
    this.softClipper = null;
    this.softClipperGain = null;
    this.exciterHPF = null;
    this.exciterShape = null;
    this.exciterGain = null;
    this.exciterDry = null;
    this.exciterWet = null;
    this.bassHPF = null;
    this.bassShape = null;
    this.bassGain = null;
    this.bassDry = null;
    this.bassWet = null;
    this.enhancementInput = null;
    this.enhancementOutput = null;
    this.workletNode = null;
    this.dynamicEqNode = null;
    this.usbNode = null;
    this.tapNode = null;
    this.filtersA = [];
    this.filtersB = [];
    this.gainA = null;
    this.gainB = null;
    this.gainAMakeup = null;
    this.gainBMakeup = null;

    await this.initialize(audioElement, true);
  }

  public async toggleWebUSB(enable: boolean) {
    if (enable) {
      if (!this.usbNode && this.context) {
        try {
          this.usbNode = new AudioWorkletNode(this.context, 'usb-bridge-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 0,
            channelCountMode: 'explicit',
            channelCount: 2
          });
          this.usbNode.port.onmessage = (e) => {
             const buf = e.data; // Int16Array Buffer
             if (webUSB.isActive) {
               webUSB.sendAudioBuffer(buf);
             }
          };
          // Connect to the end of the chain
          if (this.stereoPanner) {
            this.stereoPanner.connect(this.usbNode);
          } else if (this.masterGain) {
            this.masterGain.connect(this.usbNode);
          }
        } catch (e) {
          console.warn("Could not create WebUSB bridge node", e);
        }
      }
    } else {
      if (this.usbNode) {
        try { this.usbNode.disconnect(); } catch (e) {}
        this.usbNode = null;
      }
    }
  }

  private _setupFallbackEnhancements() {
    if (!this.enhancementInput || !this.enhancementOutput || !this.softClipper || !this.softClipperGain || !this.stereoPanner) return;
    this.enhancementInput.disconnect();
    this.enhancementInput.connect(this.bassDry!);
    this.enhancementInput.connect(this.exciterDry!);
    this.enhancementOutput.connect(this.softClipper);
    this.softClipper.connect(this.softClipperGain);
    this.softClipperGain.connect(this.stereoPanner);
  }

  public async initialize(audioElement: HTMLAudioElement, forceRenewSource: boolean = false) {
    if (!this.context) return;
    if (this.context.state === 'suspended') await this.context.resume();

    // Check Sample Rate Match (approximate target base)
    // When using standard element source, we don't know the exact file SR until we decode
    // or we can assume typical 44100
    this.actualSampleRate = this.context.sampleRate;
    this.targetSampleRate = this.context.sampleRate; // If we don't know from metadata
    this.isResampled = false; // We can't be sure without file metadata, but if we call reinitializeAtRate, we'll update it

    // ─── Register AudioWorklet ───────────────────────────────────────────
    try {
      await Promise.all([
        this.context.audioWorklet.addModule('/worklets/sonic-processor.js'),
        this.context.audioWorklet.addModule('/worklets/dynamic-eq-processor.js'),
        this.context.audioWorklet.addModule('/worklets/usb-bridge-processor.js'),
        this.context.audioWorklet.addModule('/worklets/tap-processor.js')
      ]);
    } catch (e) {
      console.warn('SonicProcessor: Native Worklet failed to load.', e);
    }

    if (!this.source || forceRenewSource) {
      if (this.source) {
        try { this.source.disconnect(); } catch (e) { }
      }
      
      // Safety: Only try to create if we don't already have a valid source for THIS context
      // Note: HTMLMediaElement can only be connected to ONE context ever.
      try { 
        this.source = this.context.createMediaElementSource(audioElement); 
      } catch (err) { 
        console.warn('Audio source connection failed. This usually happens if the engine was re-initialized at a different sample rate. A page refresh may be required for bit-perfect mode to engage fully.', err);
        // If it failed, don't leave a dead source from another context
        this.source = null;
      }
    }

    if (!this.analyzer) {
      this.analyzer = this.context.createAnalyser();
      this.analyzer.fftSize = 4096;
      this.analyzer.smoothingTimeConstant = 0.85;
      this.analyzer.minDecibels = -100;
      this.analyzer.maxDecibels = 0;
    }

    if (!this.analyzerFloat) {
      this.analyzerFloat = this.context.createAnalyser();
      this.analyzerFloat.fftSize = 2048;
      this.analyzerFloat.smoothingTimeConstant = 0.4;
      this.floatBuffer = new Float32Array(this.analyzerFloat.frequencyBinCount);
      this.timeDomainBuffer = new Float32Array(this.analyzerFloat.fftSize);
    }

    // Left/right analyzers for stereo correlation meter
    if (!this.analyzerL) {
      this.analyzerL = this.context.createAnalyser();
      this.analyzerL.fftSize = 1024;
      this.analyzerL.smoothingTimeConstant = 0.5;
    }
    if (!this.analyzerR) {
      this.analyzerR = this.context.createAnalyser();
      this.analyzerR.fftSize = 1024;
      this.analyzerR.smoothingTimeConstant = 0.5;
    }

    // Keep compressor for legacy mode
    if (!this.compressor) {
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-20, this.context.currentTime);
      this.compressor.knee.setValueAtTime(12, this.context.currentTime);
      this.compressor.ratio.setValueAtTime(4, this.context.currentTime);
      this.compressor.attack.setValueAtTime(0.01, this.context.currentTime);
      this.compressor.release.setValueAtTime(0.25, this.context.currentTime);
    }

    // True Peak Limiter (Brickwall + Lookahead) to prevent any clipping from digital gain
    if (!this.truePeakLimiter) {
      this.truePeakLimiter = this.context.createDynamicsCompressor();
      this.truePeakLimiter.threshold.setValueAtTime(-0.3, this.context.currentTime); // -0.3 dBFS True Peak 
      this.truePeakLimiter.knee.setValueAtTime(0.0, this.context.currentTime); // Hard knee
      this.truePeakLimiter.ratio.setValueAtTime(20.0, this.context.currentTime); // Brickwall
      this.truePeakLimiter.attack.setValueAtTime(0.005, this.context.currentTime); // 5ms lookahead
      this.truePeakLimiter.release.setValueAtTime(0.050, this.context.currentTime); // fast release
    }

    if (!this.tapNode) {
       try {
           this.tapNode = new AudioWorkletNode(this.context, 'tap-processor');
       } catch (e) {
           console.log("Failed to create tap node", e);
       }
    }

    if (!this.preGain) { this.preGain = this.context.createGain(); this.preGain.gain.value = 1.0; }
    if (!this.masterGain) { this.masterGain = this.context.createGain(); this.masterGain.gain.value = 1.0; }
    if (!this.stereoPanner) { this.stereoPanner = this.context.createStereoPanner(); this.stereoPanner.pan.value = 0; }

    // ─── Build FIR/IIR Switch ────────────────────────────────────────────
    if (!this.convolver) {
      this.convolver = this.context.createConvolver();
      this.convolver.normalize = false; // We want exact gain control
      this.firGain = this.context.createGain();
      this.firGain.gain.value = 0;
      this.iirGain = this.context.createGain();
      this.iirGain.gain.value = 1;
      this.iirDelay = this.context.createDelay(1.0);
      this.iirDelay.delayTime.value = 0;

      // Dummy buffer to start
      const dummy = this.context.createBuffer(2, 256, this.context.sampleRate);
      this.convolver.buffer = dummy;
    }

    // ─── Build Enhancement Chain ─────────────────────────────────────────
    if (!this.softClipper) {
      this.softClipper = this.context.createWaveShaper();
      this.softClipper.curve = buildSoftClipCurve(this.enhancement.outputCeiling) as any;
      this.softClipper.oversample = '4x';
      this.softClipperGain = this.context.createGain();
      this.softClipperGain.gain.value = 1.0;
    }

    // Exciter
    if (!this.exciterHPF) {
      this.exciterHPF = this.context.createBiquadFilter();
      this.exciterHPF.type = 'highpass';
      this.exciterHPF.frequency.value = this.enhancement.exciterFreq;
      this.exciterHPF.Q.value = 0.6;
      this.exciterShape = this.context.createWaveShaper();
      this.exciterShape.curve = buildExciterCurve(this.enhancement.exciterAmount) as any;
      this.exciterShape.oversample = '2x';
      this.exciterGain = this.context.createGain();
      this.exciterGain.gain.value = this.enhancement.exciterAmount * 0.4;
      this.exciterDry = this.context.createGain();
      this.exciterDry.gain.value = 1.0;
      this.exciterWet = this.context.createGain();
      this.exciterWet.gain.value = this.enhancement.exciterAmount;
    }

    // Bass Enhancer
    if (!this.bassHPF) {
      this.bassHPF = this.context.createBiquadFilter();
      this.bassHPF.type = 'lowpass';
      this.bassHPF.frequency.value = this.enhancement.bassEnhanceFreq;
      this.bassHPF.Q.value = 0.7;
      this.bassShape = this.context.createWaveShaper();
      this.bassShape.curve = buildBassExciterCurve(Math.max(0.001, this.enhancement.bassEnhance)) as any;
      this.bassShape.oversample = '4x';
      this.bassGain = this.context.createGain();
      this.bassGain.gain.value = this.enhancement.bassEnhance * 0.5;
      this.bassDry = this.context.createGain();
      this.bassDry.gain.value = 1.0;
      this.bassWet = this.context.createGain();
      this.bassWet.gain.value = this.enhancement.bassEnhance;
    }

    if (!this.enhancementInput) {
      this.enhancementInput = this.context.createGain();
      this.enhancementOutput = this.context.createGain();
      this.enhancementInput.gain.value = 1.0;
      this.enhancementOutput!.gain.value = 1.0;
    }

    if (this.filtersA.length === 0) {
      this.filtersA = this._buildFilterChain();
      this.filtersB = this._buildFilterChain();
      this.gainA = this.context.createGain();
      this.gainB = this.context.createGain();
      this.gainA.gain.value = 0;
      this.gainB.gain.value = 1;
      this.gainAMakeup = this.context.createGain();
      this.gainBMakeup = this.context.createGain();
      this.gainAMakeup.gain.value = 1;
      this.gainBMakeup.gain.value = 1;

      // Dynamic EQ node init
      if (this.context.audioWorklet && 'AudioWorkletNode' in window) {
        try {
          this.dynamicEqNode = new AudioWorkletNode(this.context, 'dynamic-eq-processor');
          this.preGain!.connect(this.dynamicEqNode);
        } catch (e) {
          console.warn('DynamicEQ Worklet failed to init');
        }
      }

      // Connect sources to chains
      const sourceNode = this.dynamicEqNode || this.preGain;
      this._connectChain(sourceNode, this.filtersA, this.gainAMakeup!);
      this.gainAMakeup!.connect(this.gainA);
      this._connectChain(sourceNode, this.filtersB, this.gainBMakeup!);
      this.gainBMakeup!.connect(this.gainB);

      // Both chains merge into iirGain
      this.gainA.connect(this.iirGain!);
      this.gainB.connect(this.iirGain!);

      // FIR Path
      this.preGain.connect(this.convolver!);
      this.convolver!.connect(this.firGain!);

      // IIR Path with optional delay for alignment
      this.gainA.disconnect();
      this.gainB.disconnect();
      this.gainA.connect(this.iirDelay!);
      this.gainB.connect(this.iirDelay!);
      this.iirDelay!.connect(this.iirGain!);

      // Both paths merge into enhancementInput
      this.iirGain!.connect(this.enhancementInput!);
      this.firGain!.connect(this.enhancementInput!);

      // Enhancement routing
      this.enhancementInput!.connect(this.bassDry!);
      this.enhancementInput!.connect(this.exciterDry!);
      this.bassDry!.connect(this.enhancementOutput!);
      this.exciterDry!.connect(this.enhancementOutput!);
      this.enhancementInput!.connect(this.bassHPF!);
      this.bassHPF!.connect(this.bassShape!);
      this.bassShape!.connect(this.bassWet!);
      this.bassWet!.connect(this.enhancementOutput!);
      this.enhancementInput!.connect(this.exciterHPF!);
      this.exciterHPF!.connect(this.exciterShape!);
      this.exciterShape!.connect(this.exciterWet!);
      this.exciterWet!.connect(this.enhancementOutput!);

    // AudioWorklet integration
    if (this.context.audioWorklet && 'AudioWorkletNode' in window) {
      try {
        this.workletNode = new AudioWorkletNode(this.context, 'sonic-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          parameterData: {
            bassEnhance: this.enhancement.bassEnhance,
            ceiling: this.enhancement.outputCeiling,
            width: this.enhancement.stereoWidth,
            crossFeed: this.enhancement.crossFeed,
            dither: this.enhancement.highQualityMode ? 1.0 : 0.0
          }
        });

        // Handle metering messages from worklet
        this.workletNode.port.onmessage = (e) => {
          if (e.data.type === 'metering') {
            this._momentaryLoudness = e.data.momentary;
            this._shortTermLoudness = e.data.shortTerm;
            this._peakLevel = e.data.peak;
            this._psr = e.data.psr;
            this._integratedLoudness = e.data.integrated ?? this._integratedLoudness;
            
            // Feed to Temporal Dynamics Model
            this.temporalModel.updateLoudness(this._momentaryLoudness);
          }
        };
        
        // WHEN USING WORKLET, BYPASS TRADITIONAL ENHANCEMENTS TO PREVENT DOUBLE PROCESSING
        this.enhancementInput!.disconnect();
        this.enhancementInput!.connect(this.workletNode);
        this.workletNode.connect(this.stereoPanner!);
      } catch (e) {
        this._setupFallbackEnhancements();
      }
    } else {
      this._setupFallbackEnhancements();
    }

      this.stereoPanner!.connect(this.masterGain!);
      
      const splitter = this.context.createChannelSplitter(2);
      this.masterGain!.connect(splitter);
      splitter.connect(this.analyzerL!, 0);
      splitter.connect(this.analyzerR!, 1);

      this.masterGain!.connect(this.analyzer!);
      this.analyzer!.connect(this.analyzerFloat!);
      if (this.tapNode) {
          this.analyzerFloat!.connect(this.tapNode);
          this.tapNode.connect(this.truePeakLimiter!);
      } else {
          this.analyzerFloat!.connect(this.truePeakLimiter!);
      }
      this.truePeakLimiter!.connect(this.context.destination);

      if (this.source) this.source.connect(this.preGain);
    }
  }

  public attachVisualizer(canvas: HTMLCanvasElement) {
    if (!this.tapNode) return;

    if (this.visWorker) {
        this.visWorker.terminate();
    }
    this.visWorker = new Worker(new URL('/workers/visualizer-worker.js', window.location.origin));
    const offscreen = canvas.transferControlToOffscreen();
    
    const channel = new MessageChannel();
    this.visWorker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);
    
    this.tapNode.port.postMessage({ type: 'setup_port', port: channel.port1 }, [channel.port1]);
    this.visWorker.postMessage({ type: 'setup_port', port: channel.port2 }, [channel.port2]);
  }

  private _buildFilterChain(): BiquadFilterNode[] {
    return DEFAULT_BANDS.map((band) => {
      const f = this.context!.createBiquadFilter();
      f.type = band.type;
      f.frequency.value = band.frequency;
      f.gain.value = band.gain;
      f.Q.value = band.q;
      return f;
    });
  }

  private _connectChain(src: AudioNode, filters: BiquadFilterNode[], dest: AudioNode) {
    let last: AudioNode = src;
    for (const f of filters) { last.connect(f); last = f; }
    last.connect(dest);
  }

  // ─── Enhancement API ──────────────────────────────────────────────────────

  public updateEnhancement(params: Partial<EnhancementParams>) {
    if (!this.context) return;
    Object.assign(this.enhancement, params);
    const t = this.context.currentTime;

    // Exciter
    if (params.exciterAmount !== undefined && this.exciterShape && this.exciterWet) {
      this.exciterShape.curve = buildExciterCurve(this.enhancement.exciterAmount) as any;
      this.exciterWet.gain.setTargetAtTime(this.enhancement.exciterAmount, t, 0.02);
    }
    if (params.exciterFreq !== undefined && this.exciterHPF) {
      this.exciterHPF.frequency.setTargetAtTime(this.enhancement.exciterFreq, t, 0.02);
    }

    // Bass enhance
    if (params.bassEnhance !== undefined && this.bassShape && this.bassWet) {
      this.bassShape.curve = buildBassExciterCurve(Math.max(0.001, this.enhancement.bassEnhance)) as any;
      this.bassWet.gain.setTargetAtTime(this.enhancement.bassEnhance * 0.8, t, 0.02);
      
      // Update Worklet parameter if available
      if (this.workletNode) {
        this.workletNode.parameters.get('bassEnhance')?.setTargetAtTime(this.enhancement.bassEnhance, t, 0.02);
      }
    }
    if (params.bassEnhanceFreq !== undefined && this.bassHPF) {
      this.bassHPF.frequency.setTargetAtTime(this.enhancement.bassEnhanceFreq, t, 0.02);
    }

    // Enhancement routing updates or worklet param updates
    if (params.dynamicEqMaster !== undefined) {
      const now = this.context.currentTime;
      if (this.enhancement.dynamicEqMaster) {
         // Enable Dynamic EQ mode
         // 1. Silent traditional filters
         this.filtersA.forEach(f => f.gain.setTargetAtTime(0, now, 0.05));
         this.filtersB.forEach(f => f.gain.setTargetAtTime(0, now, 0.05));
         // 2. Sync Worklet
         if (this.dynamicEqNode) {
            this.currentBands.forEach((b, i) => {
               this.dynamicEqNode!.parameters.get(`gain${i}`)?.setTargetAtTime(b.gain, now, 0.05);
               this.dynamicEqNode!.parameters.get(`enabled${i}`)?.setTargetAtTime(b.dynEnabled ? 1 : 0, now, 0.05);
            });
         }
      } else {
         // Disable Dynamic EQ mode
         // 1. Restore traditional filters
         this.currentBands.forEach((b, i) => {
            this.filtersB[i].gain.setTargetAtTime(b.gain, now, 0.05);
            // Chain A handles preview/wizard usually
         });
         // 2. Clear Worklet filters
         if (this.dynamicEqNode) {
            for (let i = 0; i < 10; i++) {
               this.dynamicEqNode!.parameters.get(`gain${i}`)?.setTargetAtTime(0, now, 0.05);
               this.dynamicEqNode!.parameters.get(`enabled${i}`)?.setTargetAtTime(0, now, 0.05);
            }
         }
      }
    }

    // Soft clipper ceiling / Worklet parameters
    if (params.outputCeiling !== undefined) {
      if (this.softClipper) {
        this.softClipper.curve = buildSoftClipCurve(this.enhancement.outputCeiling) as any;
      }
      if (this.workletNode) {
        this.workletNode.parameters.get('ceiling')?.setTargetAtTime(this.enhancement.outputCeiling, t, 0.02);
      }
    }

    // Binaural cross-feed
    if (params.crossFeed !== undefined && this.workletNode) {
      this.workletNode.parameters.get('crossFeed')?.setTargetAtTime(this.enhancement.crossFeed, t, 0.1);
    }

    // Stereo width (True M/S Width via Worklet)
    if (params.stereoWidth !== undefined) {
      if (this.workletNode) {
        this.workletNode.parameters.get('width')?.setTargetAtTime(this.enhancement.stereoWidth, t, 0.1);
      } else if (this.masterGain) {
        // Fallback for non-worklet browsers
        const w = this.enhancement.stereoWidth;
        const g = w < 1 ? w * 0.15 + 0.85 : 0.85 + (w - 1) * 0.15;
        this.masterGain.gain.setTargetAtTime(Math.min(1.0, g), t, 0.05);
      }
    }
  }

  public getLoudnessMetrics() {
    return {
      momentary: this._momentaryLoudness,
      shortTerm: this._shortTermLoudness,
      integrated: this._integratedLoudness,
      peak: this._peakLevel,
      psr: this._psr,
    };
  }

  public getEnhancement(): EnhancementParams {
    return { ...this.enhancement };
  }

  // ─── A/B API ──────────────────────────────────────────────────────────────

  public loadPreviewGains(gains: number[]) {
    gains.forEach((g, i) => this._setGainOnChain(this.filtersA, i, g));
  }

  public crossfadeTo(chain: 'A' | 'B') {
    if (!this.context || !this.gainA || !this.gainB) return;
    if (this.activeChain === chain) return;
    this.isABMode = true;
    this.activeChain = chain;
    const now = this.context.currentTime;
    const [fadeIn, fadeOut] = chain === 'A' ? [this.gainA, this.gainB] : [this.gainB, this.gainA];
    fadeOut.gain.cancelScheduledValues(now);
    fadeIn.gain.cancelScheduledValues(now);
    fadeOut.gain.setValueAtTime(fadeOut.gain.value, now);
    fadeIn.gain.setValueAtTime(fadeIn.gain.value, now);
    const steps = 16;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const tAbs = now + t * this.CROSSFADE_TIME;
      fadeIn.gain.setValueAtTime(Math.sin((Math.PI / 2) * t), tAbs);
      fadeOut.gain.setValueAtTime(Math.cos((Math.PI / 2) * t), tAbs);
    }
  }

  public exitABMode() {
    if (!this.context || !this.gainA || !this.gainB) return;
    this.isABMode = false;
    this.activeChain = 'none';
    const now = this.context.currentTime;
    this.gainA.gain.cancelScheduledValues(now);
    this.gainB.gain.cancelScheduledValues(now);
    
    if (this.phaseMode === 'iir') {
      this.gainA.gain.setValueAtTime(0, now);
      this.gainB.gain.setValueAtTime(1, now);
    } else {
      this.gainA.gain.setValueAtTime(0, now);
      this.gainB.gain.setValueAtTime(0, now);
    }

    if (this.gainAMakeup) this.gainAMakeup.gain.setValueAtTime(1, now);
    if (this.gainBMakeup) this.gainBMakeup.gain.setValueAtTime(1, now);
    this._lastGainMatch = { aDb: 0, bDb: 0 };
  }

  public getLastGainMatch(): { aDb: number; bDb: number } {
    return this._lastGainMatch;
  }

  // ─── FIR / Linear Phase API ──────────────────────────────────────────────

  private updateGraphRouting(mode: 'iir' | 'fir' | 'hybrid') {
    if (!this.context || !this.preGain || !this.convolver) return;

    // Disconnect routing points to refresh topology safely
    try { this.preGain.disconnect(); } catch (e) {}
    try { this.convolver.disconnect(); } catch (e) {}
    
    const iirHead = this.dynamicEqNode || this.filtersA[0];

    if (mode === 'iir') {
      this.preGain.connect(iirHead);
      if (!this.dynamicEqNode && this.filtersB[0]) this.preGain.connect(this.filtersB[0]);
    } else if (mode === 'fir') {
      this.preGain.connect(this.convolver);
      this.convolver.connect(this.firGain!);
    } else if (mode === 'hybrid') {
      // Sequential configuration: fir handles bands 0-4 (with latency), feeds iir which handles 5-9 instantly.
      this.preGain.connect(this.convolver);
      this.convolver.connect(iirHead);
      if (!this.dynamicEqNode && this.filtersB[0]) this.convolver.connect(this.filtersB[0]);
    }
  }

  public setPhaseMode(mode: 'iir' | 'fir' | 'hybrid') {
    if (!this.context || !this.iirGain || !this.firGain || !this.iirDelay) return;
    this.phaseMode = mode;
    const t = this.context.currentTime;

    // Restructure the audio graph dynamically based on the mode
    this.updateGraphRouting(mode);

    if (mode === 'fir') {
      this.iirDelay.delayTime.setValueAtTime(0, t);
      this.updateFIRKernel(this.currentBands);
      this.iirGain.gain.setValueAtTime(0, t);
      this.firGain.gain.setTargetAtTime(1, t, 0.02);
    } else if (mode === 'hybrid') {
      // Since we process sequentially, we don't need independent IIR delay alignment. The entire signal delays via FIR.
      this.iirDelay.delayTime.setValueAtTime(0, t);
      this.updateFIRKernel(this.currentBands);
      this.firGain.gain.setValueAtTime(0, t); // Bypassed, output passes through IIR
      this.iirGain.gain.setTargetAtTime(1, t, 0.02);
    } else {
      this.iirDelay.delayTime.setValueAtTime(0, t);
      this.firGain.gain.setValueAtTime(0, t);
      this.iirGain.gain.setTargetAtTime(1, t, 0.02);
    }
    
    // Setting phaseMode + updating bands correctly handles the hybrid split & master gain restoration
    this.applyAllBands(this.currentBands);
  }

  public getPhaseMode() { return this.phaseMode; }

  private firUpdateScheduled = false;

  public updateFIRKernel(bands: EQBand[]) {
    if (!this.context || !this.convolver) return;
    this.currentBands = JSON.parse(JSON.stringify(bands));

    // Debounce/batch kernel updates to prevent UI stutter during rapid slider movement
    if (this.firUpdateScheduled) return;
    this.firUpdateScheduled = true;
    
    // We update on the next frame to allow multiple parameters to change in a single tick
    requestAnimationFrame(() => {
      if (!this.context || !this.convolver) {
        this.firUpdateScheduled = false;
        return;
      }

      // Combine user bands with base correction for the FIR kernel
      let targetBands = this.currentBands.map((b, i) => ({
        ...b,
        gain: b.gain + this.baseCorrectionGains[i]
      }));

      if (this.phaseMode === 'hybrid') {
        targetBands = targetBands.map((b, i) => (i < 5 ? b : { ...b, gain: 0 }));
      }

      const kernel = computeFIRKernel(targetBands, this.context.sampleRate, 2048);
      const audioBuffer = this.context.createBuffer(2, kernel.length, this.context.sampleRate);
      audioBuffer.copyToChannel(kernel as any, 0);
      audioBuffer.copyToChannel(kernel as any, 1);
      this.convolver.buffer = audioBuffer;
      
      this.firUpdateScheduled = false;
    });
  }

  public setBaseCorrection(gains: number[]) {
    if (gains.length !== 10) return;
    this.baseCorrectionGains = [...gains];
    this.applyAllBands(this.currentBands);
  }

  public getBaseCorrection() {
    return this.baseCorrectionGains;
  }

  // ─── Live EQ (chain B) ───────────────────────────────────────────────────

  public updateBandParams(index: number, params: Partial<EQBand>) {
    const f = this.filtersB[index];
    if (!f || !this.context) return;
    const t = this.context.currentTime;
    
    // Update local band representation
    this.currentBands[index] = { ...this.currentBands[index], ...params };

    // Sync to Worklet if it exists
    if (this.dynamicEqNode) {
      const isHybridMuted = this.phaseMode === 'hybrid' && index < 5;
      
      if (params.gain !== undefined) {
        let targetGain = this.enhancement.dynamicEqMaster ? params.gain : 0;
        if (isHybridMuted) targetGain = 0;
        this.dynamicEqNode.parameters.get(`gain${index}`)?.setTargetAtTime(targetGain, t, 0.01);
      }
      if (params.threshold !== undefined) this.dynamicEqNode.parameters.get(`threshold${index}`)?.setTargetAtTime(params.threshold, t, 0.01);
      if (params.ratio !== undefined) this.dynamicEqNode.parameters.get(`ratio${index}`)?.setTargetAtTime(params.ratio, t, 0.01);
      if (params.attack !== undefined) this.dynamicEqNode.parameters.get(`attack${index}`)?.setTargetAtTime(params.attack, t, 0.01);
      if (params.release !== undefined) this.dynamicEqNode.parameters.get(`release${index}`)?.setTargetAtTime(params.release, t, 0.01);
      if (params.range !== undefined) this.dynamicEqNode.parameters.get(`range${index}`)?.setTargetAtTime(params.range, t, 0.01);
      if (params.dynEnabled !== undefined) {
        let targetEnabled = this.enhancement.dynamicEqMaster ? (params.dynEnabled ? 1 : 0) : 0;
        if (isHybridMuted) targetEnabled = 0;
        this.dynamicEqNode.parameters.get(`enabled${index}`)?.setTargetAtTime(targetEnabled, t, 0.01);
      }
      
      // Update Biquad configuration in worklet via message if freq/q/type changed
      if (params.frequency !== undefined || params.q !== undefined || params.type !== undefined) {
         this.dynamicEqNode.port.postMessage({ type: 'updateBands', bands: this.currentBands });
      }
    }

    // Traditional Biquad updates (only if Dynamic EQ master is OFF)
    let filterGain = this.enhancement.dynamicEqMaster ? 0 : (params.gain ?? this.currentBands[index].gain);

    // Apply base correction (baseline)
    filterGain += this.baseCorrectionGains[index];

    // Hybrid split logic: if hybrid mode is on, IIR chain only handles bands 5-9
    if (this.phaseMode === 'hybrid' && index < 5) {
      filterGain = 0;
    }

    if (params.type !== undefined) f.type = params.type;
    if (params.frequency !== undefined) f.frequency.setTargetAtTime(params.frequency, t, 0.01);
    f.gain.setTargetAtTime(filterGain, t, 0.01);
    if (params.q !== undefined) f.Q.setTargetAtTime(params.q, t, 0.01);

    // If FIR mode active, update kernel
    if (this.phaseMode === 'fir') {
      this.updateFIRKernel(this.currentBands);
    }

    // Overall Gain Compensation: prevent clipping when EQ is boosted
    if (this.masterGain) {
      const maxUserBoost = this.currentBands.reduce((m, b) => Math.max(m, b.gain), 0);
      const maxBaseBoost = this.baseCorrectionGains.reduce((m, g) => Math.max(m, g), 0);
      const maxPositiveGain = Math.max(maxUserBoost, maxBaseBoost);
      
      let compensationDb = 0;
      if (maxPositiveGain > 3) {
        compensationDb = -(maxPositiveGain - 3) * 0.6;
      }
      compensationDb = Math.max(-6, compensationDb); // Hard limit -6dB

      const compensationLin = Math.pow(10, compensationDb / 20);
      this.masterGain.gain.setTargetAtTime(compensationLin, t, 0.05);

      // #10: Adjust soft clipper ceiling based on estimated peaking
      const estimatedPeakBoost = maxPositiveGain - compensationDb;
      let newCeiling = -0.3;
      if (estimatedPeakBoost >= 6) newCeiling = -1.0;
      else if (estimatedPeakBoost >= 3) newCeiling = -0.5;

      if (this.softClipper && this.enhancement.outputCeiling !== newCeiling) {
        this.softClipper.curve = buildSoftClipCurve(newCeiling) as any;
        this.enhancement.outputCeiling = newCeiling;
        if (this.workletNode) {
          this.workletNode.parameters.get('ceiling')?.setTargetAtTime(newCeiling, t, 0.05);
        }
        console.log(`[AudioEngine] Soft clipper ceiling adjusted to ${newCeiling} dBFS (estimatedPeak=${estimatedPeakBoost.toFixed(1)}dB)`);
      }
    }
  }

  public updateBand(index: number, gain: number) { this.updateBandParams(index, { gain }); }
  public applyAllBands(bands: EQBand[]) { 
    bands.forEach((b, i) => this.updateBandParams(i, b)); 
  }

  // --- AI Enhancements Integration ---
  
  public getTemporalCorrection(): number[] {
    const centers = this.currentBands.map(b => b.frequency);
    return this.temporalModel.getAdaptiveEQCorrection(centers);
  }

  public morphCurrentProfile(durationMs: number = 500) {
    this.eqMorphing.startMorph(durationMs);
    const start = performance.now();
    const originalBands = JSON.parse(JSON.stringify(this.currentBands));
    
    const animate = () => {
      const now = performance.now();
      const delta = now - this.lastTime;
      this.lastTime = now;
      
      const morphed = this.eqMorphing.processMorph(delta, originalBands);
      this.applyAllBands(morphed);
      
      if (now - start < durationMs) {
        requestAnimationFrame(animate);
      }
    };
    
    this.lastTime = performance.now();
    requestAnimationFrame(animate);
  }

  public updateFrequencies(freqs: number[]) {
    if (freqs.length !== 10 || !this.context) return;
    const now = this.context.currentTime;
    for (let i = 0; i < 10; i++) {
      this.currentBands[i].frequency = freqs[i];
      if (this.filtersA[i]) this.filtersA[i].frequency.setTargetAtTime(freqs[i], now, 0.05);
      if (this.filtersB[i]) this.filtersB[i].frequency.setTargetAtTime(freqs[i], now, 0.05);
    }
    // Also update FIR kernel if in FIR mode
    if (this.phaseMode === 'fir' || this.phaseMode === 'hybrid') {
      this.updateFIRKernel(this.currentBands);
    }
  }

  private _setGainOnChain(chain: BiquadFilterNode[], index: number, gain: number) {
    const f = chain[index];
    if (f && this.context) f.gain.setTargetAtTime(gain, this.context.currentTime, 0.005);
  }

  // ─── Utility ─────────────────────────────────────────────────────────────

  public setPreAmp(dB: number) {
    if (this.preGain && this.context)
      this.preGain.gain.setTargetAtTime(Math.pow(10, dB / 20), this.context.currentTime, 0.01);
  }

  public setStereoPan(pan: number) {
    if (this.stereoPanner && this.context)
      this.stereoPanner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), this.context.currentTime, 0.02);
  }

  public async resume() {
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  public getStereoCorrelation(): number {
    if (!this.analyzerL || !this.analyzerR) return 1;
    
    const bufferL = new Float32Array(this.analyzerL.fftSize);
    const bufferR = new Float32Array(this.analyzerR.fftSize);
    
    // We use getFloatTimeDomainData for raw samples
    this.analyzerL.getFloatTimeDomainData(bufferL);
    this.analyzerR.getFloatTimeDomainData(bufferR);

    let sumL = 0, sumR = 0, sumL2 = 0, sumR2 = 0, sumLR = 0;
    const n = bufferL.length;

    for (let i = 0; i < n; i++) {
        const l = bufferL[i];
        const r = bufferR[i];
        sumL += l;
        sumR += r;
        sumL2 += l * l;
        sumR2 += r * r;
        sumLR += l * r;
    }

    const numerator = n * sumLR - sumL * sumR;
    const denominator = Math.sqrt((n * sumL2 - sumL * sumL) * (n * sumR2 - sumR * sumR));

    if (denominator === 0) return 1; // Mono or silent
    const correlation = numerator / denominator;
    
    return Math.max(-1, Math.min(1, correlation));
  }

  public getAnalyzer() { return this.analyzer; }
  public getAnalyzerL() { return this.analyzerL; }
  public getAnalyzerR() { return this.analyzerR; }
  public setMasterVolume(v: number) { 
    if (this.masterGain && this.context) {
      this.masterGain.gain.setTargetAtTime(v, this.context.currentTime, 0.05); 
    }
  }

  public async crossfade(newUrl: string, audioEl: HTMLAudioElement, seekTime?: number): Promise<void> {
    if (!this.masterGain || !this.context) return;
    
    // Fade out
    const startVol = this.masterGain.gain.value;
    this.masterGain.gain.setValueAtTime(startVol, this.context.currentTime);
    this.masterGain.gain.linearRampToValueAtTime(0.01, this.context.currentTime + 0.3);
    
    await new Promise(r => setTimeout(r, 300));
    
    audioEl.src = newUrl;
    audioEl.crossOrigin = newUrl.startsWith('blob:') ? null : 'anonymous';
    audioEl.load();
    
    await new Promise<void>((resolve) => {
      const done = () => { audioEl.removeEventListener('canplay', done); resolve(); };
      audioEl.addEventListener('canplay', done, { once: true });
      setTimeout(done, 1500);
    });
    
    if (seekTime !== undefined && isFinite(seekTime)) {
      audioEl.currentTime = seekTime;
    }
    
    try {
      await audioEl.play();
    } catch(e) {}
    
    // Fade in
    this.masterGain.gain.setValueAtTime(0.01, this.context.currentTime);
    this.masterGain.gain.linearRampToValueAtTime(startVol, this.context.currentTime + 0.5);
  }
  public isInABMode() { return this.isABMode; }
  public getActiveChain() { return this.activeChain; }

  public getFloatFrequencyData(): Float32Array | null {
    if (!this.analyzerFloat || !this.floatBuffer) return null;
    this.analyzerFloat.getFloatFrequencyData(this.floatBuffer as any);
    return this.floatBuffer;
  }

  public getGainReduction(): number {
    return this.compressor?.reduction ?? 0;
  }

  // ─── Advanced Spectral Metrics ─────────────────────────────────────────

  public getSpectralFlatness(): number {
    if (!this.analyzerFloat || !this.floatBuffer) return 0;
    this.analyzerFloat.getFloatFrequencyData(this.floatBuffer as any);
    return spectralFlatnessFromDb(this.floatBuffer);
  }

  public getCrestFactorDb(): number {
    if (!this.analyzerFloat || !this.timeDomainBuffer) return 0;
    this.analyzerFloat.getFloatTimeDomainData(this.timeDomainBuffer as any);
    return crestFactorDb(this.timeDomainBuffer);
  }

  public findTonalPeaks(opts: {
    maxPeaks?: number;
    minProminenceDb?: number;
    minHeightDb?: number;
    minSpacingBins?: number;
    filterHarmonics?: boolean;
    minTonality?: number;
  } = {}): Array<{ freqHz: number; magnitudeDb: number; prominenceDb: number; tonality: number }> {
    if (!this.analyzerFloat || !this.floatBuffer || !this.context) return [];
    this.analyzerFloat.getFloatFrequencyData(this.floatBuffer as any);
    const rawMax = Math.max(opts.maxPeaks ?? 6, 12);
    let peaks: PeakInfo[] = findPeaksParabolic(this.floatBuffer, {
      maxPeaks: rawMax,
      minProminence: opts.minProminenceDb ?? 6,
      minHeight: opts.minHeightDb ?? -60,
      minDistanceBins: opts.minSpacingBins ?? 4,
    });
    const N = this.floatBuffer.length;
    const power = new Float64Array(N);
    // Performance: Math.exp(x * 0.23025850929940456) => 10^(x/10)
    for (let i = 0; i < N; i++) power[i] = Math.exp(this.floatBuffer[i] * 0.23025850929940456);
    const tonalityArr = tonalityFromBandFlatness(power, 8);
    const minTon = opts.minTonality ?? 0.4;
    const fftSize = this.analyzerFloat?.fftSize ?? 2048;
    const sr = this.context?.sampleRate ?? 44100;
    const peaksWithTon = peaks.map((p) => ({ 
      ...p, 
      tonality: tonalityArr[p.index] ?? 0,
      freqHz: binToHz(p.interpolatedIndex, fftSize, sr)
    }))
      .filter((p) => p.tonality >= minTon);
    const filtered = (opts.filterHarmonics ?? true)
      ? filterHarmonicPeaks(peaksWithTon).map((p) => ({ ...p, tonality: tonalityArr[p.index] ?? 0 }))
      : peaksWithTon;
    const corr = magnitudeCorrectionDb('hann');
    return filtered.slice(0, opts.maxPeaks ?? 6).map((p) => ({
      freqHz: p.freqHz,
      magnitudeDb: p.magnitude + corr,
      prominenceDb: (p as any).prominence ?? 0,
      tonality: p.tonality,
    }));
  }

  public getAdvancedMetrics() {
    return {
      flatness: this.getSpectralFlatness(),
      crestDb: this.getCrestFactorDb(),
      peaks: this.findTonalPeaks({ maxPeaks: 4 }),
      gainReductionDb: this.getGainReduction(),
      stereoCorrelation: this.getStereoCorrelation(),
      phaseCoherence: this.getPhaseCoherenceSpectrum(),
    };
  }

  public getPhaseCoherenceSpectrum(): number[] {
    if (!this.analyzerL || !this.analyzerR) return [];
    
    // We need time domain buffers for both channels to perform a cross-FFT
    const bufferL = new Float32Array(this.analyzerL.fftSize);
    const bufferR = new Float32Array(this.analyzerR.fftSize);
    
    this.analyzerL.getFloatTimeDomainData(bufferL);
    this.analyzerR.getFloatTimeDomainData(bufferR);

    // Call math coherence helper (Magnitude Squared Coherence)
    const msc = Array.from(coherence(bufferL, bufferR)) as number[];
    
    // Average into 10 bands for visualization, or return raw
    return msc;
  }

  // ─── Adaptive EQ Analytics ────────────────────────────────────────────────
  
  public getAdaptiveFeatures(): any {
    if (!this.analyzerFloat || !this.floatBuffer || !this.timeDomainBuffer) return null;
    
    // Get fresh data
    this.analyzerFloat.getFloatFrequencyData(this.floatBuffer as any);
    this.analyzerFloat.getFloatTimeDomainData(this.timeDomainBuffer as any);
    
    const bins = this.floatBuffer.length;
    const sr = this.context!.sampleRate;
    
    // spectral_centroid
    let num = 0, den = 0;
    // Fast path: Math.pow(10, x / 20) -> Math.exp(x * 0.11512925464970228)
    for (let i = 0; i < bins; i++) {
      const mag = Math.exp(this.floatBuffer[i] * 0.11512925464970228);
      const freq = (i / bins) * (sr / 2);
      num += freq * mag;
      den += mag;
    }
    const centroid = den > 0 ? num / den : 0;
    
    // low/mid/high energy
    // low: 20-250, mid: 250-4000, high: 4000+
    let low = 0, mid = 0, high = 0;
    for (let i = 0; i < bins; i++) {
       const freq = (i / bins) * (sr / 2);
       const mag = Math.exp(this.floatBuffer[i] * 0.11512925464970228);
       if (freq < 250) low += mag * mag;
       else if (freq < 4000) mid += mag * mag;
       else high += mag * mag;
    }

    const crest = crestFactorDb(this.timeDomainBuffer);

    return {
      lowEnergy: 10 * Math.log10(Math.max(1e-10, low)),
      midEnergy: 10 * Math.log10(Math.max(1e-10, mid)),
      highEnergy: 10 * Math.log10(Math.max(1e-10, high)),
      spectralCentroid: centroid,
      dynamicRange: crest,
      isMuddy: (10 * Math.log10(Math.max(1e-10, low)) - 10 * Math.log10(Math.max(1e-10, mid))) > 15,
      isHarsh: centroid > 6000 || (10 * Math.log10(Math.max(1e-10, high)) > 10 * Math.log10(Math.max(1e-10, mid)) + 10),
      isThin: 10 * Math.log10(Math.max(1e-10, low)) < -50 && 10 * Math.log10(Math.max(1e-10, mid)) > -40,
    };
  }

  public getAdaptiveContext(sectionType: 'intro'|'verse'|'chorus'|'drop'|'outro' = 'verse'): any {
    const features = this.getAdaptiveFeatures();
    if (!features) return null;
    
    // Simple heuristic for bass energy mapping
    const bassEnergyNorm = Math.min(1, Math.max(0, (features.lowEnergy + 60) / 40));

    return {
      sectionType,
      bassEnergy: bassEnergyNorm,
      loudness: this._shortTermLoudness
    };
  }

  /**
   * Returns an 8-dimensional track fingerprint based on long-term spectral features.
   * [sub, bass, low-mid, mids, highs, centroid, flatness, crest]
   */
  public getTrackFingerprint(): number[] {
    if (!this.analyzerFloat || !this.floatBuffer || !this.timeDomainBuffer) return new Array(8).fill(0.5);

    this.analyzerFloat.getFloatFrequencyData(this.floatBuffer as any);
    this.analyzerFloat.getFloatTimeDomainData(this.timeDomainBuffer as any);

    const bins = this.floatBuffer.length;
    const sr = this.context!.sampleRate;

    // Energy bands
    const buf = this.floatBuffer;
    const getBandEnergy = (fStart: number, fEnd: number) => {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < bins; i++) {
        const f = (i / bins) * (sr / 2);
        if (f >= fStart && f < fEnd) {
          sum += Math.exp(buf[i] * 0.11512925464970228);
          count++;
        }
      }
      return count > 0 ? sum / count : 0;
    };

    const sub = getBandEnergy(20, 60);
    const bass = getBandEnergy(60, 250);
    const lowMid = getBandEnergy(250, 1000);
    const mids = getBandEnergy(1000, 4000);
    const highs = getBandEnergy(4000, 16000);

    const centroid = this.getAdaptiveFeatures().spectralCentroid;
    const flatness = this.getSpectralFlatness();
    const crest = this.getCrestFactorDb();

    // Normalization to 0..1 roughly
    return [
      Math.min(1, Math.max(0, (20 * Math.log10(sub + 1e-10) + 60) / 40)),
      Math.min(1, Math.max(0, (20 * Math.log10(bass + 1e-10) + 60) / 40)),
      Math.min(1, Math.max(0, (20 * Math.log10(lowMid + 1e-10) + 60) / 40)),
      Math.min(1, Math.max(0, (20 * Math.log10(mids + 1e-10) + 60) / 40)),
      Math.min(1, Math.max(0, (20 * Math.log10(highs + 1e-10) + 60) / 40)),
      Math.min(1, Math.max(0, centroid / 10000)),
      Math.min(1, Math.max(0, flatness)),
      Math.min(1, Math.max(0, (crest - 6) / 12))
    ];
  }

  public computeDynamicEQFrequencies(fingerprint: number[]): number[] {
    // fingerprint: [sub, bass, low-mid, mids, highs, centroid (normalized), flatness, crest]
    const centroidFreq = fingerprint[5] * 10000;
    
    // Base frequencies standard
    const baseFreqs = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    
    const shifted = baseFreqs.map((f, i) => {
      let scale = 1.0;
      
      // Shift low bands based on sub/bass energy ratio
      if (i <= 2) {
        if (fingerprint[1] > fingerprint[0] * 1.5) scale = 1.15; // Shift up if mid-bass heavy
        if (fingerprint[0] > fingerprint[1] * 1.5) scale = 0.85; // Shift down if sub heavy
      } 
      // Shift mids around centroid
      else if (i >= 3 && i <= 6) {
        // Pull mids towards centroid slightly
        if (centroidFreq > 100) {
          const dist = Math.log2(centroidFreq / f);
          scale = Math.pow(2, dist * 0.1); 
        }
      }
      // Shift highs based on brightness (crest factor and highs energy)
      else {
        if (fingerprint[4] > 0.7 && fingerprint[7] > 0.6) scale = 1.1; // Shift up to target "air"
        else if (fingerprint[4] < 0.3) scale = 0.9;
      }
      
      // Constrain shifts to +/- 20%
      scale = Math.max(0.8, Math.min(1.2, scale));
      
      return Math.round(f * scale);
    });
    
    // Ensure monotonicity and bounds checking
    for (let i=1; i<shifted.length; i++) {
      if (shifted[i] <= shifted[i-1]) {
        shifted[i] = Math.round(shifted[i-1] * 1.2);
      }
    }
    shifted[0] = Math.max(20, shifted[0]);
    shifted[shifted.length - 1] = Math.min(20000, shifted[shifted.length - 1]);
    
    return shifted;
  }

  public classifyTrackCharacter(energies: number[], fingerprint: number[]): TrackCharacter {
    const sub = fingerprint[0];
    const bass = fingerprint[1];
    const lowMid = fingerprint[2];
    const mids = fingerprint[3];
    const highs = fingerprint[4];
    const centroid = fingerprint[5] * 10000;
    const flatness = fingerprint[6];
    const crest = fingerprint[7] * 12 + 6;

    const subBassStrong = energies[0] > -40;
    const bassStrong = energies[1] > -35 || energies[2] > -35;
    const brightAir = centroid > 6000 || highs > 0.6;
    const dynamicWide = crest > 14;
    const tonal = flatness < 0.15;

    let genre: TrackCharacter['genre'] = 'balanced';
    if ((sub + bass) > 2 * highs && centroid < 3000) {
      genre = 'bass-heavy';
    } else if (highs > lowMid && centroid > 6000 && flatness > 0.3) {
      genre = 'bright-electronic';
    } else if (tonal && crest > 14 && !subBassStrong && centroid > 2000 && centroid < 5000) {
      genre = 'acoustic';
    } else if ((lowMid + mids) > 1.2 && !subBassStrong) { // Heuristic for mids dominance
      genre = 'vocal-mid';
    }

    return { subBassStrong, bassStrong, brightAir, dynamicWide, tonal, genre };
  }

  // ─── Spectral Segment Finder ─────────────────────────────────────────────

  private _bandEnergy(seg: Float32Array, sr: number, fLow: number, fHigh: number): number {
    const N = seg.length;
    // v4.5: Use a more robust energy estimate using a windowed FFT surrogate or 
    // Goertzel-like probe at the geometric center of the band for better speed/precision.
    const fCenter = Math.sqrt(fLow * fHigh);
    const omega = (2 * Math.PI * fCenter) / sr;
    
    // We use a subset of samples to speed up analysis without losing too much precision
    const stride = N > 1024 ? 4 : 1;
    let re = 0, im = 0;
    let count = 0;
    
    for (let n = 0; n < N; n += stride) {
      // Apply a simple Hann window for better frequency selectivity
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
      const s = seg[n] * w;
      re += s * Math.cos(omega * n);
      im -= s * Math.sin(omega * n);
      count++;
    }
    
    return (re * re + im * im) / (count * count);
  }

  private _peakWindowForBand(ch: Float32Array, sr: number, dur: number, fLow: number, fHigh: number): number {
    const ws = Math.floor(sr * 1.5); // 1.5s window for better stability
    const step = Math.floor(sr * 0.5);
    const energies: number[] = [];
    let best = dur * 0.2;
    let bestIdx = 0;
    let maxE = -Infinity;
    
    for (let i = 0; i + ws < ch.length; i += step) {
      const seg = ch.subarray(i, i + ws);
      const e = this._bandEnergy(seg, sr, fLow, fHigh);
      energies.push(e);
      if (e > maxE) { 
        maxE = e; 
        best = i / sr; 
        bestIdx = energies.length - 1; 
      }
    }
    
    // Parabolic interpolation for sub-step accuracy
    if (bestIdx > 0 && bestIdx < energies.length - 1) {
      const res = parabolicInterpolate(energies[bestIdx - 1], energies[bestIdx], energies[bestIdx + 1]);
      if (res) {
        best += (res.delta * step) / sr;
      }
      best = Math.max(0, Math.min(dur - 1.5, best));
    }
    
    return best;
  }

  private _sceneCache = new Map<string, Record<string, number>>();
  private _sceneInflight = new Map<string, Promise<Record<string, number>>>();
  private _audioBufferCache = new Map<string, AudioBuffer>();
  private _audioBufferInflight = new Map<string, Promise<AudioBuffer>>();

  public clearSceneCache(): void {
    this._sceneCache.clear();
    this._audioBufferCache.clear();
  }

  private async _getDecodedBuffer(audioUrl: string): Promise<AudioBuffer> {
    const cached = this._audioBufferCache.get(audioUrl);
    if (cached) return cached;
    const inflight = this._audioBufferInflight.get(audioUrl);
    if (inflight) return inflight;
    const job = (async () => {
      try {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error(`Fetch failed for ${audioUrl}: ${response.status} ${response.statusText}`);
        const buf = await response.arrayBuffer();
        const decoded = await this.context!.decodeAudioData(buf);
        this._audioBufferCache.set(audioUrl, decoded);
        return decoded;
      } finally {
        this._audioBufferInflight.delete(audioUrl);
      }
    })();
    this._audioBufferInflight.set(audioUrl, job);
    return job;
  }

  public async measureLufsForGains(audioUrl: string, gains: number[], seekSec: number, durationSec = 3): Promise<number> {
    if (!this.context) return -Infinity;
    const buf = await this._getDecodedBuffer(audioUrl);
    const sr = buf.sampleRate;
    const startSample = Math.max(0, Math.floor(seekSec * sr));
    const endSample = Math.min(buf.length, startSample + Math.floor(durationSec * sr));
    const len = endSample - startSample;
    if (len < sr * 0.4) return -Infinity;
    const offline = new OfflineAudioContext(1, len, sr);
    const slicedBuf = offline.createBuffer(1, len, sr);
    slicedBuf.copyToChannel(buf.getChannelData(0).slice(startSample, endSample), 0);
    const source = offline.createBufferSource();
    source.buffer = slicedBuf;
    let last: AudioNode = source;
    for (let i = 0; i < DEFAULT_BANDS.length; i++) {
      const f = offline.createBiquadFilter();
      f.type = DEFAULT_BANDS[i].type;
      f.frequency.value = DEFAULT_BANDS[i].frequency;
      f.gain.value = gains[i] ?? 0;
      f.Q.value = DEFAULT_BANDS[i].q;
      last.connect(f);
      last = f;
    }
    last.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return integratedLufs(rendered.getChannelData(0), sr);
  }

  public async gainMatchAB(audioUrl: string, scenarioId: string, seekSec: number, durationSec = 6): Promise<{ aDb: number; bDb: number }> {
    const ab = AB_PREVIEW_GAINS[scenarioId];
    if (!ab || !this.context || !this.gainAMakeup || !this.gainBMakeup) return { aDb: 0, bDb: 0 };
    
    // 1. Measure LUFS with longer window (6s)
    const [lufsA, lufsB] = await Promise.all([
      this.measureLufsForGains(audioUrl, ab.A, seekSec, durationSec),
      this.measureLufsForGains(audioUrl, ab.B, seekSec, durationSec),
    ]);
    if (!Number.isFinite(lufsA) || !Number.isFinite(lufsB)) {
      this._lastGainMatch = { aDb: 0, bDb: 0 };
      return this._lastGainMatch;
    }

    // 2. Use average as target to avoid "louder is better" bias
    const target = (lufsA + lufsB) / 2;
    const aDb = target - lufsA;
    const bDb = target - lufsB;
    const t = this.context.currentTime;
    
    this.gainAMakeup.gain.setTargetAtTime(Math.pow(10, aDb / 20), t, 0.01);
    this.gainBMakeup.gain.setTargetAtTime(Math.pow(10, bDb / 20), t, 0.01);
    this._lastGainMatch = { aDb, bDb };

    // 3. Optional verification: Short 1s window at seek point
    setTimeout(async () => {
      const [vA, vB] = await Promise.all([
        this.measureLufsForGains(audioUrl, ab.A.map((g, i) => g + aDb), seekSec, 1.0),
        this.measureLufsForGains(audioUrl, ab.B.map((g, i) => g + bDb), seekSec, 1.0)
      ]);
      if (Math.abs(vA - vB) > 0.5) {
        console.warn(`[AudioEngine] LUFS mismatch at seek point: A=${vA.toFixed(1)}, B=${vB.toFixed(1)} delta=${Math.abs(vA - vB).toFixed(1)}`);
      }
    }, 100);

    return this._lastGainMatch;
  }

  public async findCalibrationSegments(audioUrl: string): Promise<Record<string, { time: number; type: 'high' | 'low' | 'neutral' }>> {
    const cached = this._sceneCache.get(audioUrl) as any;
    if (cached) return cached;
    const inflight = this._sceneInflight.get(audioUrl) as any;
    if (inflight) return inflight;
    const job = (async () => {
      try {
        const audio = await this._getDecodedBuffer(audioUrl);
        const dur = audio.duration;
        const sr = audio.sampleRate;
        const ch = audio.getChannelData(0);
        const minF = 20, maxF = sr / 2;
        const logMin = Math.log10(minF), logMax = Math.log10(maxF);
        const bw = (logMax - logMin) / 10;
        const bandEdges = Array.from({ length: 11 }, (_, i) => Math.pow(10, logMin + i * bw));
        
        const peak = (band: number) => this._peakWindowForBand(ch, sr, dur, bandEdges[band], bandEdges[band + 1]);
        
        // Define energy types for scenarios
        // 40% high (bass focused), 40% low (mid focused), 20% neutral
        const result: Record<string, { time: number; type: 'high' | 'low' | 'neutral' }> = {
          sub_bass:        { time: peak(0), type: 'high' },
          bass_depth:      { time: peak(1), type: 'high' },
          mid_punch:       { time: peak(2), type: 'high' },
          warmth_body:     { time: peak(3), type: 'low' },
          vocal_clarity:   { time: peak(4), type: 'low' },
          instrument_sep:  { time: peak(5), type: 'low' },
          presence:        { time: peak(6), type: 'low' },
          high_frequency:  { time: peak(7), type: 'neutral' },
          sibilance:       { time: peak(8), type: 'neutral' },
          overall_balance: { time: dur * 0.50, type: 'neutral' },
          sub_mid_blend:   { time: peak(1), type: 'high' },
          high_air_only:   { time: peak(9), type: 'neutral' },
          warmth_no_mud:   { time: peak(3), type: 'low' },
          presence_no_harshness: { time: peak(6), type: 'low' },
        };
        
        this._sceneCache.set(audioUrl, result as any);
        return result;
      } catch (e) {
        console.warn('Scene analysis failed', e);
        return { 
          bass_depth: { time: 15, type: 'high' }, 
          vocal_clarity: { time: 30, type: 'low' }, 
          high_frequency: { time: 45, type: 'neutral' } 
        } as any;
      } finally {
        this._sceneInflight.delete(audioUrl);
      }
    })();
    this._sceneInflight.set(audioUrl, job);
    return job;
  }

  public async getTrackFingerprintOffline(audioUrl: string): Promise<number[]> {
    try {
      const buf = await this._getDecodedBuffer(audioUrl);
      const ch = buf.getChannelData(0);
      const sr = buf.sampleRate;
      
      // Phase 1.1 Update: Use Welch's Method for high resolution / low-noise spectral estimation
      const { WelchAnalyzer } = await import('./math/spectral-enhancement');
      const analyzer = new WelchAnalyzer(sr, {
        nfft: 4096,
        windowType: 'blackmanHarris',
        overlapPercent: 75,
        avgMethod: 'median',
        prewhiten: true,
        maxSegments: 40
      });

      // Analyze middle 5 seconds for robust signature
      const durationSamples = Math.min(ch.length, Math.floor(sr * 5));
      const mid = Math.floor(ch.length * 0.5);
      const start = Math.max(0, mid - durationSamples / 2);
      const segment = ch.slice(start, start + durationSamples);
      
      const result = analyzer.analyze(new Float32Array(segment));
      
      // Calculate energy in 5 psychoacoustic bands from Welch result
      const getBandPower = (fStart: number, fEnd: number) => {
        let sum = 0;
        let count = 0;
        for (let i = 0; i < result.frequencies.length; i++) {
          const f = result.frequencies[i];
          if (f >= fStart && f < fEnd) {
            sum += Math.pow(10, result.powerDb[i] / 10);
            count++;
          }
        }
        return count > 0 ? sum / count : 0;
      };

      const sub = getBandPower(20, 60);
      const bass = getBandPower(60, 250);
      const lowMid = getBandPower(250, 1000);
      const mids = getBandPower(1000, 4000);
      const highs = getBandPower(4000, 16000);

      // Extract spectral centroid and flatness from higher-res Welch data
      let weightedSum = 0;
      let totalPower = 0;
      let logSum = 0;
      for (let i = 0; i < result.powerDb.length; i++) {
        const p = Math.pow(10, result.powerDb[i] / 10);
        weightedSum += result.frequencies[i] * p;
        totalPower += p;
        if (result.frequencies[i] > 20) {
          logSum += Math.log(Math.max(1e-12, p));
        }
      }
      const centroid = totalPower > 0 ? weightedSum / totalPower : 2000;
      const geomMean = Math.exp(logSum / result.powerDb.length);
      const arithMean = totalPower / result.powerDb.length;
      const flatness = arithMean > 0 ? geomMean / arithMean : 0.2;

      const crest = crestFactorDb(segment);

      return [
        Math.min(1, Math.max(0, (10 * Math.log10(Math.max(1e-12, sub)) + 60) / 40)),
        Math.min(1, Math.max(0, (10 * Math.log10(Math.max(1e-12, bass)) + 60) / 40)),
        Math.min(1, Math.max(0, (10 * Math.log10(Math.max(1e-12, lowMid)) + 60) / 40)),
        Math.min(1, Math.max(0, (10 * Math.log10(Math.max(1e-12, mids)) + 60) / 40)),
        Math.min(1, Math.max(0, (10 * Math.log10(Math.max(1e-12, highs)) + 60) / 40)),
        Math.min(1, Math.max(0, centroid / 10000)),
        Math.min(1, Math.max(0, flatness)),
        Math.min(1, Math.max(0, (crest - 6) / 12))
      ];
    } catch (e) {
      console.warn('getTrackFingerprintOffline failed', e);
      return new Array(8).fill(0.5);
    }
  }

  /**
   * Phase 1.1+1.2: Resonance Discovery
   * Finds the most dominant spectral peaks (resonances) in a buffer to allow
   * EQ bands to surgically align with the track's harmonic structure.
   */
  public async getSpectralPeaks(audioUrl: string, numPeaks = 10): Promise<number[]> {
    try {
      const buf = await this._getDecodedBuffer(audioUrl);
      const sr = buf.sampleRate;
      const ch = buf.getChannelData(0);
      
      const { WelchAnalyzer } = await import('./math/spectral-enhancement');
      const analyzer = new WelchAnalyzer(sr, {
        nfft: 8192, // High resolution for peak detection
        windowType: 'blackmanHarris',
        overlapPercent: 75,
        avgMethod: 'mean',
        prewhiten: false // Don't prewhiten, we want the actual peaks
      });

      // Analyze 3s segment
      const seg = ch.slice(0, Math.min(ch.length, Math.floor(sr * 3)));
      const result = analyzer.analyze(new Float32Array(seg));
      
      const peaks: { f: number, p: number }[] = [];
      const power = result.powerDb;
      const freqs = result.frequencies;

      // Simple peak picking with prominence
      for (let i = 2; i < power.length - 2; i++) {
        if (power[i] > power[i-1] && power[i] > power[i+1]) {
          // Verify it's a significant peak
          const localFloor = Math.min(power[i-2], power[i+2]);
          if (power[i] - localFloor > 3) { // 3dB prominence
            peaks.push({ f: freqs[i], p: power[i] });
          }
        }
      }

      // Sort by power and take top N
      peaks.sort((a, b) => b.p - a.p);
      
      const topFreqs = peaks.slice(0, numPeaks).map(p => p.f).sort((a, b) => a - b);
      
      // If we found fewer than numPeaks, fill with logarithmic distribution
      if (topFreqs.length < numPeaks) {
        const standard = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        while (topFreqs.length < numPeaks) {
          const next = standard[topFreqs.length];
          if (!topFreqs.includes(next)) topFreqs.push(next);
          topFreqs.sort((a, b) => a - b);
        }
      }

      return topFreqs.slice(0, numPeaks);
    } catch (e) {
      console.warn('getSpectralPeaks failed', e);
      return [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    }
  }

  public close() { this.context?.close(); }

  private _bandEnergyCache = new Map<string, number[]>();

  public async bandPeakEnergies(audioUrl: string): Promise<number[]> {
    const cached = this._bandEnergyCache.get(audioUrl);
    if (cached) return cached;
    if (!this.context) return new Array(10).fill(0);
    try {
      const buf = await this._getDecodedBuffer(audioUrl);
      const sr = buf.sampleRate;
      const ch = buf.getChannelData(0);
      const dur = buf.duration;
      const minF = 20, maxF = sr / 2;
      const logMin = Math.log10(minF), logMax = Math.log10(maxF);
      const bw = (logMax - logMin) / 10;
      const edges = Array.from({ length: 11 }, (_, i) => Math.pow(10, logMin + i * bw));
      const ws = Math.floor(sr * 0.75);
      const hops = 8;
      const energies = new Array(10).fill(0);
      for (let band = 0; band < 10; band++) {
        let peak = 0;
        for (let h = 0; h < hops; h++) {
          const start = Math.floor((dur * 0.05 + (dur * 0.9) * (h / hops)) * sr);
          if (start + ws >= ch.length) continue;
          const seg = ch.subarray(start, start + ws);
          const e = this._bandEnergy(seg, sr, edges[band], edges[band + 1]);
          if (e > peak) peak = e;
        }
        energies[band] = peak;
      }
      this._bandEnergyCache.set(audioUrl, energies);
      return energies;
    } catch (e) {
      console.warn('bandPeakEnergies failed', e);
      return new Array(10).fill(0);
    }
  }
}
