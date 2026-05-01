/**
 * SONIC — Psychoacoustic Scales and Models
 */

/** Traunmüller 1990 Hz↔Bark formula. */
export function hzToBark(f: number): number {
  return (26.81 * f) / (1960 + f) - 0.53;
}
export function barkToHz(b: number): number {
  return 1960 * (b + 0.53) / (26.28 - b);
}

/** Glasberg-Moore 1990 ERB scale. */
export function hzToErb(f: number): number {
  return 21.4 * Math.log10(0.00437 * f + 1);
}
export function erbToHz(e: number): number {
  return (Math.pow(10, e / 21.4) - 1) / 0.00437;
}

/** Equivalent Rectangular Bandwidth at frequency f (Glasberg-Moore). */
export function erbBandwidth(f: number): number {
  return 24.7 * (4.37e-3 * f + 1);
}

/** Generate N band centre frequencies equally spaced on the ERB scale. */
export function erbBandCentres(n: number, minHz = 20, maxHz = 20000): number[] {
  const eMin = hzToErb(minHz), eMax = hzToErb(maxHz);
  const step = (eMax - eMin) / (n - 1);
  return Array.from({ length: n }, (_, i) => erbToHz(eMin + i * step));
}

// ─── ISO 226-2003 Equal-Loudness Contour ────────────────────────────────────

const ISO226_FREQS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
  630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500
];
const ISO226_AF = [
  0.532, 0.506, 0.480, 0.455, 0.432, 0.409, 0.387, 0.367, 0.349, 0.330, 0.315,
  0.301, 0.288, 0.276, 0.267, 0.259, 0.253, 0.250, 0.246, 0.244, 0.243, 0.243,
  0.243, 0.242, 0.242, 0.245, 0.254, 0.271, 0.301
];
const ISO226_LU = [
  -31.6, -27.2, -23.0, -19.1, -15.9, -13.0, -10.3, -8.1, -6.2, -4.5, -3.1,
  -2.0, -1.1, -0.4,  0.0,  0.3,  0.5,  0.0, -2.7, -4.1, -1.0,  1.7,  2.5,
  1.2, -2.1, -7.1, -11.2, -10.7, -3.1
];
const ISO226_TF = [
  78.5, 68.7, 59.5, 51.1, 44.0, 37.5, 31.5, 26.5, 22.1, 17.9, 14.4,
  11.4,  8.6,  6.2,  4.4,  3.0,  2.2,  2.4,  3.5,  1.7, -1.3, -4.2,
  -6.0, -5.4, -1.5,  6.0, 12.6, 13.9, 12.3
];

function logInterp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  const lx = Math.log10(x);
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] >= x) {
      const lx0 = Math.log10(xs[i - 1]), lx1 = Math.log10(xs[i]);
      const t = (lx - lx0) / (lx1 - lx0);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

export function equalLoudnessSpl(frequencyHz: number, phon = 60): number {
  const af = logInterp(ISO226_FREQS, ISO226_AF, frequencyHz);
  const Lu = logInterp(ISO226_FREQS, ISO226_LU, frequencyHz);
  const Tf = logInterp(ISO226_FREQS, ISO226_TF, frequencyHz);
  const Af = 4.47e-3 * (Math.pow(10, 0.025 * phon) - 1.15)
            + Math.pow(0.4 * Math.pow(10, (Tf + Lu) / 10 - 9), af);
  return (10 / af) * Math.log10(Af) - Lu + 94;
}

export function equalLoudnessWeights(frequencies: number[], phon = 60): number[] {
  const ref = equalLoudnessSpl(1000, phon);
  return frequencies.map((f) => ref - equalLoudnessSpl(f, phon));
}

export function phonFromLufs(lufs: number): number {
  return Math.max(20, Math.min(90, 65 + (lufs + 23) * 0.8));
}

export function adaptiveEqualLoudnessWeights(
  frequencies: number[],
  measuredLufs: number
): number[] {
  const phon = phonFromLufs(measuredLufs);
  return equalLoudnessWeights(frequencies, phon);
}

// ─── Schroeder Spreading Function ───────────────────────────────────────────

export function schroederSpread(deltaBark: number): number {
  const b = deltaBark + 0.474;
  const raw = 15.81 + 7.5 * b - 17.5 * Math.sqrt(1 + b * b);
  return Math.max(raw, -80);
}

import { spectralFlatnessFromDb } from './signal';

export function maskingThreshold(
  bandFreqsHz: number[],
  bandLevelsDb: number[]
): number[] {
  const barks = bandFreqsHz.map(hzToBark);
  return barks.map((bj) => {
    let best = -Infinity;
    for (let i = 0; i < barks.length; i++) {
      const t = bandLevelsDb[i] + schroederSpread(bj - barks[i]);
      if (t > best) best = t;
    }
    return best;
  });
}

export function applyAcousticMasking(
  gains: number[],
  levels: number[],
  freqs: number[]
): number[] {
  const threshold = maskingThreshold(freqs, levels);

  return gains.map((g, i) => {
    const currentLevel = levels[i] + g;
    const headroom = threshold[i] - currentLevel; // dương = bị masked

    if (headroom <= 0) return g; // không bị masked

    // Attenuation smooth: 0 dB khi ở ngưỡng, giảm dần khi sâu hơn ngưỡng
    // Dựa trên mô hình Zwicker: masking slope ~24 dB/Bark
    // Đơn giản hóa: factor = exp(-headroom / 12) — giảm 12 dB mỗi 12 dB headroom
    const attenuationFactor = Math.exp(-headroom / 12);
    return g * attenuationFactor;
  });
}

export function tonalityFromBandFlatness(
  power: ArrayLike<number>,
  numBands = 8
): number[] {
  //sfm = spectral flatness measure. SFM = Geometric Mean / Arithmetic Mean.
  // SFM is 0 for pure tone, 1 for white noise.
  // Tonality alpha = max(0, min(1, -10 log10(sfm) / 60)) or similar.
  const n = power.length;
  const bandSize = Math.floor(n / numBands);
  const out = new Array(n).fill(0);

  for (let b = 0; b < numBands; b++) {
    const start = b * bandSize;
    const end = (b + 1) * bandSize;
    let sum = 0;
    let sumLog = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      const v = Math.max(1e-12, power[i]);
      sum += v;
      sumLog += Math.log(v);
      count++;
    }
    const am = sum / count;
    const gm = Math.exp(sumLog / count);
    const sfm = gm / am;
    const tonality = Math.max(0, Math.min(1, 1 - sfm));
    for (let i = start; i < end; i++) out[i] = tonality;
  }
  return out;
}

interface Peak { freqHz: number; magnitude: number; [key: string]: any; }

export function filterHarmonicPeaks(
  peaks: Peak[],
  opts: { toleranceCents?: number; minRatio?: number } = {}
): Peak[] {
  const toleranceCents = opts.toleranceCents ?? 50; // ±50 cents
  const minRatio = opts.minRatio ?? 0.8;            // harmonic phải < 80% fundamental để bị lọc

  if (peaks.length === 0) return [];

  // Sắp xếp theo magnitude giảm dần
  const sorted = [...peaks].sort((a, b) => b.magnitude - a.magnitude);
  const kept: Peak[] = [];

  for (const peak of sorted) {
    // Kiểm tra peak này có phải harmonic của một peak đã giữ không
    const isHarmonic = kept.some((fundamental) => {
      for (let r = 2; r <= 8; r++) {
        const expectedHz = fundamental.freqHz * r;
        const centsOff = 1200 * Math.log2(peak.freqHz / expectedHz);
        if (Math.abs(centsOff) < toleranceCents) {
          // Chỉ loại nếu harmonic yếu hơn so với fundamental
          return peak.magnitude <= fundamental.magnitude * minRatio;
        }
      }
      return false;
    });
    if (!isHarmonic) kept.push(peak);
  }

  return kept.sort((a, b) => a.freqHz - b.freqHz);
}

import { fftInPlace } from './fft';

export function coherence(
  a: Float32Array | number[],
  b: Float32Array | number[],
  fftSize = 512
): number[] {
  const n = Math.min(a.length, b.length, fftSize);
  const N = Math.min(n, fftSize);

  const reA = new Float64Array(N), imA = new Float64Array(N);
  const reB = new Float64Array(N), imB = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    reA[i] = a[i]; reB[i] = b[i];
  }

  fftInPlace(reA, imA);
  fftInPlace(reB, imB);

  const halfN = (N >> 1) + 1;
  const out = new Array(halfN);
  for (let k = 0; k < halfN; k++) {
    // Cross-spectral density: Sxy = A* · B
    const crossR = reA[k] * reB[k] + imA[k] * imB[k];
    const crossI = reA[k] * imB[k] - imA[k] * reB[k];
    const Sxy2 = crossR * crossR + crossI * crossI;
    const Sxx = reA[k] * reA[k] + imA[k] * imA[k];
    const Syy = reB[k] * reB[k] + imB[k] * imB[k];
    const denom = Sxx * Syy;
    out[k] = denom < 1e-20 ? 0 : Sxy2 / denom; // MSC ∈ [0, 1]
  }
  return out;
}
