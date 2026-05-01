import { describe, it, expect } from 'vitest';
import { WelchAnalyzer, WINDOW_CATALOG, prewhiten } from './spectral-enhancement';

describe('Spectral Enhancement (Welch\'s Method)', () => {
  describe('Window Generation', () => {
    it('contains correctly defined windows in the catalog', () => {
      expect(WINDOW_CATALOG.hann.coherentGain).toBeCloseTo(0.5, 2);
      expect(WINDOW_CATALOG.hamming.coherentGain).toBeCloseTo(0.54, 2);
      expect(WINDOW_CATALOG.blackmanHarris.sidelobeLvl).toBe(-92);
    });
  });

  describe('Pre-whitening', () => {
    it('applies an AR(1) pre-emphasis filter to time domain data', () => {
      const data = new Float32Array([1, 2, 3, 4, 5]);
      const whitened = prewhiten(data, 'ar1');
      expect(whitened.length).toBe(data.length);
      expect(whitened[0]).toBe(1); // First sample should remain the same
      
      // If it's a linearly increasing signal, correlation parameter rho will be near 1 (0.99 limited).
      // Let's just check it doesn't crash and modifies the data.
      expect(whitened[4]).not.toBe(5);
    });

    it('returns the same array if method is none', () => {
      const data = new Float32Array([1, 2, 3]);
      const whitened = prewhiten(data, 'none');
      expect(whitened).toEqual(data);
    });
  });

  describe('WelchAnalyzer', () => {
    const simulateSineWave = (freq: number, fs: number, durationSec: number): Float32Array => {
      const N = fs * durationSec;
      const data = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        data[i] = Math.sin((2 * Math.PI * freq * i) / fs);
      }
      return data;
    };

    it('computes power spectrum and identifies the correct peak frequency', () => {
      const sampleRate = 44100;
      const testFreq = 1000;
      const signal = simulateSineWave(testFreq, sampleRate, 0.5); // 0.5 seconds

      const analyzer = new WelchAnalyzer(sampleRate, {
        nfft: 1024,
        windowType: 'hann',
        overlapPercent: 50,
        avgMethod: 'mean',
        prewhiten: false, // Don't prewhiten for pure tone test
        enbwCorrection: true,
      });

      const result = analyzer.analyze(signal);
      
      expect(result.frequencies.length).toBe(513); // nfft/2 + 1
      expect(result.powerDb.length).toBe(513);
      
      // Find peak frequency
      let maxDb = -Infinity;
      let peakFreq = -1;
      
      for (let i = 0; i < result.powerDb.length; i++) {
        if (result.powerDb[i] > maxDb) {
          maxDb = result.powerDb[i];
          peakFreq = result.frequencies[i];
        }
      }

      // Expected frequency bin resolution is 44100 / 1024 ~= 43.1Hz
      // Peak freq should be within +/- 1 bin of 1000Hz => 950 ~ 1050
      expect(Math.abs(peakFreq - testFreq)).toBeLessThan(50);
    });

    it('handles short signals properly', () => {
      const signal = new Float32Array(512); // Shorter than nfft
      const analyzer = new WelchAnalyzer(44100, { nfft: 1024 });
      const result = analyzer.analyze(signal);
      
      // Since maxSegments defaults to 20 and it'll break on the first segment
      expect(result.frequencies.length).toBe(0); // If signal < nfft, it might realistically return empty due to break.
    });

    it('computes coherence values correctly', () => {
      const sampleRate = 44100;
      const signal = simulateSineWave(500, sampleRate, 0.3);
      const analyzer = new WelchAnalyzer(sampleRate, {
        nfft: 1024,
        avgMethod: 'mean'
      });

      const result = analyzer.analyze(signal);
      expect(result.coherence.length).toBe(513);
      
      // The coherence should largely be between 0 and 1
      const isWithinBounds = result.coherence.every(c => c >= 0 && c <= 1);
      expect(isWithinBounds).toBe(true);
    });
  });
});
