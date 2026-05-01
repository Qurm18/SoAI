/**
 * SONIC AI — Phase 1.2: Chirp Z-Transform (CZT)
 *
 * Compute arbitrary frequency range at high resolution without full-size FFT.
 * Achieves O(N log N) performance via Bluestein's algorithm.
 */

import { fftInPlace, ifftInPlace } from './fft';

export function chirpZTransform(
  timeDomain: Float32Array | Float64Array | number[],
  freqStart: number,
  freqEnd: number,
  numPoints: number,
  sampleRate: number
): { freq: number[]; mag: number[]; phase: number[] } {
  const N = timeDomain.length;
  const M = numPoints;

  if (N === 0 || M === 0) {
    return { freq: [], mag: [], phase: [] };
  }

  const dTheta = (2 * Math.PI * (freqEnd - freqStart)) / (Math.max(1, M - 1) * sampleRate);
  const theta0 = (2 * Math.PI * freqStart) / sampleRate;

  // L is next power of 2 >= N + M - 1
  let L = 1;
  while (L < N + M - 1) {
    L <<= 1;
  }

  // 1. g[n] = x[n] * A^(-n) * W^(n^2 / 2)
  // W^(n^2 / 2) = exp(-j * dTheta * n^2 / 2)
  // A^(-n) = exp(-j * theta0 * n)
  const gRe = new Float64Array(L);
  const gIm = new Float64Array(L);
  for (let n = 0; n < N; n++) {
    const phase = -theta0 * n - 0.5 * dTheta * n * n;
    gRe[n] = (timeDomain[n] as number) * Math.cos(phase);
    gIm[n] = (timeDomain[n] as number) * Math.sin(phase);
  }

  // 2. h[n] = W^(-n^2 / 2) = exp(j * dTheta * n^2 / 2)
  const hRe = new Float64Array(L);
  const hIm = new Float64Array(L);
  for (let n = 0; n < M; n++) {
    const phase = 0.5 * dTheta * n * n;
    hRe[n] = Math.cos(phase);
    hIm[n] = Math.sin(phase);
  }
  for (let n = 1; n < N; n++) {
    const phase = 0.5 * dTheta * n * n;
    hRe[L - n] = Math.cos(phase);
    hIm[L - n] = Math.sin(phase);
  }

  // 3. FFT(g) and FFT(h)
  fftInPlace(gRe, gIm);
  fftInPlace(hRe, hIm);

  // 4. Multiply
  for (let k = 0; k < L; k++) {
    const r = gRe[k] * hRe[k] - gIm[k] * hIm[k];
    const i = gRe[k] * hIm[k] + gIm[k] * hRe[k];
    gRe[k] = r;
    gIm[k] = i;
  }

  // 5. IFFT
  ifftInPlace(gRe, gIm);

  // 6. X_k = (g*h)_k * W^(k^2 / 2) = (g*h)_k * exp(-j * dTheta * k^2 / 2)
  const freq = new Array(M);
  const mag = new Array(M);
  const phaseOut = new Array(M);

  const df = (freqEnd - freqStart) / Math.max(1, M - 1);

  for (let k = 0; k < M; k++) {
    const p = -0.5 * dTheta * k * k;
    const cw = Math.cos(p);
    const sw = Math.sin(p);

    const r = gRe[k] * cw - gIm[k] * sw;
    const i = gRe[k] * sw + gIm[k] * cw;

    freq[k] = freqStart + k * df;
    mag[k] = Math.sqrt(r * r + i * i);
    phaseOut[k] = Math.atan2(i, r);
  }

  return { freq, mag, phase: phaseOut };
}
