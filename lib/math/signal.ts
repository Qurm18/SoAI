/**
 * SONIC — Signal Processing Helpers
 */
import { clamp, polyfit, KalmanFilter1D } from './common';

export function adaptiveKalmanSmoothVector(
  values: number[],
  baseProcessVar = 0.05
): number[] {
  const n = values.length;
  if (n === 0) return [];
  const out = new Array(n);
  // Estimate local variance to adapt Q
  let lastVal = values[0];
  const kf = new KalmanFilter1D(values[0], baseProcessVar, 0.5);
  
  for (let i = 0; i < n; i++) {
    const diff = Math.abs(values[i] - lastVal);
    // If large jump, increase process variance to adapt quickly
    const adaptiveQ = baseProcessVar * (1 + diff * 2);
    kf.setProcessVar(adaptiveQ);
    out[i] = kf.update(values[i]);
    lastVal = out[i];
  }
  return out;
}

export function selectPolyDegree(
  xs: number[],
  ys: number[],
  opts: { minDeg: number; maxDeg: number; criterion: 'aic' | 'bic' }
): { degree: number; error: number } {
  let bestDeg = opts.minDeg;
  let minCrit = Infinity;
  const n = xs.length;

  for (let d = opts.minDeg; d <= opts.maxDeg; d++) {
    const coeffs = polyfit(xs, ys, d);
    let rss = 0;
    for (let i = 0; i < n; i++) {
      let pred = 0;
      let xk = 1;
      for (let k = 0; k <= d; k++) {
        pred += coeffs[k] * xk;
        xk *= xs[i];
      }
      rss += (ys[i] - pred) ** 2;
    }
    const k = d + 1;
    const crit = opts.criterion === 'aic' 
      ? n * Math.log(rss / n) + 2 * k
      : n * Math.log(rss / n) + k * Math.log(n);
    
    if (crit < minCrit) {
      minCrit = crit;
      bestDeg = d;
    }
  }
  return { degree: bestDeg, error: minCrit };
}

export function polynomialSmoothEqCurve(
  gains: number[],
  freqs: number[],
  degree: number,
  blend = 0.5
): number[] {
  const logFreqs = freqs.map(f => Math.log10(f));
  const coeffs = polyfit(logFreqs, gains, degree);
  return gains.map((g, i) => {
    let poly = 0;
    let xk = 1;
    for (let k = 0; k <= degree; k++) {
      poly += coeffs[k] * xk;
      xk *= logFreqs[i];
    }
    return g * (1 - blend) + poly * blend;
  });
}

export function spectralFlatness(power: ArrayLike<number>, floor = 1e-10): number {
  const N = power.length;
  if (N === 0) return 0;
  let logSum = 0;
  let arithSum = 0;
  let count = 0;
  for (let i = 0; i < N; i++) {
    const p = Math.max(floor, power[i]);
    logSum += Math.log(p);
    arithSum += p;
    count++;
  }
  if (count === 0 || arithSum === 0) return 0;
  const geo = Math.exp(logSum / count);
  const arith = arithSum / count;
  return clamp(geo / arith, 0, 1);
}

export function spectralFlatnessFromDb(db: Float32Array, floor = 1e-10): number {
  const N = db.length;
  if (N === 0) return 0;
  let logSum = 0;
  let arithSum = 0;
  let count = 0;
  for (let i = 0; i < N; i++) {
    const v = db[i];
    if (!isFinite(v) || v <= -120) continue;
    const p = Math.max(floor, Math.pow(10, v / 10));
    logSum += Math.log(p);
    arithSum += p;
    count++;
  }
  if (count === 0 || arithSum === 0) return 0;
  return clamp(Math.exp(logSum / count) / (arithSum / count), 0, 1);
}

export function wienerEntropyDb(power: ArrayLike<number>): number {
  const f = spectralFlatness(power);
  return 10 * Math.log10(Math.max(1e-10, f));
}

export function crestFactor(timeDomain: ArrayLike<number>): number {
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < timeDomain.length; i++) {
    const v = Math.abs(timeDomain[i]);
    if (v > peak) peak = v;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / timeDomain.length);
  return rms > 0 ? peak / rms : 0;
}

export function crestFactorDb(timeDomain: ArrayLike<number>): number {
  const cf = crestFactor(timeDomain);
  return cf > 0 ? 20 * Math.log10(cf) : 0;
}

/** Parabolic interpolation for peak localization. */
export function parabolicInterpolate(y1: number, y2: number, y3: number): { x: number; y: number; delta: number } {
  const denom = y1 - 2 * y2 + y3;
  if (Math.abs(denom) < 1e-12) return { x: 0, y: y2, delta: 0 };
  const delta = (y1 - y3) / (2 * denom);
  const peakY = y2 - 0.25 * (y1 - y3) * delta;
  return { x: delta, y: peakY, delta };
}

export interface PeakInfo {
  index: number;
  interpolatedIndex: number;
  magnitude: number;
}

export function findPeaksParabolic(
  data: Float32Array | number[],
  opts: { 
    minMag?: number; 
    minDist?: number; 
    maxPeaks?: number;
    minProminence?: number;
    minHeight?: number;
    minDistanceBins?: number;
  } = {}
): PeakInfo[] {
  const minMag = opts.minHeight !== undefined 
    ? opts.minHeight 
    : (opts.minMag !== undefined ? opts.minMag : -Infinity);
  const minDist = opts.minDistanceBins ?? (opts.minDist ?? 5);
  const maxPeaks = opts.maxPeaks ?? 10;
  const minProminence = opts.minProminence ?? 0;
  const candidates: (PeakInfo & { prominence: number })[] = [];

  for (let i = 1; i < data.length - 1; i++) {
    const v = data[i];
    if (v > minMag && v > data[i - 1] && v > data[i + 1]) {
      // Basic prominence calculation
      let minLeft = v;
      for (let j = i - 1; j >= 0; j--) {
        if (data[j] > v) break;
        if (data[j] < minLeft) minLeft = data[j];
      }
      let minRight = v;
      for (let j = i + 1; j < data.length; j++) {
        if (data[j] > v) break;
        if (data[j] < minRight) minRight = data[j];
      }
      const prominence = v - Math.max(minLeft, minRight);
      
      if (prominence >= minProminence) {
        const { x, y } = parabolicInterpolate(data[i - 1], v, data[i + 1]);
        candidates.push({ index: i, interpolatedIndex: i + x, magnitude: y, prominence });
      }
    }
  }
  candidates.sort((a, b) => b.magnitude - a.magnitude);
  const accepted: PeakInfo[] = [];
  for (const p of candidates) {
    if (accepted.length >= maxPeaks) break;
    const tooClose = accepted.some((a) => Math.abs(a.index - p.index) < minDist);
    if (!tooClose) accepted.push(p);
  }
  return accepted;
}
