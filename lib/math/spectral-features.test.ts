import { describe, it, expect } from 'vitest';
import { extractSpectralFeatures, refinePeakWithCZT } from './spectral-features';
import { WelchResult } from './spectral-enhancement';

describe('Spectral Feature Extraction', () => {
  it('computes basic statistical moments from a spectrum', () => {
    // Generate a flat spectrum except for a single spike
    const frequencies = [100, 200, 300, 400, 500];
    const powerDb = [ -100, -100, 0, -100, -100 ]; // Spike at 300 Hz

    const mockWelchResult: WelchResult = {
      frequencies,
      powerDb,
      coherence: [],
    };

    const features = extractSpectralFeatures(mockWelchResult);
    
    // Centroid should be heavily weighted towards the spike at 300 Hz
    expect(features.spectralCentroid).toBeCloseTo(300, 1);
    
    // Spread should be very low since energy is concentrated
    expect(features.spectralSpread).toBeLessThan(50);
  });

  describe('refinePeakWithCZT', () => {
    it('refines an approximate FFT peak to higher precision', () => {
      const fs = 44100;
      const trueFreq = 1012.3;
      const N = 1024;
      
      const signal = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        signal[i] = Math.sin((2 * Math.PI * trueFreq * i) / fs);
      }
      
      // Assume basic FFT puts the bin at 1000 Hz or 1043 Hz.
      // We pass an approximate estimate of 1000 Hz, search +/- 50 Hz.
      const refined = refinePeakWithCZT(signal, 1000, 100, 200, fs);
      
      // Expected precision: 100Hz range / 200 points = 0.5Hz resolution.
      expect(Math.abs(refined - trueFreq)).toBeLessThan(1.0);
    });
  });
});
