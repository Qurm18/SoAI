import { describe, it, expect } from 'vitest';
import * as M from './index';

describe('Numerical Math & Signal Processing', () => {
  
  describe('CUSUM Drift Detection', () => {
    it('detects a clear upward shift in mean', () => {
      // Long enough signal to establish baseline then drift
      const baseline = new Array(20).fill(10);
      const drift = new Array(20).fill(20);
      const data = [...baseline, ...drift];
      const result = M.cusumDriftDetect(data, { h: 5, k: 0.5 });
      expect(result.driftDetected).toBe(true);
      expect(result.alarm).toBe(true);
      expect(result.changePoint).toBeGreaterThanOrEqual(15);
      expect(result.changePoint).toBeLessThanOrEqual(25);
    });

    it('detects downward drift', () => {
      const baseline = new Array(20).fill(20);
      const drift = new Array(20).fill(10);
      const data = [...baseline, ...drift];
      const result = M.cusumDriftDetect(data, { h: 5, k: 0.5 });
      expect(result.driftDetected).toBe(true);
      expect(result.postMean).toBeLessThan(result.preMean);
    });

    it('stays silent on stable signal', () => {
      const data = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11];
      const result = M.cusumDriftDetect(data, { h: 10 });
      expect(result.driftDetected).toBe(false);
    });
    
    it('uses provided baseline instead of sequence mean', () => {
       const data = [15, 16, 17, 18, 19];
       // mu0 should be 10 if baseline provided, otherwise ~17
       const result = M.cusumDriftDetect(data, { baseline: 10, h: 2, k: 0 });
       expect(result.driftDetected).toBe(true); // Should detect drift from 10
    });
  });

  describe('Psychometrics & Ranking', () => {
    describe('Thurstone Case V (Newton-Raphson)', () => {
      it('converges to correct relative scales for simple pairs', () => {
        const items = ['A', 'B'];
        const comparisons = [
          { winner: 'A', loser: 'B' },
          { winner: 'A', loser: 'B' },
          { winner: 'A', loser: 'B' },
        ];
        const fit = M.thurstoneFitCaseV(items, comparisons);
        expect(fit.scale['A']).toBeGreaterThan(fit.scale['B']);
        expect(fit.scale['A'] + fit.scale['B']).toBeCloseTo(0, 5);
        expect(fit.iterations).toBeLessThanOrEqual(20); 
      });

      it('handles balanced case correctly', () => {
        const items = ['A', 'B'];
        const comparisons = [
          { winner: 'A', loser: 'B' },
          { winner: 'B', loser: 'A' },
        ];
        const fit = M.thurstoneFitCaseV(items, comparisons);
        expect(fit.scale['A']).toBeCloseTo(0, 2);
        expect(fit.scale['B']).toBeCloseTo(0, 2);
      });
    });

    describe('Bradley-Terry-Luce Model', () => {
      it('estimates probabilities from winner/loser pairs', () => {
        const items = ['Strong', 'Weak'];
        const comps = [
          { winner: 'Strong', loser: 'Weak' },
          { winner: 'Strong', loser: 'Weak' },
          { winner: 'Strong', loser: 'Weak' },
        ];
        const scores = M.bradleyTerryScores(items, comps);
        expect(scores['Strong']).toBeGreaterThan(scores['Weak']);
        expect(scores['Strong'] + scores['Weak']).toBeCloseTo(2, 5);
      });
    });

    it('kendallBandCoherence detects band-wise agreement', () => {
      const prefs = [
        { scenario: 's1', choice: 'A' as const },
        { scenario: 's2', choice: 'B' as const },
      ];
      const abGains = {
        s1: { A: [2,0,0,0,0,0,0,0,0,0], B: [0,0,0,0,0,0,0,0,0,0] }, // Choice A matches Gain A > B
        s2: { A: [0,0,0,0,0,0,0,0,0,0], B: [2,0,0,0,0,0,0,0,0,0] }, // Choice B matches Gain B > A
      };
      const result = M.kendallBandCoherence(prefs, abGains);
      expect(result[0]).toBeCloseTo(1, 4); // Perfect agreement in Band 0
      expect(result[1]).toBe(0); // No delta in Band 1
    });
  });

  describe('Signal Analysis & Measurement', () => {
    it('integratedLufs measures loudness', () => {
      const fs = 44100;
      const samples = new Float32Array(fs).fill(0.1); 
      const lufs = M.integratedLufs(samples, fs);
      expect(lufs).toBeGreaterThan(-70);
      expect(isFinite(lufs)).toBe(true);
    });

    it('findPeaksParabolic localizes peaks between bins', () => {
      const data = [0, 0.1, 0.8, 0.9, 0.7, 0.1, 0];
      const peaks = M.findPeaksParabolic(new Float32Array(data));
      expect(peaks.length).toBe(1);
      expect(peaks[0].index).toBe(3);
      expect(peaks[0].magnitude).toBeGreaterThanOrEqual(0.9);
    });

    it('spectralReassignment improves frequency resolution', () => {
      const N = 2048;
      const fs = 44100;
      const signal = new Float64Array(N);
      const fRef = 1000.5; 
      for (let n = 0; n < N; n++) {
        signal[n] = Math.sin(2 * Math.PI * fRef * n / fs);
      }
      const { freqHz, magnitude } = M.spectralReassignment(signal, fs);
      let maxIdx = -1, maxVal = -1;
      // Search narrow range around expected bin
      const startBin = Math.floor(fRef / (fs/N)) - 2;
      const endBin = startBin + 5;
      for (let i = startBin; i <= endBin; i++) {
        if (magnitude[i] > maxVal) { maxVal = magnitude[i]; maxIdx = i; }
      }
      expect(Math.abs(freqHz[maxIdx] - fRef)).toBeLessThan(50); 
    });
  });

  describe('Advanced Statistics', () => {
    it('distanceCorrelation identifies non-linear dependencies', () => {
       const x = [-2, -1, 0, 1, 2];
       const y = [4, 1, 0, 1, 4];
       const dCor = M.distanceCorrelation(x, y);
       expect(dCor).toBeGreaterThan(0.5);
    });
  });

  describe('Linear Systems & Filtering', () => {
    it('linsolve handles 3x3 system', () => {
      const A = [[1, 2, 3], [0, 1, 4], [5, 6, 0]];
      const b = [14, 14, 17]; // x = [1, 2, 3]
      const x = M.linsolve(A, b);
      expect(x[0]).toBeCloseTo(1, 4);
      expect(x[1]).toBeCloseTo(2, 4);
      expect(x[2]).toBeCloseTo(3, 4);
    });

    it('polyfit fits a quadratic curve', () => {
      const xs = [0, 1, 2, 3];
      const ys = [1, 2, 5, 10]; // y = x^2 + 1
      const coeffs = M.polyfit(xs, ys, 2);
      expect(coeffs[0]).toBeCloseTo(1, 1); // Constant
      expect(coeffs[2]).toBeCloseTo(1, 1); // Quadratic
    });

    it('kalmanSmoothVector removes noise while preserving trend', () => {
      const samples = Array.from({ length: 50 }, (_, i) => i + (Math.random() - 0.5) * 5);
      const smoothed = M.kalmanSmoothVector(samples, 0.1, 1.0);
      expect(smoothed.length).toBe(samples.length);
      expect(smoothed[49]).toBeGreaterThan(smoothed[0]);
    });
  });

  describe('Auralization Models', () => {
    it('equalLoudnessSpl follows expected curve', () => {
      const low = M.equalLoudnessSpl(60, 60);
      const mid = M.equalLoudnessSpl(1000, 60);
      expect(low).toBeGreaterThan(mid); 
    });

    it('maskingThreshold accounts for spreading', () => {
      const freqs = [100, 1000, 5000];
      const levels = [20, 80, 20];
      const thresholds = M.maskingThreshold(freqs, levels);
      expect(thresholds[1]).toBeCloseTo(80, 1);
      expect(thresholds[2]).toBeGreaterThan(-20); 
    });
  });

  describe('FFT Roundtrip (Property-Based)', () => {
    it('satisfies ifft(fft(x)) ≈ x', () => {
      const N = 64;
      const re = new Float64Array(N);
      const im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = Math.random();

      const reOrig = new Float64Array(re);
      
      M.fftInPlace(re, im);
      M.ifftInPlace(re, im);

      for (let i = 0; i < N; i++) {
        expect(re[i]).toBeCloseTo(reOrig[i], 10);
        expect(im[i]).toBeCloseTo(0, 10);
      }
    });
  });

  describe('Spectral Metrics', () => {
    it('computes spectral flatness correctly', () => {
      const pureTone = new Array(128).fill(1e-10);
      pureTone[10] = 1.0;
      expect(M.spectralFlatness(pureTone)).toBeLessThan(0.1);

      const noise = new Array(128).fill(1.0);
      expect(M.spectralFlatness(noise)).toBeCloseTo(1.0, 5);
    });

    it('spectralEntropyPerBand returns normalized entropy', () => {
      const magSize = 4096; // Larger size ensures multiple bins per band
      const mag = new Float32Array(magSize).fill(1.0);
      const result = M.spectralEntropyPerBand(mag, 44100, 5);
      expect(result.length).toBe(5);
      result.forEach(h => {
        expect(h).toBeGreaterThan(0.9); // Should be high for flat spectrum
        expect(h).toBeLessThanOrEqual(1.0 + 1e-12);
      });
    });
  });

  describe('Inference Stability', () => {
    it('itakuraSaitoDivergence is zero for identical spectra', () => {
      const a = [0, -3, -6, -10];
      const b = [0, -3, -6, -10];
      expect(M.itakuraSaitoDivergence(a, b)).toBeCloseTo(0, 5);
    });

    it('kendallTauB correctly measures rank correlation', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [1, 2, 3, 4, 5];
      expect(M.kendallTauB(x, y)).toBeCloseTo(1, 5);
      
      const yr = [5, 4, 3, 2, 1];
      expect(M.kendallTauB(x, yr)).toBeCloseTo(-1, 5);
    });
  });

  describe('Q Factor Optimization', () => {
    it('entropyAwareQVector blends base Q with entropy signal', () => {
      const entropy = [0, 1, 0.5]; // low entropy -> high Q (sharp), high entropy -> low Q (wide)
      const baseQ = [1, 1, 1];
      const result = M.entropyAwareQVector(entropy, baseQ, { minQ: 0.5, maxQ: 5.0, blendWeight: 0.5 });
      
      expect(result[0]).toBeLessThan(1.0); // 0 entropy -> minQ (0.5), blend with 1.0 -> 0.75
      expect(result[1]).toBeGreaterThan(1.0); // 1 entropy -> maxQ (5.0), blend with 1.0 -> 3.0
    });
  });

});
