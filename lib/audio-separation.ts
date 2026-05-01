import { fftInPlace } from '@/lib/math/fft';

// ─── Type Definitions ────────────────────────────────────────────────────

export interface HPSSConfig {
  fftSize: number;           // e.g., 2048 (default ~43 ms @ 48 kHz)
  hopSize: number;           // e.g., 512 (25% overlap)
  harmonicKernelSize: number; // Horizontal median filter width
  percussiveKernelSize: number; // Vertical median filter width
  margin: number;            // Margin (dB) to soften mask edges [1, 5]
  blendMode: 'soft' | 'hard'; // Soft: smooth masks; Hard: binary
}

export interface HPSSResult {
  harmonic: {
    timeDomain: Float32Array;
    stft: Complex[][];
    gains: number[];          // Per-band EQ suggestion
    characteristics: string[];
  };
  percussive: {
    timeDomain: Float32Array;
    stft: Complex[][];
    gains: number[];          // Per-band EQ suggestion
    characteristics: string[];
  };
  analysis: {
    harmonicRatio: number;    // 0–1, proportion harmonic
    percussiveRatio: number;
    dominantFrequencies: number[];
    transientActivity: number; // 0–1
  };
}

export interface Complex {
  re: number;
  im: number;
}

// ─── STFT Implementation ──────────────────────────────────────────────────

function hannWindow(n: number, N: number): number {
  return 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
}

function computeSTFT(
  timeDomain: Float32Array,
  fftSize: number,
  hopSize: number
): {
  spectrogram: Array<Complex[]>;
  magnitudes: number[][];
  phases: number[][];
  windows: number;
  sampleRate: number;
} {
  const numFrames = Math.floor((timeDomain.length - fftSize) / hopSize) + 1;
  const spectrogram: Array<Complex[]> = [];
  const magnitudes: number[][] = [];
  const phases: number[][] = [];

  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = hannWindow(i, fftSize);
  }

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    const segment = timeDomain.slice(start, start + fftSize);

    // Apply window
    const windowed = new Float64Array(fftSize);
    for (let i = 0; i < segment.length; i++) {
      windowed[i] = segment[i] * window[i];
    }

    // FFT
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      re[i] = windowed[i];
    }
    fftInPlace(re, im);

    // Store complex spectrum
    const frameSpectrum: Complex[] = [];
    const frameMagnitudes: number[] = [];
    const framePhases: number[] = [];

    for (let k = 0; k <= fftSize / 2; k++) {
      const mag = Math.sqrt(re[k] ** 2 + im[k] ** 2);
      const phase = Math.atan2(im[k], re[k]);

      frameSpectrum.push({ re: re[k], im: im[k] });
      frameMagnitudes.push(mag);
      framePhases.push(phase);
    }

    spectrogram.push(frameSpectrum);
    magnitudes.push(frameMagnitudes);
    phases.push(framePhases);
  }

  return { spectrogram, magnitudes, phases, windows: numFrames, sampleRate: 1 };
}

// ─── Median Filter (Horizontal & Vertical) ────────────────────────────────

function medianFilter1D(data: number[], kernelSize: number): number[] {
  const half = Math.floor(kernelSize / 2);
  const result = new Array(data.length);

  for (let i = 0; i < data.length; i++) {
    const window: number[] = [];
    for (let j = -half; j <= half; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < data.length) {
        window.push(data[idx]);
      }
    }
    window.sort((a, b) => a - b);
    result[i] = window[Math.floor(window.length / 2)];
  }

  return result;
}

function verticalMedianFilter(
  spectrogram: number[][],
  kernelSize: number
): number[][] {
  // Apply vertical median filter (across frequency bins at fixed frame)
  const result = spectrogram.map((frame) => medianFilter1D(frame, kernelSize));
  return result;
}

function horizontalMedianFilter(
  spectrogram: number[][],
  kernelSize: number
): number[][] {
  // Apply horizontal median filter (across time at fixed frequency)
  const numFreqs = spectrogram[0].length;
  const numFrames = spectrogram.length;
  const result = Array.from({ length: numFrames }, () => new Array(numFreqs));

  for (let k = 0; k < numFreqs; k++) {
    const freqTimeline: number[] = [];
    for (let t = 0; t < numFrames; t++) {
      freqTimeline.push(spectrogram[t][k]);
    }

    const filtered = medianFilter1D(freqTimeline, kernelSize);
    for (let t = 0; t < numFrames; t++) {
      result[t][k] = filtered[t];
    }
  }

  return result as number[][];
}

// ─── REPET-SIM Algorithm ──────────────────────────────────────────────────

export function harmonicPercussiveSeparation(
  timeDomain: Float32Array,
  sampleRate: number,
  config: Partial<HPSSConfig> = {}
): HPSSResult {
  const fftSize = config.fftSize ?? 2048;
  const hopSize = config.hopSize ?? fftSize / 4;
  const harmonicKernelSize = config.harmonicKernelSize ?? 31; // ~700 ms @ 48 kHz
  const percussiveKernelSize = config.percussiveKernelSize ?? 5; // ~40 ms
  const margin = config.margin ?? 2; // dB
  const blendMode = config.blendMode ?? 'soft';

  // Step 1: Compute STFT
  const { spectrogram, magnitudes, phases, windows: numFrames } = computeSTFT(
    timeDomain,
    fftSize,
    hopSize
  );

  // Step 2: Apply median filters
  // Harmonic = horizontal (smooth over time) — sustained tones remain
  const harmonicMedian = horizontalMedianFilter(magnitudes, harmonicKernelSize);

  // Percussive = vertical (smooth over frequency) — transients remain
  const percussiveMedian = verticalMedianFilter(magnitudes, percussiveKernelSize);

  // Step 3: Wiener mask (soft masking)
  // H-mask: harmonic / (harmonic + percussive + ε)
  // P-mask: percussive / (harmonic + percussive + ε)
  const eps = 1e-10;
  const harmonicMasks: number[][] = [];
  const percussiveMasks: number[][] = [];

  for (let t = 0; t < numFrames; t++) {
    const harmonicMask: number[] = [];
    const percussiveMask: number[] = [];

    for (let k = 0; k < magnitudes[t].length; k++) {
      const h = harmonicMedian[t][k];
      const p = percussiveMedian[t][k];
      const total = h + p + eps;

      let hMask = h / total;
      let pMask = p / total;

      if (blendMode === 'hard') {
        // Binary masking: winner takes all
        if (hMask > 0.5) {
          hMask = 1;
          pMask = 0;
        } else {
          hMask = 0;
          pMask = 1;
        }
      } else {
        // Soft masking with margin (smooth transitions)
        const marginDb = margin;
        const marginLin = Math.pow(10, marginDb / 20);

        hMask = hMask / (hMask + pMask * marginLin + eps);
        pMask = 1 - hMask;
      }

      harmonicMask.push(hMask);
      percussiveMask.push(pMask);
    }

    harmonicMasks.push(harmonicMask);
    percussiveMasks.push(percussiveMask);
  }

  // Step 4: Apply masks to STFT
  const harmonicSpectrogram: Complex[][] = [];
  const percussiveSpectrogram: Complex[][] = [];

  for (let t = 0; t < numFrames; t++) {
    const harmonicFrame: Complex[] = [];
    const percussiveFrame: Complex[] = [];

    for (let k = 0; k < spectrogram[t].length; k++) {
      const { re, im } = spectrogram[t][k];
      const hMask = harmonicMasks[t][k];
      const pMask = percussiveMasks[t][k];

      harmonicFrame.push({
        re: re * hMask,
        im: im * hMask,
      });

      percussiveFrame.push({
        re: re * pMask,
        im: im * pMask,
      });
    }

    harmonicSpectrogram.push(harmonicFrame);
    percussiveSpectrogram.push(percussiveFrame);
  }

  // Step 5: ISTFT (convert back to time domain)
  const harmonicTD = istft(harmonicSpectrogram, fftSize, hopSize, timeDomain.length);
  const percussiveTD = istft(percussiveSpectrogram, fftSize, hopSize, timeDomain.length);

  // Step 6: Analyze and suggest EQ
  const harmonicGains = analyzeHarmonic(harmonicSpectrogram, sampleRate, fftSize);
  const percussiveGains = analyzePercussive(percussiveSpectrogram, sampleRate, fftSize);

  // Step 7: Analysis metrics
  const harmonicEnergy = computeEnergy(harmonicTD);
  const percussiveEnergy = computeEnergy(percussiveTD);
  const totalEnergy = harmonicEnergy + percussiveEnergy;

  const analysis = {
    harmonicRatio: harmonicEnergy / totalEnergy,
    percussiveRatio: percussiveEnergy / totalEnergy,
    dominantFrequencies: findDominantFrequencies(harmonicSpectrogram, sampleRate, fftSize),
    transientActivity: computeTransientActivity(percussiveSpectrogram),
  };

  return {
    harmonic: {
      timeDomain: harmonicTD,
      stft: harmonicSpectrogram,
      gains: harmonicGains,
      characteristics: characterizeHarmonic(harmonicGains),
    },
    percussive: {
      timeDomain: percussiveTD,
      stft: percussiveSpectrogram,
      gains: percussiveGains,
      characteristics: characterizePercussive(percussiveGains),
    },
    analysis,
  };
}

// ─── ISTFT (Inverse STFT) ────────────────────────────────────────────────

function istft(
  spectrogram: Complex[][],
  fftSize: number,
  hopSize: number,
  originalLength: number
): Float32Array {
  const result = new Float32Array(originalLength);
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  for (let frame = 0; frame < spectrogram.length; frame++) {
    const start = frame * hopSize;
    if (start + fftSize > result.length) break;

    // IFFT
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);

    for (let k = 0; k < spectrogram[frame].length; k++) {
      re[k] = spectrogram[frame][k].re;
      im[k] = spectrogram[frame][k].im;
    }

    // Since we're doing the inverse FFT of a real signal, we fill the symmetry
    for (let k = 1; k < spectrogram[frame].length - 1; k++) {
      re[fftSize - k] = re[k];
      im[fftSize - k] = -im[k];
    }

    // Conjugate, FFT, conjugate again for IFFT
    for (let i = 0; i < fftSize; i++) im[i] = -im[i];
    fftInPlace(re, im);
    for (let i = 0; i < fftSize; i++) {
      re[i] /= fftSize;
      im[i] = -im[i] / fftSize;
    }

    // Apply window and add to result
    for (let i = 0; i < fftSize && start + i < result.length; i++) {
      result[start + i] += (re[i] as number) * window[i];
    }
  }

  return result;
}

// ─── Analysis Functions ──────────────────────────────────────────────────

function analyzeHarmonic(
  spectrogram: Complex[][],
  sampleRate: number,
  fftSize: number
): number[] {
  // Harmonic content suggests: clarity, presence, vocal focus
  // Suggest: boost 1–5 kHz (presence), reduce 100–250 Hz (mud), control 8+ kHz (harshness)

  const gains = new Array(10).fill(0);
  const meanSpectrum = computeMeanMagnitude(spectrogram);

  // Spectral centroid of harmonic component
  let centroid = 0;
  let totalPower = 0;
  for (let k = 0; k < meanSpectrum.length; k++) {
    const freq = (k * sampleRate) / fftSize;
    centroid += freq * meanSpectrum[k];
    totalPower += meanSpectrum[k];
  }
  centroid = totalPower > 0 ? centroid / totalPower : 0;

  // EQ suggestion based on spectral shape
  if (centroid < 2000) {
    // Low centroid: muddy, needs presence lift
    gains[4] += 1; // 500 Hz
    gains[5] += 1.5; // 1 kHz
    gains[6] += 1.5; // 2 kHz
  } else if (centroid > 5000) {
    // High centroid: thin, needs low-mid support
    gains[3] += 1; // 250 Hz
    gains[4] += 0.5; // 500 Hz
  }

  // Reduce harshness if high-energy harmonics at 5–8 kHz
  const startIdx = Math.floor((5000 * fftSize) / sampleRate);
  const endIdx = Math.min(meanSpectrum.length, Math.floor((8000 * fftSize) / sampleRate));
  const hs = meanSpectrum.slice(startIdx, endIdx);
  if (hs.length > 0 && hs.reduce((a, b) => a + b, 0) / hs.length > 0.3) {
    gains[7] -= 0.5; // 4 kHz
    gains[8] -= 1; // 8 kHz
  }

  return gains;
}

function analyzePercussive(
  spectrogram: Complex[][],
  sampleRate: number,
  fftSize: number
): number[] {
  // Percussive content suggests: impact, definition, transient clarity
  // Suggest: boost 80–250 Hz (punch), 5 kHz (attack), control 1–2 kHz (mud)

  const gains = new Array(10).fill(0);
  const transientSharpness = computeTransientActivity(spectrogram);

  if (transientSharpness > 0.6) {
    // Prominent transients: enhance punch and definition
    gains[1] += 1; // 64 Hz
    gains[2] += 1.5; // 125 Hz
    gains[3] += 0.5; // 250 Hz
    gains[6] += 1.5; // 2 kHz
    gains[7] += 1; // 4 kHz
  } else {
    // Soft transients: smooth them out
    gains[2] += 0.5;
    gains[3] += 0.5;
  }

  // Reduce mud mask
  gains[4] -= 0.5; // 500 Hz

  return gains;
}

function computeMeanMagnitude(spectrogram: Complex[][]): number[] {
  if (spectrogram.length === 0) return [];

  const numBins = spectrogram[0].length;
  const mean = new Array(numBins).fill(0);

  for (const frame of spectrogram) {
    for (let k = 0; k < numBins; k++) {
      mean[k] += Math.sqrt(frame[k].re ** 2 + frame[k].im ** 2);
    }
  }

  for (let k = 0; k < numBins; k++) {
    mean[k] /= spectrogram.length;
  }

  return mean;
}

function computeEnergy(timeDomain: Float32Array): number {
  let energy = 0;
  for (let i = 0; i < timeDomain.length; i++) {
    energy += timeDomain[i] ** 2;
  }
  return energy;
}

function computeTransientActivity(spectrogram: Complex[][]): number {
  if (spectrogram.length === 0) return 0;
  // High flux = more transients
  let flux = 0;
  for (let t = 1; t < spectrogram.length; t++) {
    for (let k = 0; k < spectrogram[t].length; k++) {
      const mag1 = Math.sqrt(spectrogram[t - 1][k].re ** 2 + spectrogram[t - 1][k].im ** 2);
      const mag2 = Math.sqrt(spectrogram[t][k].re ** 2 + spectrogram[t][k].im ** 2);
      flux += Math.max(0, mag2 - mag1); // Only positive flux
    }
  }
  const maxFlux = spectrogram.length * spectrogram[0].length * 0.5;
  return Math.min(1, flux / maxFlux);
}

function findDominantFrequencies(
  spectrogram: Complex[][],
  sampleRate: number,
  fftSize: number
): number[] {
  const meanMag = computeMeanMagnitude(spectrogram);
  const peaks: Array<{ freq: number; mag: number }> = [];

  for (let k = 1; k < meanMag.length - 1; k++) {
    if (meanMag[k] > meanMag[k - 1] && meanMag[k] > meanMag[k + 1]) {
      const freq = (k * sampleRate) / fftSize;
      peaks.push({ freq, mag: meanMag[k] });
    }
  }

  return peaks
    .sort((a, b) => b.mag - a.mag)
    .slice(0, 5)
    .map((p) => p.freq);
}

function characterizeHarmonic(gains: number[]): string[] {
  const chars: string[] = [];
  const boost = gains.reduce((a, b) => a + b, 0);

  if (boost > 3) chars.push('Forward & bright');
  if (Math.abs(gains[5]) > 1.5) chars.push('Presence boost');
  if (Math.abs(gains[3]) > 1) chars.push('Warm body');
  if (gains[8] < -0.5) chars.push('Smooth treble');

  return chars.length > 0 ? chars : ['Balanced'];
}

function characterizePercussive(gains: number[]): string[] {
  const chars: string[] = [];
  const bassBounce = Math.abs(gains[1]) + Math.abs(gains[2]);

  if (bassBounce > 2) chars.push('Punchy bass');
  if (Math.abs(gains[6]) > 1) chars.push('Clear attack');
  if (Math.abs(gains[7]) > 1) chars.push('Articulate');

  return chars.length > 0 ? chars : ['Neutral'];
}
