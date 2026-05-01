/**
 * SONIC — Common Math Helpers
 */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return xs.length ? s / xs.length : 0;
}

export function variance(xs: ArrayLike<number>): number {
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    const d = xs[i] - m;
    s += d * d;
  }
  return xs.length ? s / xs.length : 0;
}

export function std(xs: ArrayLike<number>): number {
  return Math.sqrt(variance(xs));
}

/**
 * Solve A · x = b for square A using partial-pivot Gauss-Jordan elimination.
 */
export function linsolve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    if (Math.abs(pv) < 1e-12) continue;

    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }

  return M.map((row) => row[n]);
}

export function polyval(coeffs: number[], x: number): number {
  let y = 0, xk = 1;
  for (let i = 0; i < coeffs.length; i++) {
    y += coeffs[i] * xk;
    xk *= x;
  }
  return y;
}

export class KalmanFilter1D {
  private x: number;
  private p: number;
  private q: number;
  private readonly r: number;

  constructor(initial = 0, processVar = 0.05, measurementVar = 1.0, initialCov = 1.0) {
    this.x = initial;
    this.p = initialCov;
    this.q = processVar;
    this.r = measurementVar;
  }

  setProcessVar(q: number): void {
    this.q = Math.max(1e-8, q);
  }

  update(measurement: number): number {
    this.p = this.p + this.q;
    const k = this.p / (this.p + this.r);
    this.x = this.x + k * (measurement - this.x);
    this.p = (1 - k) * this.p;
    return this.x;
  }

  get value(): number { return this.x; }
  get covariance(): number { return this.p; }

  reset(initial = 0, initialCov = 1.0): void {
    this.x = initial;
    this.p = initialCov;
  }
}

export function kalmanSmoothVector(
  values: number[],
  processVar = 0.08,
  measurementVar = 0.6
): number[] {
  if (values.length === 0) return [];
  const kf = new KalmanFilter1D(values[0], processVar, measurementVar, 1.0);
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) out[i] = kf.update(values[i]);
  const kf2 = new KalmanFilter1D(out[out.length - 1], processVar, measurementVar, 1.0);
  for (let i = out.length - 1; i >= 0; i--) {
    out[i] = 0.5 * out[i] + 0.5 * kf2.update(out[i]);
  }
  return out;
}

export class MultiBandKalman {
  private readonly filters: KalmanFilter1D[];
  constructor(numBands: number, processVars: number | number[] = 0.05, measurementVars: number | number[] = 1.0) {
    this.filters = Array.from({ length: numBands }, (_, i) => {
      const q = Array.isArray(processVars) ? processVars[i] : processVars;
      const r = Array.isArray(measurementVars) ? measurementVars[i] : measurementVars;
      return new KalmanFilter1D(0, q, r);
    });
  }
  step(measurements: number[]): number[] {
    return measurements.map((m, i) => this.filters[i].update(m));
  }
  stepAdaptive(measurements: number[], baseQ = 0.05): number[] {
    return measurements.map((m, i) => {
      const diff = Math.abs(m - this.filters[i].value);
      const adaptiveQ = baseQ * (1 + diff * 3);
      this.filters[i].setProcessVar(adaptiveQ);
      return this.filters[i].update(m);
    });
  }
  reset(initial: number[] = []): void {
    this.filters.forEach((f, i) => f.reset(initial[i] ?? 0));
  }
  get state(): number[] { return this.filters.map((f) => f.value); }
}

export function polyfit(xs: number[], ys: number[], degree: number): number[] {
  const n = xs.length;
  if (n === 0 || degree < 0) return [];
  const d = degree + 1;
  const XtX: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  const Xty: number[] = new Array(d).fill(0);
  const powerSums = new Array(2 * degree + 1).fill(0);
  for (let i = 0; i < n; i++) {
    let xk = 1;
    for (let k = 0; k <= 2 * degree; k++) {
      powerSums[k] += xk;
      xk *= xs[i];
    }
  }
  for (let r = 0; r < d; r++) {
    for (let c = 0; c < d; c++) XtX[r][c] = powerSums[r + c];
  }
  for (let i = 0; i < n; i++) {
    let xk = 1;
    for (let k = 0; k < d; k++) {
      Xty[k] += ys[i] * xk;
      xk *= xs[i];
    }
  }
  return linsolve(XtX, Xty);
}

export function optimalQ(
  frequencyHz: number,
  neighborFrequencyHz: number,
  gainDb: number,
  options: { minQ?: number; maxQ?: number } = {}
): number {
  const minQ = options.minQ ?? 0.4;
  const maxQ = options.maxQ ?? 6.0;
  const octaves = Math.abs(Math.log2(neighborFrequencyHz / frequencyHz)) || 1;
  const desiredBwOct = octaves * 0.7;
  const k = Math.pow(2, desiredBwOct);
  const baseQ = Math.sqrt(k) / Math.max(0.001, k - 1);
  const gainFactor = 1 - 0.45 * Math.tanh(Math.abs(gainDb) / 12);
  return clamp(baseQ * gainFactor, minQ, maxQ);
}

export function dynamicQVector(
  frequencies: number[],
  gains: number[],
  options: { minQ?: number; maxQ?: number } = {}
): number[] {
  return frequencies.map((f, i) => {
    const left = frequencies[i - 1];
    const right = frequencies[i + 1];
    const nearest = (left && right)
      ? (Math.abs(left - f) < Math.abs(right - f) ? left : right)
      : (left ?? right ?? f * 2);
    return optimalQ(f, nearest, gains[i], options);
  });
}
export function entropyAwareQVector(
  entropyPerBand: number[],
  baseQ: number[],
  opts: { minQ?: number; maxQ?: number; blendWeight?: number } = {}
): number[] {
  const minQ   = opts.minQ        ?? 0.5;
  const maxQ   = opts.maxQ        ?? 4.5;
  const blend  = opts.blendWeight ?? 0.4;
  return entropyPerBand.map((e, i) => {
    const qFromEntropy = minQ + e * (maxQ - minQ);
    const qBase = baseQ[i] ?? (minQ + maxQ) / 2;
    const q = qBase * (1 - blend) + qFromEntropy * blend;
    return clamp(q, minQ, maxQ);
  });
}

export function entropy(data: any[]): number {
  if (data.length === 0) return 0;
  const counts = new Map<any, number>();
  for (const v of data) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let h = 0;
  for (const count of counts.values()) {
    const p = count / data.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function normalisedMutualInformation(a: any[], b: any[]): number {
  const hA = entropy(a);
  const hB = entropy(b);
  if (hA + hB === 0) return 0;
  const combined = a.map((val, i) => `${val}_${b[i]}`);
  const hAB = entropy(combined);
  const mi = Math.max(0, hA + hB - hAB);
  return (2 * mi) / (hA + hB);
}

export function adaptiveSmooth(values: number[], confidence: number): number[] {
  const window = Math.round(1 + (1 - confidence) * 2);
  if (window <= 1) return [...values];
  return values.map((_, i) => {
    let sum = 0, count = 0;
    for (let j = i - window; j <= i + window; j++) {
      if (values[j] !== undefined) {
        sum += values[j];
        count++;
      }
    }
    return sum / count;
  });
}
