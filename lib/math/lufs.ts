/**
 * SONIC — LUFS Loudness Measurement
 */

export interface BiquadCoeffs { b0: number; b1: number; b2: number; a1: number; a2: number; }

export function kWeightingFilters(sampleRate: number): { stage1: BiquadCoeffs; stage2: BiquadCoeffs } {
  const f0_1 = 1681.974450955533;
  const G_1  = 3.999843853973347;
  const Q_1  = 0.7071752369554196;
  const f0_2 = 38.13547087602444;
  const Q_2  = 0.5003270373238773;

  const biquadHighShelf = (fs: number): BiquadCoeffs => {
    const K = Math.tan(Math.PI * f0_1 / fs);
    const Vh = Math.pow(10, G_1 / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q_1 + K * K;
    return {
      b0: (Vh + Vb * K / Q_1 + K * K) / a0,
      b1: 2 * (K * K - Vh) / a0,
      b2: (Vh - Vb * K / Q_1 + K * K) / a0,
      a1: 2 * (K * K - 1) / a0,
      a2: (1 - K / Q_1 + K * K) / a0,
    };
  };
  const biquadHighPass = (fs: number): BiquadCoeffs => {
    const K = Math.tan(Math.PI * f0_2 / fs);
    const a0 = 1 + K / Q_2 + K * K;
    return {
      b0: 1 / a0,
      b1: -2 / a0,
      b2: 1 / a0,
      a1: 2 * (K * K - 1) / a0,
      a2: (1 - K / Q_2 + K * K) / a0,
    };
  };
  return {
    stage1: biquadHighShelf(sampleRate),
    stage2: biquadHighPass(sampleRate),
  };
}

export function applyBiquad(input: Float32Array, c: BiquadCoeffs, output?: Float32Array): Float32Array {
  const out = output ?? new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return out;
}

/**
 * Integrated loudness in LUFS.
 */
export function integratedLufs(samples: Float32Array, sampleRate: number): number {
  const { stage1, stage2 } = kWeightingFilters(sampleRate);
  const after1 = applyBiquad(samples, stage1);
  const kw     = applyBiquad(after1, stage2);

  const blockSize  = Math.round(sampleRate * 0.4);
  const hopSize    = Math.round(sampleRate * 0.1);
  const blockMs: number[] = [];

  for (let start = 0; start + blockSize <= kw.length; start += hopSize) {
    let ms = 0;
    for (let i = 0; i < blockSize; i++) {
      const v = kw[start + i];
      ms += v * v;
    }
    blockMs.push(ms / blockSize);
  }
  if (blockMs.length === 0) return -Infinity;

  const blockL = blockMs.map((ms) => -0.691 + 10 * Math.log10(Math.max(1e-12, ms)));
  const above70 = blockL.map((l, i) => ({ l, ms: blockMs[i] })).filter(({ l }) => l > -70);
  if (above70.length === 0) return -Infinity;

  const gatedMean1 = above70.reduce((a, b) => a + b.ms, 0) / above70.length;
  const gatedL1    = -0.691 + 10 * Math.log10(Math.max(1e-12, gatedMean1));
  const relGate    = gatedL1 - 10;
  const above_rel  = above70.filter(({ l }) => l > relGate);
  if (above_rel.length === 0) return gatedL1;

  const finalMean = above_rel.reduce((a, b) => a + b.ms, 0) / above_rel.length;
  return -0.691 + 10 * Math.log10(Math.max(1e-12, finalMean));
}
