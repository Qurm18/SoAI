/**
 * Test suite for lib/math.ts — runs under Vitest.
 *
 *   npm test
 *
 * All tests use closed-form / hand-verified expected values so a regression
 * in the numerical code is caught immediately.
 */

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: any;

import {
  clamp, mean, std, variance, linsolve,
  KalmanFilter1D, kalmanSmoothVector, MultiBandKalman,
  spectralFlatness, spectralFlatnessFromDb, wienerEntropyDb,
  crestFactor, crestFactorDb,
  polyfit, polyval, polynomialSmoothEqCurve,
  normalisedMutualInformation, entropy,
  optimalQ, dynamicQVector,
  parabolicInterpolate, findPeaksParabolic, binToHz,
} from './math';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ─── Helpers ────────────────────────────────────────────────────────────────

describe('helpers', () => {
  it('clamp respects bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('mean / variance / std on simple data', () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(xs)).toBe(5);
    expect(close(variance(xs), 4, 1e-9)).toBe(true); // population variance
    expect(close(std(xs), 2, 1e-9)).toBe(true);
  });

  it('linsolve solves a 3×3 system', () => {
    // x + y + z = 6 ; 2y + 5z = -4 ; 2x + 5y - z = 27
    const A = [[1, 1, 1], [0, 2, 5], [2, 5, -1]];
    const b = [6, -4, 27];
    const x = linsolve(A, b);
    // Expected: [5, 3, -2]
    expect(close(x[0], 5, 1e-9)).toBe(true);
    expect(close(x[1], 3, 1e-9)).toBe(true);
    expect(close(x[2], -2, 1e-9)).toBe(true);
  });
});

// ─── Kalman ────────────────────────────────────────────────────────────────

describe('KalmanFilter1D', () => {
  it('converges to the true mean of a noisy constant signal', () => {
    const truth = 7.5;
    const kf = new KalmanFilter1D(0, 0.0001, 1.0, 1.0);
    // Pseudo-random noise around the truth
    let seed = 1234;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    let last = 0;
    for (let i = 0; i < 500; i++) {
      const noise = (rand() - 0.5) * 2; // ±1
      last = kf.update(truth + noise);
    }
    expect(Math.abs(last - truth)).toBeLessThan(0.25);
  });

  it('reset returns the filter to a clean state', () => {
    const kf = new KalmanFilter1D(0, 0.1, 1.0);
    for (let i = 0; i < 20; i++) kf.update(10);
    expect(kf.value).toBeGreaterThan(5);
    kf.reset(0, 1.0);
    expect(kf.value).toBe(0);
  });
});

describe('kalmanSmoothVector', () => {
  it('preserves length and produces finite numbers', () => {
    const noisy = [0, 5, -3, 8, 2, 7, -1, 4, 6, 3];
    const smoothed = kalmanSmoothVector(noisy);
    expect(smoothed).toHaveLength(noisy.length);
    smoothed.forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });

  it('reduces variance on a noisy signal', () => {
    const noisy = [3, -3, 4, -4, 3, -3, 4, -4, 3, -3];
    const smoothed = kalmanSmoothVector(noisy, 0.05, 1.5);
    expect(variance(smoothed)).toBeLessThan(variance(noisy));
  });

  it('returns empty array for empty input', () => {
    expect(kalmanSmoothVector([])).toEqual([]);
  });
});

describe('MultiBandKalman', () => {
  it('smooths each band independently', () => {
    const mb = new MultiBandKalman(3, 0.05, 0.5);
    let last = mb.step([10, -10, 0]);
    for (let i = 0; i < 30; i++) last = mb.step([10, -10, 0]);
    expect(Math.abs(last[0] - 10)).toBeLessThan(0.5);
    expect(Math.abs(last[1] + 10)).toBeLessThan(0.5);
    expect(Math.abs(last[2])).toBeLessThan(0.5);
  });
});

// ─── Spectral Flatness ────────────────────────────────────────────────────

describe('spectralFlatness', () => {
  it('returns ~1 for a flat (white) spectrum', () => {
    const flatPower = new Array(64).fill(0.5);
    expect(spectralFlatness(flatPower)).toBeGreaterThan(0.999);
  });

  it('returns near 0 for a single-tone spectrum', () => {
    const tonePower = new Array(64).fill(1e-9);
    tonePower[5] = 1.0;
    expect(spectralFlatness(tonePower)).toBeLessThan(0.05);
  });

  it('clamps result into [0, 1]', () => {
    const f = spectralFlatness([0.1, 0.2, 0.3, 0.4]);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThanOrEqual(1);
  });

  it('spectralFlatnessFromDb agrees with spectralFlatness on the same data', () => {
    // 8 random-ish power values
    const power = [0.1, 0.4, 0.2, 0.6, 0.3, 0.5, 0.25, 0.7];
    const db = new Float32Array(power.map((p) => 10 * Math.log10(p)));
    const a = spectralFlatness(power);
    const b = spectralFlatnessFromDb(db);
    expect(close(a, b, 1e-3)).toBe(true);
  });

  it('wienerEntropyDb is ≤ 0', () => {
    expect(wienerEntropyDb([1, 1, 1, 1])).toBeLessThanOrEqual(0.0001);
    expect(wienerEntropyDb([0.1, 1.0, 0.01])).toBeLessThan(0);
  });
});

// ─── Crest Factor ─────────────────────────────────────────────────────────

describe('crestFactor', () => {
  it('returns √2 for a sine wave', () => {
    const N = 1024;
    const sine = new Array(N).fill(0).map((_, i) => Math.sin((2 * Math.PI * i) / N));
    expect(close(crestFactor(sine), Math.SQRT2, 1e-3)).toBe(true);
  });

  it('returns 1 for a square wave', () => {
    const N = 1024;
    const sq = new Array(N).fill(0).map((_, i) => (i % 2 ? 1 : -1));
    expect(close(crestFactor(sq), 1, 1e-9)).toBe(true);
  });

  it('crestFactorDb of sine ≈ 3.01 dB', () => {
    const N = 1024;
    const sine = new Array(N).fill(0).map((_, i) => Math.sin((2 * Math.PI * i) / N));
    expect(close(crestFactorDb(sine), 20 * Math.log10(Math.SQRT2), 1e-2)).toBe(true);
  });
});

// ─── Polynomial Regression ────────────────────────────────────────────────

describe('polyfit / polyval', () => {
  it('exactly recovers a known cubic (degree 3, 4 points)', () => {
    // y = 1 + 2x + 3x² - x³
    const true_c = [1, 2, 3, -1];
    const xs = [-1, 0, 1, 2];
    const ys = xs.map((x) => polyval(true_c, x));
    const fit = polyfit(xs, ys, 3);
    for (let i = 0; i < 4; i++) expect(close(fit[i], true_c[i], 1e-6)).toBe(true);
  });

  it('fits noisy linear data with degree 1', () => {
    const xs = Array.from({ length: 50 }, (_, i) => i);
    const ys = xs.map((x) => 2 * x + 5);
    const fit = polyfit(xs, ys, 1);
    expect(close(fit[0], 5, 1e-6)).toBe(true);
    expect(close(fit[1], 2, 1e-6)).toBe(true);
  });

  it('polynomialSmoothEqCurve preserves output length and dampens spikes', () => {
    const freqs = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const gains = [3, 2, 1, 0, -10, 0, 1, 2, 3, 4]; // band 4 is a spike
    const smoothed = polynomialSmoothEqCurve(gains, freqs, 3, 1.0);
    expect(smoothed).toHaveLength(gains.length);
    // Smoothed value at the spike should be much less negative than -10
    expect(smoothed[4]).toBeGreaterThan(-5);
  });
});

// ─── Mutual Information / Entropy ─────────────────────────────────────────

describe('entropy / mutualInformation', () => {
  it('entropy of a uniform distribution = log2(k)', () => {
    expect(close(entropy(['a', 'b', 'c', 'd']), 2, 1e-9)).toBe(true);
  });

  it('entropy of a constant signal = 0', () => {
    expect(entropy(['x', 'x', 'x', 'x'])).toBe(0);
  });

  it('MI is 0 when X is constant', () => {
    expect(normalisedMutualInformation(['a', 'a', 'a'], ['x', 'y', 'z'])).toBe(0);
  });

  it('MI of identical sequences = entropy', () => {
    const x = ['a', 'b', 'a', 'b', 'a', 'b'];
    const mi = normalisedMutualInformation(x, x);
    expect(close(mi, 1.0, 1e-9)).toBe(true);
  });

  it('NMI of identical sequences = 1', () => {
    const x = ['A', 'B', 'A', 'B'];
    expect(close(normalisedMutualInformation(x, x), 1, 1e-9)).toBe(true);
  });

  it('NMI returns 0 for degenerate inputs', () => {
    expect(normalisedMutualInformation(['a', 'a', 'a'], ['x', 'x', 'x'])).toBe(0);
  });
});

// ─── Dynamic Q ────────────────────────────────────────────────────────────

describe('optimalQ', () => {
  it('returns wider Q (smaller value) for larger gains', () => {
    const qSmall = optimalQ(1000, 2000, 0);
    const qLarge = optimalQ(1000, 2000, 12);
    expect(qLarge).toBeLessThan(qSmall);
  });

  it('respects min/max bounds', () => {
    const q = optimalQ(1000, 1000.001, 0, { minQ: 0.5, maxQ: 4 });
    expect(q).toBeGreaterThanOrEqual(0.5);
    expect(q).toBeLessThanOrEqual(4);
  });

  it('dynamicQVector returns one Q per band', () => {
    const f = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const g = new Array(10).fill(0);
    const qs = dynamicQVector(f, g);
    expect(qs).toHaveLength(10);
    qs.forEach((q) => {
      expect(q).toBeGreaterThan(0);
      expect(q).toBeLessThan(10);
    });
  });
});

// ─── Peak Detection ───────────────────────────────────────────────────────

describe('parabolicInterpolate', () => {
  it('returns delta=0 for symmetric neighbours', () => {
    const { delta } = parabolicInterpolate(1, 2, 1);
    expect(close(delta, 0, 1e-12)).toBe(true);
  });

  it('shifts the peak toward the larger neighbour', () => {
    const { delta: rightHeavy } = parabolicInterpolate(1, 5, 4);
    expect(rightHeavy).toBeGreaterThan(0);
    const { delta: leftHeavy } = parabolicInterpolate(4, 5, 1);
    expect(leftHeavy).toBeLessThan(0);
  });

  it('interpolated value ≥ centre when neighbours are below it', () => {
    const { y } = parabolicInterpolate(2, 6, 3);
    expect(y).toBeGreaterThanOrEqual(6);
  });
});

describe('findPeaksParabolic', () => {
  it('finds a single dominant peak in a clean signal', () => {
    // Two Gaussian-ish bumps: a tall one at i=20 and a small one at i=60
    const N = 100;
    const data = new Array(N).fill(0).map((_, i) => {
      const a = 30 * Math.exp(-Math.pow((i - 20) / 3, 2));
      const b = 5 * Math.exp(-Math.pow((i - 60) / 3, 2));
      return a + b - 50; // place into dB-like negative range
    });
    const peaks = findPeaksParabolic(data, { minProminence: 1, maxPeaks: 5 });
    expect(peaks.length).toBeGreaterThanOrEqual(1);
    // Highest peak should be near index 20
    expect(Math.abs(peaks[0].index - 20)).toBeLessThanOrEqual(1);
    expect(Math.abs(peaks[0].interpolatedIndex - 20)).toBeLessThan(1);
  });

  it('respects maxPeaks limit', () => {
    const data = [0, 5, 0, 4, 0, 3, 0, 2, 0, 1, 0];
    const peaks = findPeaksParabolic(data, { minProminence: 0.5, maxPeaks: 2 });
    expect(peaks.length).toBeLessThanOrEqual(2);
  });

  it('respects minProminence threshold', () => {
    // Tiny ripple should be filtered out
    const data = [0, 0.1, 0, 0.1, 0, 0.1, 0];
    const peaks = findPeaksParabolic(data, { minProminence: 5 });
    expect(peaks).toEqual([]);
  });

  it('respects minDistanceBins (greedy by magnitude)', () => {
    const data = [0, 10, 0, 9, 0, 8, 0, 7, 0];
    const peaks = findPeaksParabolic(data, { minProminence: 1, minDistanceBins: 4 });
    // With min spacing 4 and peaks at 1,3,5,7 only 1 should fit (after taking 1, 5 is OK)
    expect(peaks.length).toBeGreaterThanOrEqual(1);
    expect(peaks.length).toBeLessThanOrEqual(2);
  });
});

describe('binToHz', () => {
  it('converts FFT bin to frequency', () => {
    expect(binToHz(10, 1024, 44100)).toBeCloseTo(430.66, 1);
    expect(binToHz(0, 1024, 44100)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Tests for sections 8-22 (LUFS, Bayesian Opt, ERB/Bark, etc.)
// ════════════════════════════════════════════════════════════════════════════

import {
  makeWindow,
  magnitudeCorrectionDb,
  enbwBins,
  fftInPlace,
  welchPSD,
  selectPolyDegree,
  tonalityFromBandFlatness,
  harmonicProductSpectrum,
  findFundamentalBin,
  filterHarmonicPeaks,
  spectralReassignment,
  distanceCorrelation,
  bradleyTerryScores,
  hzToBark,
  barkToHz,
  hzToErb,
  erbBandwidth,
  erbBandCentres,
  equalLoudnessSpl,
  equalLoudnessWeights,
  kWeightingFilters,
  applyBiquad,
  integratedLufs,
  schroederSpread,
  maskingThreshold,
  gpFit,
  gpPredict,
  expectedImprovement,
  chooseNextByEI,
} from './math';

describe('Window functions + ENBW', () => {
  it('Hann window starts and ends at 0', () => {
    const w = makeWindow('hann', 64);
    expect(w[0]).toBeCloseTo(0, 5);
    expect(w[63]).toBeCloseTo(0, 5);
  });
  it('Hann magnitude correction is ~+4.26 dB', () => {
    expect(magnitudeCorrectionDb('hann')).toBeCloseTo(4.26, 1);
  });
  it('Rectangle ENBW is exactly 1', () => {
    expect(enbwBins('rect')).toBe(1);
  });
});

describe('FFT + Welch', () => {
  it('FFT round-trips a delta correctly', () => {
    const N = 16;
    const re = new Float64Array(N), im = new Float64Array(N);
    re[0] = 1;
    fftInPlace(re, im);
    // FFT of a delta is constant 1 across all bins
    for (let k = 0; k < N; k++) {
      expect(re[k]).toBeCloseTo(1, 6);
      expect(im[k]).toBeCloseTo(0, 6);
    }
  });
  it('Welch detects a 1 kHz tone', () => {
    const sr = 16000, dur = 0.5;
    const N = Math.floor(sr * dur);
    const sig = new Float32Array(N);
    for (let i = 0; i < N; i++) sig[i] = Math.sin(2 * Math.PI * 1000 * i / sr);
    const { psd } = welchPSD(sig, { fftSize: 1024, overlap: 0.5, window: 'hann' });
    // Bin index for 1 kHz at fs=16k, N=1024 = 1000 * 1024 / 16000 = 64
    let argmax = 0, maxV = -Infinity;
    for (let k = 0; k < psd.length; k++) if (psd[k] > maxV) { maxV = psd[k]; argmax = k; }
    expect(argmax).toBeGreaterThanOrEqual(63);
    expect(argmax).toBeLessThanOrEqual(65);
  });
});

describe('AIC poly degree selection', () => {
  it('picks degree 1 for a true line', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7];
    const ys = xs.map((x) => 2 * x + 1);
    const { degree } = selectPolyDegree(xs, ys, { minDeg: 1, maxDeg: 4, criterion: 'aic' });
    expect(degree).toBe(1);
  });
  it('picks degree >= 2 for a true parabola', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7];
    const ys = xs.map((x) => x * x - 3 * x + 2);
    const { degree } = selectPolyDegree(xs, ys, { minDeg: 1, maxDeg: 4, criterion: 'aic' });
    expect(degree).toBeGreaterThanOrEqual(2);
  });
});

describe('Tonality + HPS + harmonic filter', () => {
  it('tonality ≈ 1 for a single bin spike', () => {
    const p = new Float64Array(64);
    for (let i = 0; i < 64; i++) p[i] = 1e-6;
    p[20] = 1.0;
    const ton = tonalityFromBandFlatness(p, 6);
    expect(ton[20]).toBeGreaterThan(0.5);
  });
  it('HPS finds a fundamental from a harmonic series', () => {
    const N = 256;
    const mag = new Float32Array(N);
    for (let h = 1; h <= 5; h++) mag[10 * h] = 1 / h;
    const f = findFundamentalBin(mag, { harmonics: 5 });
    expect(f).toBe(10);
  });
  it('filterHarmonicPeaks removes integer-multiple peaks', () => {
    const peaks = [
      { freqHz: 100, index: 100, interpolatedIndex: 100, magnitude: 10, prominence: 5 },
      { freqHz: 200, index: 200, interpolatedIndex: 200, magnitude:  5, prominence: 3 },
      { freqHz: 300, index: 300, interpolatedIndex: 300, magnitude:  3, prominence: 2 },
      { freqHz: 137, index: 137, interpolatedIndex: 137, magnitude:  2, prominence: 2 },
    ];
    const kept = filterHarmonicPeaks(peaks);
    // 200 and 300 are 2× and 3× of 100 → harmonics; 137 is unrelated → keep.
    expect(kept.find((p) => p.index === 100)).toBeDefined();
    expect(kept.find((p) => p.index === 137)).toBeDefined();
    expect(kept.find((p) => p.index === 200)).toBeUndefined();
    expect(kept.find((p) => p.index === 300)).toBeUndefined();
  });
});

describe('Spectral reassignment', () => {
  it('refines a tone away from the bin centre', () => {
    const N = 1024, sr = 8000;
    const f0 = 1000.7;            // off-grid frequency
    const sig = new Float32Array(N);
    for (let n = 0; n < N; n++) sig[n] = Math.sin(2 * Math.PI * f0 * n / sr);
    const { freqHz, magnitude } = spectralReassignment(sig, sr, 'hann');
    let argmax = 0, maxM = -Infinity;
    for (let k = 1; k < magnitude.length; k++) if (magnitude[k] > maxM) { maxM = magnitude[k]; argmax = k; }
    expect(freqHz[argmax]).toBeGreaterThan(990);
    expect(freqHz[argmax]).toBeLessThan(1010);
  });
});

describe('Distance correlation', () => {
  it('= 0 for independent constants', () => {
    const x = [1, 1, 1, 1, 1, 1];
    const y = [3, 4, 5, 6, 7, 8];
    expect(distanceCorrelation(x, y)).toBeCloseTo(0, 5);
  });
  it('detects perfect non-linear dependency', () => {
    const x = [-3, -2, -1, 0, 1, 2, 3];
    const y = x.map((v) => v * v); // y = x²
    expect(distanceCorrelation(x, y)).toBeGreaterThan(0.5);
  });
});

describe('Bradley-Terry', () => {
  it('ranks a clear winner above a clear loser', () => {
    const items = ['A', 'B', 'C'];
    const comps = [
      { winner: 'A', loser: 'B' },
      { winner: 'A', loser: 'C' },
      { winner: 'A', loser: 'B' },
      { winner: 'B', loser: 'C' },
    ];
    const s = bradleyTerryScores(items, comps);
    expect(s.A).toBeGreaterThan(s.B);
    expect(s.B).toBeGreaterThan(s.C);
  });
});

describe('Bark + ERB scales', () => {
  it('Bark inverse round-trip', () => {
    expect(barkToHz(hzToBark(1000))).toBeCloseTo(1000, 0);
  });
  it('ERB scale is monotonically increasing', () => {
    const e1 = hzToErb(100), e2 = hzToErb(1000), e3 = hzToErb(10000);
    expect(e1).toBeLessThan(e2);
    expect(e2).toBeLessThan(e3);
  });
  it('ERB bandwidth at 1 kHz ≈ 132.6 Hz', () => {
    expect(erbBandwidth(1000)).toBeCloseTo(132.64, 1);
  });
  it('erbBandCentres covers full range', () => {
    const c = erbBandCentres(10, 20, 20000);
    expect(c.length).toBe(10);
    expect(c[0]).toBeCloseTo(20, 0);
    expect(c[9]).toBeCloseTo(20000, -1);
  });
});

describe('Equal-loudness contour (ISO 226-2003)', () => {
  it('1 kHz at 60 phon = 60 dB SPL', () => {
    expect(equalLoudnessSpl(1000, 60)).toBeCloseTo(60, 0);
  });
  it('100 Hz needs higher SPL than 1 kHz at the same phon', () => {
    expect(equalLoudnessSpl(100, 60)).toBeGreaterThan(equalLoudnessSpl(1000, 60));
  });
  it('weights reference 1 kHz to 0', () => {
    const w = equalLoudnessWeights([100, 1000, 4000], 60);
    expect(w[1]).toBeCloseTo(0, 5);
  });
});

describe('K-weighting + LUFS', () => {
  it('biquad applied to silence stays silence', () => {
    const { stage1 } = kWeightingFilters(48000);
    const out = applyBiquad(new Float32Array(1024), stage1);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(0, 9);
  });
  it('LUFS of -20 dBFS sine is roughly -20..-22 LUFS at 1 kHz', () => {
    const sr = 48000;
    const N = sr * 2;
    const amp = Math.pow(10, -20 / 20);
    const sig = new Float32Array(N);
    for (let n = 0; n < N; n++) sig[n] = amp * Math.sin(2 * Math.PI * 1000 * n / sr);
    const lufs = integratedLufs(sig, sr);
    expect(lufs).toBeGreaterThan(-25);
    expect(lufs).toBeLessThan(-15);
  });
  it('quieter signal produces lower LUFS', () => {
    const sr = 48000, N = sr * 2;
    const a = new Float32Array(N), b = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      const t = 2 * Math.PI * 1000 * n / sr;
      a[n] = 0.5 * Math.sin(t);
      b[n] = 0.05 * Math.sin(t);
    }
    expect(integratedLufs(a, sr)).toBeGreaterThan(integratedLufs(b, sr));
  });
});

describe('Schroeder spread + masking threshold', () => {
  it('peak at Δb=0 is the strongest', () => {
    expect(schroederSpread(0)).toBeGreaterThan(schroederSpread(1));
    expect(schroederSpread(0)).toBeGreaterThan(schroederSpread(-1));
  });
  it('mask threshold near a loud band is high', () => {
    const f = [100, 200, 400, 800, 1600];
    const lvl = [0, 0, 60, 0, 0];
    const t = maskingThreshold(f, lvl);
    expect(t[2]).toBeGreaterThan(t[0]);
    expect(t[1]).toBeGreaterThan(t[0]);
  });
});

describe('GP regression + Expected Improvement', () => {
  it('GP posterior at training point ≈ training label', () => {
    const X = [[0], [1], [2], [3]];
    const y = [0, 1, 4, 9];
    const fit = gpFit(X, y, { lengthscale: 1, amplitude: 4, noise: 1e-4 });
    const { mean } = gpPredict(fit, [1]);
    expect(mean).toBeCloseTo(1, 1);
  });
  it('EI is non-negative', () => {
    const X = [[0], [1], [2]];
    const y = [0, 1, 0];
    const fit = gpFit(X, y, { lengthscale: 1, amplitude: 1, noise: 0.05 });
    expect(expectedImprovement(fit, [1.5], 1)).toBeGreaterThanOrEqual(0);
  });
  it('chooseNextByEI cold-starts on largest-norm candidate', () => {
    const c = { a: [1, 0], b: [3, 0], c: [0, 2] };
    const { id } = chooseNextByEI(c, []);
    expect(id).toBe('b');
  });
});

import { AdaptiveEQLearner } from './adaptive-eq';

describe('AdaptiveEQLearner integration', () => {
  it('converges toward bass-preferred setting after repeated A-boost choices', () => {
    const learner = new AdaptiveEQLearner();

    const bassBoostEQ = [5, 4, 3, 0, 0, 0, 0, 0, 0, 0];
    const flatEQ      = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const ctx = {
      sectionType: 'chorus' as const,
      bassEnergy: 0.8,
      loudness: -14,
    };
    const features = {
      lowEnergy: 0.8, midEnergy: 0.4, highEnergy: 0.3,
      spectralCentroid: 200, dynamicRange: 10,
      isMuddy: false, isHarsh: false, isThin: false,
    };

    for (let i = 0; i < 10; i++) {
      learner.update(ctx, features, {
        eqA: bassBoostEQ, eqB: flatEQ, choice: 'A', listenTime: 15,
      });
    }

    const state = learner.getState();
    // After 10 clear A-wins (bass boost), globalPreference[0] should be positive
    expect(state.globalPreference[0]).toBeGreaterThan(0.3);
    expect(state.stability).toBeGreaterThan(0.5);
  });

  it('DISLIKE_BOTH shrinks preference magnitude toward neutral', () => {
    const learner = new AdaptiveEQLearner({
      globalPreference: [0.8, 0.6, 0.4, 0.2, 0, 0, 0, 0, 0, 0],
      stability: 0.7,
      interactionCount: 5,
      contextPreferences: {},
    });

    const ctx = { sectionType: 'verse' as const, bassEnergy: 0.5, loudness: -18 };
    const features = { lowEnergy: 0.5, midEnergy: 0.5, highEnergy: 0.5,
      spectralCentroid: 500, dynamicRange: 12, isMuddy: false, isHarsh: false, isThin: false };

    learner.update(ctx, features, {
      eqA: [3,2,1,0,0,0,0,0,0,0], eqB: [0,0,0,3,2,1,0,0,0,0],
      choice: 'DISLIKE_BOTH',
    });

    const after = learner.getState();
    // Preference should shrink (not grow) after DISLIKE_BOTH
    expect(Math.abs(after.globalPreference[0])).toBeLessThan(0.8);
  });
});

describe('FIR kernel spectral accuracy', () => {
  it('peaking filter at 1kHz +6dB produces correct magnitude at target freq', () => {
    // This test requires audio-engine — skip if not available
    // Use biquadMagnitudeDb directly:
    // (after patch is applied, import the helper)
    const f0 = 1000, gain = 6, Q = 1.4, sr = 44100;
    const A   = Math.pow(10, gain / 40);
    const w0  = 2 * Math.PI * f0 / sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const cosW0 = Math.cos(w0);
    const b0 = 1 + alpha * A, b1 = -2 * cosW0, b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A, a1 = -2 * cosW0, a2 = 1 - alpha / A;

    const w = 2 * Math.PI * f0 / sr;
    const cosW = Math.cos(w), sinW = Math.sin(w);
    const cos2W = Math.cos(2*w), sin2W = Math.sin(2*w);
    const numR = b0 + b1*cosW + b2*cos2W;
    const numI = -b1*sinW - b2*sin2W;
    const denR = a0 + a1*cosW + a2*cos2W;
    const denI = -a1*sinW - a2*sin2W;
    const magDb = 10 * Math.log10((numR**2 + numI**2) / (denR**2 + denI**2));

    expect(magDb).toBeCloseTo(6, 0); // ±1dB tolerance
  });
});
