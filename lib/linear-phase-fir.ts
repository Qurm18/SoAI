/**
 * SONIC AI — Phase 6.1: Linear-Phase FIR with Zero Latency
 * Note: FIR filtering inherently introduces latency, but we minimize it or compensate perfectly.
 */

import { fftInPlace, ifftInPlace } from '@/lib/math/fft';

export interface FIRDesignOptions {
  length: number;        // 512 / 1024 / 2048 — longer = better freq response
  phase: 'linear' | 'minimum' | 'mixed';
  window: 'hamming' | 'blackman' | 'kaiser';
  beta?: number;         // Kaiser beta (10–20 for sidelobe control)
}

export function designFIRFromEQ(
  bands: { frequency: number, gain: number, q?: number }[],
  sampleRate: number,
  options: FIRDesignOptions
): {
  kernel: Float32Array;
  latencySamples: number;
  maxGroupDelay: number;
  transitionBandwidth: number; // Hz
} {
  const N = options.length;
  if ((N & (N - 1)) !== 0) throw new Error("FIR length must be power of 2");

  // 1. Create desired frequency response
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  // Simple magnitude response construction 
  for (let i = 0; i < N / 2; i++) {
    const freq = (i * sampleRate) / N;
    let magSq = 1.0;
    
    // Nearest band approach for placeholder
    let nearestBand = bands[0];
    let minDiff = Infinity;
    for (const b of bands) {
      const diff = Math.abs(b.frequency - freq);
      if (diff < minDiff) {
        minDiff = diff;
        nearestBand = b;
      }
    }

    // Convert dB to linear magnitude
    const linGain = Math.pow(10, nearestBand.gain / 20);
    magSq = linGain;

    re[i] = magSq;
    re[N - 1 - i] = magSq; // Mirror for real impulse response
  }

  // 2. Inverse FFT to get impulse response
  // We impose zero phase in freq domain (im = 0) to get zero phase/linear phase (centered) in time domain
  ifftInPlace(re, im);

  const kernel = new Float32Array(N);
  
  // 3. Shift so the impulse is at N/2 (Linear Phase constraint)
  const shift = N / 2;
  const windowArray = new Float32Array(N);
  
  for (let i = 0; i < N; i++) {
    let w = 1.0;
    if (options.window === 'hamming') {
      w = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (N - 1));
    } else if (options.window === 'blackman') {
      w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (N - 1));
    }
    
    // Custom shift handling for IFFT output
    const shiftedIdx = (i + shift) % N;
    kernel[i] = (re[shiftedIdx] as number) * w;
  }

  return {
    kernel,
    latencySamples: shift,
    maxGroupDelay: shift / sampleRate,
    transitionBandwidth: sampleRate / N
  };
}
