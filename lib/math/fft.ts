/**
 * SONIC — FFT and Windowing
 */

export type WindowType = 'rect' | 'hann' | 'hamming' | 'blackman' | 'flattop';

const WINDOW_PARAMS: Record<WindowType, { coherentGain: number; enbw: number }> = {
  rect:     { coherentGain: 1.000, enbw: 1.000 },
  hann:     { coherentGain: 0.500, enbw: 1.500 },
  hamming:  { coherentGain: 0.540, enbw: 1.363 },
  blackman: { coherentGain: 0.420, enbw: 1.727 },
  flattop:  { coherentGain: 0.215, enbw: 3.770 },
};

/** Generate a window of the requested type, length N. */
export function makeWindow(type: WindowType, N: number): Float32Array {
  const w = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const t = n / (N - 1);
    switch (type) {
      case 'rect':     w[n] = 1; break;
      case 'hann':     w[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * t); break;
      case 'hamming':  w[n] = 0.54 - 0.46 * Math.cos(2 * Math.PI * t); break;
      case 'blackman': w[n] = 0.42 - 0.5 * Math.cos(2 * Math.PI * t)
                              + 0.08 * Math.cos(4 * Math.PI * t); break;
      case 'flattop':  w[n] = 0.21557895 - 0.41663158 * Math.cos(2 * Math.PI * t)
                              + 0.277263158 * Math.cos(4 * Math.PI * t)
                              - 0.083578947 * Math.cos(6 * Math.PI * t)
                              + 0.006947368 * Math.cos(8 * Math.PI * t); break;
    }
  }
  return w;
}

/**
 * Single dB correction to convert AnalyserNode-style magnitudes into
 * "peak amplitude of a pure tone" — the figure most people expect.
 */
export function magnitudeCorrectionDb(window: WindowType): number {
  const w = WINDOW_PARAMS[window];
  return 20 * Math.log10(1 / w.coherentGain) - 10 * Math.log10(w.enbw);
}

export function enbwBins(window: WindowType): number {
  return WINDOW_PARAMS[window].enbw;
}

// DSP-01: Precomputed twiddle factor cache.
// Eliminates ~2.6M Math.cos/sin calls/sec at 60fps stereo.
// Lazily built per FFT size N; each entry stores the full table
// for all butterfly passes (N/2 complex entries, covering all sizes).
const _twiddleCache = new Map<number, { re: Float64Array; im: Float64Array }>();

function _getTwiddle(N: number): { re: Float64Array; im: Float64Array } {
  if (_twiddleCache.has(N)) return _twiddleCache.get(N)!;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const angle = -2 * Math.PI * i / N;
    re[i] = Math.cos(angle);
    im[i] = Math.sin(angle);
  }
  _twiddleCache.set(N, { re, im });
  return { re, im };
}

/**
 * In-place radix-2 Cooley-Tukey FFT.
 *   re, im — Float64Array of length N (power of two)
 *
 * DSP-01: trig values are now read from a precomputed twiddle table
 * (cached per N), reducing cost from ~40 ns/call to ~2 ns/access.
 */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const N = re.length;
  if (N <= 1) return;
  if ((N & (N - 1)) !== 0) throw new Error(`fftInPlace: N=${N} is not a power of 2`);

  const twiddle = _getTwiddle(N);
  const twRe = twiddle.re;
  const twIm = twiddle.im;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterflies — twiddle index for size/2 group is (k * N/size)
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const stride = N / size; // distance between twiddle entries for this stage
    for (let i = 0; i < N; i += size) {
      for (let j = 0; j < half; j++) {
        const twIdx = j * stride;
        const wr = twRe[twIdx];
        const wi = twIm[twIdx];
        const tr = wr * re[i + j + half] - wi * im[i + j + half];
        const ti = wr * im[i + j + half] + wi * re[i + j + half];
        re[i + j + half] = re[i + j] - tr;
        im[i + j + half] = im[i + j] - ti;
        re[i + j] += tr;
        im[i + j] += ti;
      }
    }
  }
}

/** In-place inverse FFT. */
export function ifftInPlace(re: Float64Array, im: Float64Array): void {
  const N = re.length;
  for (let i = 0; i < N; i++) im[i] = -im[i]; // Conjugate
  fftInPlace(re, im);
  for (let i = 0; i < N; i++) {
    re[i] /= N;
    im[i] = -im[i] / N; // Conjugate and scale
  }
}

export function binToHz(bin: number, fftSize: number, sampleRate: number): number {
  return (bin * sampleRate) / fftSize;
}

export interface WelchOptions {
  fftSize?: number;
  overlap?: number;
  window?: WindowType;
  detrend?: boolean;
}

export function welchPSD(
  signal: ArrayLike<number>,
  options: WelchOptions = {}
): { psd: Float64Array; segmentCount: number } {
  const N = options.fftSize ?? 1024;
  const overlap = options.overlap ?? 0.5;
  const winType = options.window ?? 'hann';
  const detrend = options.detrend ?? true;

  if ((N & (N - 1)) !== 0) throw new Error(`welchPSD: fftSize=${N} not power of 2`);
  const win = makeWindow(winType, N);
  let winNorm = 0;
  for (let i = 0; i < N; i++) winNorm += win[i] * win[i];

  const halfN = (N >> 1) + 1;
  const psd = new Float64Array(halfN);
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  const step = Math.max(1, Math.floor(N * (1 - overlap)));
  let segCount = 0;
  for (let start = 0; start + N <= signal.length; start += step) {
    let meanValue = 0;
    if (detrend) {
      for (let i = 0; i < N; i++) meanValue += signal[start + i];
      meanValue /= N;
    }
    for (let i = 0; i < N; i++) {
      re[i] = (signal[start + i] - meanValue) * win[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    for (let k = 0; k < halfN; k++) {
      const power = re[k] * re[k] + im[k] * im[k];
      const scale = (k > 0 && k < halfN - 1) ? 2 : 1;
      psd[k] += scale * power / winNorm;
    }
    segCount++;
  }
  if (segCount === 0) return { psd, segmentCount: 0 };
  for (let k = 0; k < halfN; k++) psd[k] /= segCount;
  return { psd, segmentCount: segCount };
}

export function harmonicProductSpectrum(
  magSpectrum: ArrayLike<number>,
  harmonics = 5
): Float64Array {
  const N = magSpectrum.length;
  const maxBin = Math.floor((N - 1) / harmonics);
  const out = new Float64Array(maxBin + 1);
  for (let k = 0; k <= maxBin; k++) {
    let prod = magSpectrum[k];
    for (let r = 2; r <= harmonics; r++) prod *= magSpectrum[k * r];
    out[k] = prod;
  }
  return out;
}

export function findFundamentalBin(
  magSpectrum: ArrayLike<number>,
  opts: { harmonics?: number; minBin?: number } = {}
): number {
  const harmonics = opts.harmonics ?? 5;
  const minBin = opts.minBin ?? 2;
  const hps = harmonicProductSpectrum(magSpectrum, harmonics);
  let best = -1, bestVal = -Infinity;
  for (let k = minBin; k < hps.length; k++) {
    if (hps[k] > bestVal) { bestVal = hps[k]; best = k; }
  }
  return best;
}

export function spectralEntropyPerBand(
  fftMagnitudes: Float32Array | number[],
  sampleRate = 44100,
  numBands = 10
): number[] {
  const N    = fftMagnitudes.length;
  const fMax = sampleRate / 2;
  const LOG_MIN = Math.log10(20);
  const LOG_MAX = Math.log10(fMax);
  const bw    = (LOG_MAX - LOG_MIN) / numBands;

  const bandBins: number[][] = Array.from({ length: numBands }, () => []);
  for (let i = 1; i < N; i++) {
    const f = (i / N) * fMax;
    if (f < 20) continue;
    const logF  = Math.log10(f);
    const bIdx  = Math.min(numBands - 1, Math.floor((logF - LOG_MIN) / bw));
    const power = (fftMagnitudes[i] as number) ** 2;
    bandBins[bIdx].push(power);
  }

  return bandBins.map((bins) => {
    const total = bins.reduce((s, p) => s + p, 0);
    if (total < 1e-12 || bins.length < 2) return 0;
    let H = 0;
    for (const p of bins) {
      const prob = p / total;
      if (prob > 1e-12) H -= prob * Math.log(prob);
    }
    return H / Math.log(bins.length);
  });
}

export function spectralReassignment(
  segment: ArrayLike<number>,
  sampleRate: number,
  window: WindowType = 'hann'
): { freqHz: Float32Array; magnitude: Float32Array } {
  const N = segment.length;
  if ((N & (N - 1)) !== 0) throw new Error('spectralReassignment: N not power of 2');

  const w = makeWindow(window, N);
  const dw = new Float32Array(N);
  if (window === 'hann') {
    for (let n = 0; n < N; n++) dw[n] = (Math.PI / (N - 1)) * Math.sin(2 * Math.PI * n / (N - 1));
  } else {
    for (let n = 1; n < N - 1; n++) dw[n] = 0.5 * (w[n + 1] - w[n - 1]);
    dw[0] = w[1] - w[0];
    dw[N - 1] = w[N - 1] - w[N - 2];
  }

  const reX  = new Float64Array(N), imX  = new Float64Array(N);
  const reXd = new Float64Array(N), imXd = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    reX[n]  = segment[n] * w[n];
    reXd[n] = segment[n] * dw[n];
  }
  fftInPlace(reX, imX);
  fftInPlace(reXd, imXd);

  const halfN = (N >> 1) + 1;
  const freqHz   = new Float32Array(halfN);
  const magnitude = new Float32Array(halfN);
  const binHz = sampleRate / N;

  for (let k = 0; k < halfN; k++) {
    const mag2 = reX[k] * reX[k] + imX[k] * imX[k];
    if (mag2 < 1e-20) {
      freqHz[k] = k * binHz;
      magnitude[k] = 0;
      continue;
    }
    const numIm = imXd[k] * reX[k] - reXd[k] * imX[k];
    const deltaOmegaRad = numIm / mag2;
    const deltaHz = deltaOmegaRad * sampleRate / (2 * Math.PI);
    // DSP-03: clamp to [0, Nyquist] — unclamped deltaHz can produce
    // negative or supra-Nyquist frequencies that break downstream processing.
    freqHz[k] = Math.max(0, Math.min(sampleRate / 2, k * binHz + deltaHz));
    magnitude[k] = Math.sqrt(mag2);
  }
  return { freqHz, magnitude };
}
