/**
 * SONIC — AI Inference and Preference Modeling
 */
import { mean } from './common';

export interface GPFit {
  /** Cholesky-decomposed alpha = (K+σ²I)⁻¹ y */
  alpha: number[];
  /** Lower-triangular Cholesky factor L (row-major flat) */
  L: number[];
  X: number[][];
  y: number[];
  lengthscale: number;
  amplitude: number;
  noise: number;
}

function rbfKernel(a: number[], b: number[], lengthscale: number, amplitude: number): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return amplitude * Math.exp(-s / (2 * lengthscale * lengthscale));
}

function cholesky(M: number[][]): number[][] {
  const n = M.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = 0;
      for (let k = 0; k < j; k++) s += L[i][k] * L[j][k];
      if (i === j) {
        const v = M[i][i] - s;
        if (v <= 0) throw new Error('cholesky: matrix not SPD');
        L[i][j] = Math.sqrt(v);
      } else {
        L[i][j] = (M[i][j] - s) / L[j][j];
      }
    }
  }
  return L;
}

function choleskyWithJitter(M: number[][], maxJitter = 1e-3): number[][] {
  const n = M.length;
  let jitter = 1e-8;
  
  while (jitter <= maxJitter) {
    try {
      const Mjit = M.map((row, i) => row.map((v, j) => (i === j ? v + jitter : v)));
      return cholesky(Mjit);
    } catch {
      jitter *= 10;
    }
  }
  throw new Error(`cholesky: matrix not SPD after max jitter ${maxJitter}`);
}

function forwardSub(L: number[][], b: number[]): number[] {
  const n = b.length;
  const z = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * z[k];
    z[i] = s / L[i][i];
  }
  return z;
}

function backSubT(L: number[][], z: number[]): number[] {
  const n = z.length;
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

export function gpFit(
  X: number[][],
  y: number[],
  opts: { lengthscale?: number; amplitude?: number; noise?: number } = {}
): GPFit {
  const lengthscale = opts.lengthscale ?? 2.0;
  const amplitude   = opts.amplitude   ?? 1.0;
  const noise       = opts.noise       ?? 0.09;
  const n = X.length;
  const K: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      K[i][j] = rbfKernel(X[i], X[j], lengthscale, amplitude) + (i === j ? noise : 0);
  const L = choleskyWithJitter(K);
  const z = forwardSub(L, y);
  const alpha = backSubT(L, z);
  return {
    alpha, L: L.flat(), X, y, lengthscale, amplitude, noise,
  };
}

export function gpLogMarginalLikelihood(
  X: number[][],
  y: number[],
  lengthscale: number,
  amplitude: number,
  noise: number
): number {
  try {
    const fit = gpFit(X, y, { lengthscale, amplitude, noise });
    const n = y.length;
    const L: number[][] = [];
    for (let i = 0; i < n; i++) L.push(fit.L.slice(i * n, (i + 1) * n));
    
    // log p(y|X,θ) = -0.5 * y^T α - Σ log L_ii - n/2 * log(2π)
    const yAlpha = y.reduce((s, yi, i) => s + yi * fit.alpha[i], 0);
    const logDetL = L.reduce((s, row, i) => s + Math.log(Math.max(1e-12, row[i])), 0);
    return -0.5 * yAlpha - logDetL - 0.5 * n * Math.log(2 * Math.PI);
  } catch {
    return -Infinity;
  }
}

// Grid search đơn giản cho hyperparameter (gọi khi có >= 8 observations)
export function optimizeGPHyperparams(
  X: number[][],
  y: number[]
): { lengthscale: number; amplitude: number; noise: number } {
  const lengthscales = [1.0, 2.0, 4.0, 8.0];
  const amplitudes   = [0.5, 1.0, 2.0];
  const noises       = [0.01, 0.05, 0.09, 0.2];

  let best = { lengthscale: 4.0, amplitude: 1.0, noise: 0.09 };
  let bestLL = -Infinity;

  for (const ls of lengthscales)
    for (const amp of amplitudes)
      for (const ns of noises) {
        const ll = gpLogMarginalLikelihood(X, y, ls, amp, ns);
        if (ll > bestLL) { bestLL = ll; best = { lengthscale: ls, amplitude: amp, noise: ns }; }
      }

  return best;
}

export function gpPredict(fit: GPFit, xs: number[]): { mean: number; variance: number } {
  const n = fit.X.length;
  const k = new Array(n);
  for (let i = 0; i < n; i++) k[i] = rbfKernel(fit.X[i], xs, fit.lengthscale, fit.amplitude);
  let meanValue = 0;
  for (let i = 0; i < n; i++) meanValue += k[i] * fit.alpha[i];
  const L: number[][] = [];
  for (let i = 0; i < n; i++) L.push(fit.L.slice(i * n, (i + 1) * n));
  const v = forwardSub(L, k);
  let vTv = 0;
  for (let i = 0; i < n; i++) vTv += v[i] * v[i];
  const kxx = rbfKernel(xs, xs, fit.lengthscale, fit.amplitude);
  return { mean: meanValue, variance: Math.max(0, kxx - vTv) };
}

function stdNormalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-0.5 * x * x);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 +
            t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function stdNormalPdf(x: number): number {
  return 0.3989422804014327 * Math.exp(-0.5 * x * x);
}

export function expectedImprovement(fit: GPFit, xs: number[], yBest: number, xi = 0.1): number {
  const { mean: m, variance: v } = gpPredict(fit, xs);
  const sigma = Math.sqrt(v);
  if (sigma < 1e-9) return 0;
  const z = (m - yBest - xi) / sigma;
  return (m - yBest - xi) * stdNormalCdf(z) + sigma * stdNormalPdf(z);
}

export function chooseNextByEI(
  candidates: Record<string, number[]>,
  history: Array<{ id: string; y: number; features: number[] }>,
  opts: { maxHistory?: number } = {}
): { id: string | null; ei: Record<string, number> } {
  const maxHistory = opts.maxHistory ?? 40;
  // Keep only the most recent trials to bound the O(N^3) GP complexity
  const recentHistory = history.length > maxHistory ? history.slice(-maxHistory) : history;

  if (recentHistory.length === 0) {
    let best = '';
    let bestNorm = -Infinity;
    for (const [id, f] of Object.entries(candidates)) {
      const norm = Math.sqrt(f.reduce((s, val) => s + val * val, 0));
      if (norm > bestNorm) { bestNorm = norm; best = id; }
    }
    const ei: Record<string, number> = {};
    Object.keys(candidates).forEach((id) => (ei[id] = id === best ? 1 : 0));
    return { id: best || null, ei };
  }
  const X = recentHistory.map((h) => h.features);
  const y = recentHistory.map((h) => h.y);
  let fit: GPFit;
  try {
    let hyperparams = { lengthscale: 4.0, amplitude: 1.0, noise: 0.09 };
    if (recentHistory.length >= 8) {
      if (recentHistory.length % 4 === 0) {
        hyperparams = optimizeGPHyperparams(X, y);
      }
    }
    fit = gpFit(X, y, hyperparams);
  } catch {
    const tried = new Set(history.map((h) => h.id));
    const left = Object.keys(candidates).filter((id) => !tried.has(id));
    return { id: left[0] ?? null, ei: {} };
  }
  const yBest = Math.max(...y);
  const tried = new Set(history.map((h) => h.id));
  let bestId: string | null = null;
  let bestEi = -Infinity;
  const eiMap: Record<string, number> = {};
  for (const [id, f] of Object.entries(candidates)) {
    if (tried.has(id)) { eiMap[id] = -Infinity; continue; }
    const ei = expectedImprovement(fit, f, yBest);
    eiMap[id] = ei;
    if (ei > bestEi) { bestEi = ei; bestId = id; }
  }
  return { id: bestId, ei: eiMap };
}

export function sparseGPPredict(
  Xm: number[][], // M inducing points
  X: number[][],  // N observations
  y: number[],
  xs: number[],
  opts: { lengthscale?: number; amplitude?: number; noise?: number } = {}
): { mean: number; variance: number } {
  const lengthscale = opts.lengthscale ?? 4.0;
  const amplitude = opts.amplitude ?? 1.0;
  
  const M = Xm.length;
  const N = X.length;
  
  const pseudoY = Array.from({length: M}, (_, j) =>
    X.reduce((s, xi, i) => s + rbfKernel(xi, Xm[j], lengthscale, amplitude) * y[i], 0) / N
  );
  
  const fit = gpFit(Xm, pseudoY, opts);
  return gpPredict(fit, xs);
}

// ─── Thurstone Fit ──────────────────────────────────────────────────────────

export interface ThurstoneFit {
  scale: Record<string, number>;
  logLikelihood: number;
  iterations: number;
}

export function thurstoneFitCaseV(
  items: string[],
  comparisons: Array<{ winner: string; loser: string }>,
  opts: { iterations?: number; tol?: number; alpha?: number } = {}
): ThurstoneFit {
  const maxIter = opts.iterations ?? 50; // Newton converges much faster
  const tol = opts.tol ?? 1e-8;
  const n = items.length;
  if (n === 0) return { scale: {}, logLikelihood: 0, iterations: 0 };

  const idx = new Map<string, number>(items.map((it, i) => [it, i]));
  const s = new Float64Array(n);
  // Constraints: sum(s) = 0
  
  let prevLL = -Infinity;
  let iter = 0;

  for (; iter < maxIter; iter++) {
    const grad = new Float64Array(n);
    const hess = new Float64Array(n); // Diagonal approximation is often enough, but let's do full if small
    let ll = 0;

    for (const { winner, loser } of comparisons) {
      const wi = idx.get(winner);
      const li = idx.get(loser);
      if (wi === undefined || li === undefined) continue;

      const z = (s[wi] - s[li]) / Math.SQRT2;
      const phi = stdNormalCdf(z);
      const pdf = stdNormalPdf(z);
      const phiClamped = Math.max(1e-12, Math.min(1 - 1e-12, phi));
      
      ll += Math.log(phiClamped);

      const ratio = pdf / (phiClamped * Math.SQRT2);
      grad[wi] += ratio;
      grad[li] -= ratio;

      // Second derivative of log-CDF: (pdf' * phi - pdf^2) / phi^2
      // pdf'(z) = -z * pdf(z)
      // d2/dz2 log Phi(z) = (-z*pdf*phi - pdf^2) / phi^2
      // Here z' = 1/sqrt(2)
      const d2 = (-z * pdf * phiClamped - pdf * pdf) / (phiClamped * phiClamped * 2);
      hess[wi] += d2;
      hess[li] += d2; 
      // Off-diagonal would be -d2, but purely for stability in small sets, 
      // diagonal Newton + constraint is often robust.
    }

    // Newton step: s = s - grad/hess
    // We are MAXIMIZING LL, so s = s - [H]^-1 g
    // Since H is negative definite, -H^-1 is positive.
    // Displacement step = - grad / hess.
    let maxChange = 0;
    for (let i = 0; i < n; i++) {
       const step = -grad[i] / (hess[i] - 1e-9); // hess is negative, so minus small epsilon for stability
       const delta = Math.max(-1.5, Math.min(1.5, step)); // Trust region
       s[i] += delta;
       if (Math.abs(delta) > maxChange) maxChange = Math.abs(delta);
    }

    // Shift to mean=0
    const m = mean(s);
    for (let i = 0; i < n; i++) s[i] -= m;

    if (maxChange < tol || Math.abs(ll - prevLL) < tol) {
      iter++;
      break;
    }
    prevLL = ll;
  }

  const scale: Record<string, number> = {};
  items.forEach((it, i) => { scale[it] = s[i]; });
  return { scale, logLikelihood: prevLL, iterations: iter };
}

export function thurstoneBandScores(
  prefs: Array<{ scenario: string; choice: 'A' | 'B' | 'NOT_SURE' | 'DISLIKE_BOTH' }>,
  abGains: Record<string, { A: number[]; B: number[] }>,
  threshold = 1.0
): number[] {
  const out = new Array(10).fill(0);
  for (let band = 0; band < 10; band++) {
    const comps: Array<{ winner: string; loser: string }> = [];
    for (const p of prefs) {
      if (p.choice === 'NOT_SURE' || p.choice === 'DISLIKE_BOTH') continue;
      const ab = abGains[p.scenario];
      if (!ab) continue;
      const a = ab.A[band], b = ab.B[band];
      if (Math.abs(a - b) < threshold) continue;
      const winnerIsBoost = p.choice === 'A' ? a > b : b > a;
      comps.push({ winner: winnerIsBoost ? 'boost' : 'cut',
                   loser:  winnerIsBoost ? 'cut'   : 'boost' });
    }
    if (comps.length === 0) continue;
    const fit = thurstoneFitCaseV(['boost', 'cut'], comps);
    out[band] = (fit.scale['boost'] ?? 0) - (fit.scale['cut'] ?? 0);
  }
  return out;
}

// ─── CUSUM Drift Detection ──────────────────────────────────────────────────

export interface CusumResult {
  driftDetected: boolean;
  alarm: boolean;
  changePoint: number;
  preMean: number;
  postMean: number;
  preWeight: number;
  postWeight: number;
  cusumPlus: number[];
  cusumMinus: number[];
}

export function cusumDriftDetect(
  votes: number[],
  opts: { k?: number; h?: number; baseline?: number; burnIn?: number } = {}
): CusumResult {
  const k = opts.k ?? 0.5;
  const h = opts.h ?? 4.0;
  const n = votes.length;
  const burnIn = opts.burnIn ?? Math.max(2, Math.floor(n * 0.25));

  if (n < 4) {
    const m = mean(votes);
    return {
      driftDetected: false, alarm: false, changePoint: 0,
      preMean: m, postMean: m,
      preWeight: 1, postWeight: 1,
      cusumPlus: [], cusumMinus: [],
    };
  }

  // BUG FIX: Use initial segment or provided baseline instead of global mean
  // to avoid circular reasoning / sensitivity damping.
  const mu0 = opts.baseline ?? mean(votes.slice(0, burnIn));
  
  const cusumPlus  = new Float64Array(n);
  const cusumMinus = new Float64Array(n);
  let gPlus = 0, gMinus = 0;
  let alarmIdx = -1;

  for (let i = 0; i < n; i++) {
    gPlus  = Math.max(0, gPlus  + (votes[i] - mu0 - k));
    gMinus = Math.max(0, gMinus - (votes[i] - mu0 + k));
    cusumPlus[i]  = gPlus;
    cusumMinus[i] = gMinus;
    if (alarmIdx < 0 && (gPlus > h || gMinus > h)) alarmIdx = i;
  }

  const driftDetected = alarmIdx >= 0;
  const alarm = driftDetected;

  let changePoint = alarmIdx >= 0 ? alarmIdx : Math.floor(n / 2);
  if (alarmIdx > 0) {
    const series = cusumPlus[alarmIdx] >= h ? cusumPlus : cusumMinus;
    // FIND THE LAST TIME THE CUSUM WAS ZERO before the alarm
    for (let i = alarmIdx - 1; i >= 0; i--) {
      if (series[i] === 0) {
        changePoint = i;
        break;
      }
    }
  }

  const pre  = votes.slice(0, changePoint + 1);
  const post = votes.slice(changePoint + 1);
  const preMeanValue  = pre.length  ? mean(pre)  : mu0;
  const postMeanValue = post.length ? mean(post) : mu0;

  const delta = Math.abs(postMeanValue - preMeanValue);
  const preWeight  = driftDetected ? Math.exp(-delta * 2) : 1.0;
  const postWeight = 1.0;

  return {
    driftDetected, alarm, changePoint, preMean: preMeanValue, postMean: postMeanValue,
    preWeight, postWeight, cusumPlus: Array.from(cusumPlus), cusumMinus: Array.from(cusumMinus),
  };
}

// ─── IS Divergence & Kendall ────────────────────────────────────────────────

export function itakuraSaitoDivergence(
  target: number[],
  current: number[],
  floor = 1e-6
): number {
  const n = Math.min(target.length, current.length);
  let d = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.max(floor, Math.pow(10, target[i] / 10));
    const q = Math.max(floor, Math.pow(10, current[i] / 10));
    const r = p / q;
    d += r - Math.log(r) - 1;
  }
  return d / (n || 1);
}

export function rankProfilesByIS(
  gainsCurrent: number[],
  templates: Array<{ id: string; template: number[] }>,
  floor = 1e-6
): Array<{ id: string; divergence: number; similarity: number }> {
  const ranked = templates.map(({ id, template }) => ({
    id,
    divergence: itakuraSaitoDivergence(template, gainsCurrent, floor),
  }));
  ranked.sort((a, b) => a.divergence - b.divergence);
  const sims = ranked.map((r) => ({ ...r, similarity: 1 / (1 + r.divergence) }));
  const sumTop3 = sims.slice(0, 3).reduce((s, r) => s + r.similarity, 0) || 1;
  return sims.map((r) => ({ ...r, similarity: r.similarity / sumTop3 }));
}

export function kendallTauB(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  let concordant = 0, discordant = 0, tiesX = 0, tiesY = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign(x[j] - x[i]);
      const dy = Math.sign(y[j] - y[i]);
      if (dx === 0) { tiesX++; continue; }
      if (dy === 0) { tiesY++; continue; }
      if (dx === dy) concordant++;
      else           discordant++;
    }
  }
  const n0 = n * (n - 1) / 2;
  const denom = Math.sqrt((n0 - tiesX) * (n0 - tiesY));
  return denom < 1e-9 ? 0 : (concordant - discordant) / denom;
}

export function distanceCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2 || y.length !== n) return 0;
  const A: number[][] = [], B: number[][] = [];
  for (let i = 0; i < n; i++) {
    A.push(new Array(n));
    B.push(new Array(n));
    for (let j = 0; j < n; j++) {
      A[i][j] = Math.abs(x[i] - x[j]);
      B[i][j] = Math.abs(y[i] - y[j]);
    }
  }
  const center = (M: number[][]) => {
    const rowM = M.map((r) => mean(r));
    const colM = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += M[i][j];
      colM[j] = s / n;
    }
    let grand = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) grand += M[i][j];
    grand /= n * n;
    const C: number[][] = [];
    for (let i = 0; i < n; i++) {
      C.push(new Array(n));
      for (let j = 0; j < n; j++) C[i][j] = M[i][j] - rowM[i] - colM[j] + grand;
    }
    return C;
  };
  const Ac = center(A), Bc = center(B);
  const dot = (P: number[][], Q: number[][]) => {
    let s = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s += P[i][j] * Q[i][j];
    return s / (n * n);
  };
  const dCovXY = dot(Ac, Bc);
  const dVarX  = dot(Ac, Ac);
  const dVarY  = dot(Bc, Bc);
  const denom  = Math.sqrt(Math.max(0, dVarX * dVarY));
  if (denom < 1e-12) return 0;
  return Math.sqrt(Math.max(0, dCovXY) / denom);
}

export function bradleyTerryScores(
  items: string[],
  comparisons: Array<{ winner: string; loser: string; weight?: number }>,
  opts: { iterations?: number; tol?: number } = {}
): Record<string, number> {
  const idx = new Map(items.map((it, i) => [it, i]));
  const n = items.length;
  const wins  = new Array(n).fill(0);
  const games = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const c of comparisons) {
    const i = idx.get(c.winner), j = idx.get(c.loser);
    if (i === undefined || j === undefined) continue;
    const w = c.weight ?? 1;
    wins[i] += w;
    games[i][j] += w;
    games[j][i] += w;
  }
  let s = new Array(n).fill(1);
  const iter = opts.iterations ?? 200;
  const tol  = opts.tol ?? 1e-7;
  for (let t = 0; t < iter; t++) {
    const sNext = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let denom = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        denom += games[i][j] / (s[i] + s[j]);
      }
      sNext[i] = denom > 0 ? wins[i] / denom : s[i];
    }
    const sum = sNext.reduce((a, b) => a + b, 0);
    const norm = sum > 0 ? n / sum : 1;
    for (let i = 0; i < n; i++) sNext[i] *= norm;
    s = sNext;
  }
  const result: Record<string, number> = {};
  items.forEach((it, i) => (result[it] = s[i]));
  return result;
}

export function kendallBandCoherence(
  prefs: Array<{ scenario: string; choice: 'A' | 'B' | 'NOT_SURE' | 'DISLIKE_BOTH' }>,
  abGains: Record<string, { A: number[]; B: number[] }>,
  threshold = 1.0
): number[] {
  const taus = new Array(10).fill(0);
  for (let band = 0; band < 10; band++) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of prefs) {
      const ab = abGains[p.scenario];
      if (!ab) continue;
      const delta = ab.A[band] - ab.B[band];
      if (Math.abs(delta) < threshold) continue;
      xs.push(delta);
      if (p.choice === 'NOT_SURE' || p.choice === 'DISLIKE_BOTH') {
        ys.push(0);
      } else {
        ys.push(p.choice === 'A' ? +1 : -1);
      }
    }
    taus[band] = xs.length >= 2 ? kendallTauB(xs, ys) : 0;
  }
  return taus;
}
