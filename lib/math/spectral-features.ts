import { chirpZTransform } from './czTransform';
import { WelchResult } from './spectral-enhancement';

export interface SpectralFeatures {
  spectralCentroid: number;
  spectralRolloff: number;
  spectralSpread: number;
  spectralSkewness: number;
  spectralKurtosis: number;
  spectralFlux: number;
  highResPeaks: number[];
}

/**
 * Computes advanced spectral metrics from the Welch's method output.
 */
export function extractSpectralFeatures(
  welchResult: WelchResult,
  previousPowerDb?: number[]
): SpectralFeatures {
  const { frequencies, powerDb } = welchResult;
  
  if (frequencies.length === 0) {
    return {
      spectralCentroid: 0,
      spectralRolloff: 0,
      spectralSpread: 0,
      spectralSkewness: 0,
      spectralKurtosis: 0,
      spectralFlux: 0,
      highResPeaks: [],
    };
  }

  // Convert dB to linear magnitude (power) for statistical metrics
  const linearPower = powerDb.map(db => Math.pow(10, db / 10));
  const totalPower = linearPower.reduce((sum, val) => sum + val, 0);

  // 1. Spectral Centroid
  let centroidNumerator = 0;
  for (let i = 0; i < frequencies.length; i++) {
    centroidNumerator += frequencies[i] * linearPower[i];
  }
  const spectralCentroid = totalPower > 0 ? centroidNumerator / totalPower : 0;

  // 2. Spectral Spread (Variance)
  let spreadNumerator = 0;
  for (let i = 0; i < frequencies.length; i++) {
    spreadNumerator += Math.pow(frequencies[i] - spectralCentroid, 2) * linearPower[i];
  }
  const spectralSpread = totalPower > 0 ? Math.sqrt(spreadNumerator / totalPower) : 0;

  // 3. Spectral Skewness and Kurtosis
  let skewNumerator = 0;
  let kurtNumerator = 0;
  if (spectralSpread > 0) {
    for (let i = 0; i < frequencies.length; i++) {
      const diff = (frequencies[i] - spectralCentroid) / spectralSpread;
      skewNumerator += Math.pow(diff, 3) * linearPower[i];
      kurtNumerator += Math.pow(diff, 4) * linearPower[i];
    }
  }
  const spectralSkewness = totalPower > 0 ? skewNumerator / totalPower : 0;
  const spectralKurtosis = totalPower > 0 ? kurtNumerator / totalPower : 0;

  // 4. Spectral Rolloff (85th percentile of power)
  const rolloffThreshold = totalPower * 0.85;
  let runningPower = 0;
  let spectralRolloff = 0;
  for (let i = 0; i < frequencies.length; i++) {
    runningPower += linearPower[i];
    if (runningPower >= rolloffThreshold) {
      spectralRolloff = frequencies[i];
      break;
    }
  }

  // 5. Spectral Flux
  let spectralFlux = 0;
  if (previousPowerDb && previousPowerDb.length === powerDb.length) {
    const prevLinearPower = previousPowerDb.map(db => Math.pow(10, db / 10));
    for (let i = 0; i < frequencies.length; i++) {
      const diff = linearPower[i] - prevLinearPower[i];
      if (diff > 0) {
        spectralFlux += diff;
      }
    }
  }

  return {
    spectralCentroid,
    spectralSpread,
    spectralSkewness,
    spectralKurtosis,
    spectralRolloff,
    spectralFlux,
    highResPeaks: [],
  };
}

/**
 * Refines a peak frequency using Chirp Z-Transform (CZT) for high resolution.
 * @param timeDomain The original time-domain signal.
 * @param approximateFreq The rough frequency estimate of the peak (e.g., from FFT/Welch).
 * @param searchBandwidth The frequency range around the peak to zoom in on (e.g., +/- 50 Hz).
 * @param numPoints The number of points to evaluate inside the search band.
 * @param sampleRate The spatial frequency of the time domain signal.
 */
export function refinePeakWithCZT(
  timeDomain: Float32Array,
  approximateFreq: number,
  searchBandwidth: number,
  numPoints: number,
  sampleRate: number
): number {
  if (timeDomain.length === 0) return approximateFreq;

  const freqStart = Math.max(0, approximateFreq - searchBandwidth / 2);
  const freqEnd = Math.min(sampleRate / 2, approximateFreq + searchBandwidth / 2);

  const cztResult = chirpZTransform(timeDomain, freqStart, freqEnd, numPoints, sampleRate);

  let maxMag = -Infinity;
  let refinedFreq = approximateFreq;

  for (let i = 0; i < cztResult.mag.length; i++) {
    if (cztResult.mag[i] > maxMag) {
      maxMag = cztResult.mag[i];
      refinedFreq = cztResult.freq[i];
    }
  }

  return refinedFreq;
}
