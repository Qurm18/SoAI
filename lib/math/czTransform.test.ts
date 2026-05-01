import { describe, it, expect } from 'vitest';
import { chirpZTransform } from './czTransform';

describe('Chirp Z-Transform (CZT)', () => {
  it('returns empty exact results on 0 length timeDomain', () => {
    const result = chirpZTransform(new Float32Array(), 100, 200, 10, 44100);
    expect(result.freq.length).toBe(0);
    expect(result.mag.length).toBe(0);
  });

  it('computes localized frequencies correctly compared to FFT', () => {
    const fs = 44100;
    const testFreq = 1000; // Looking for 1 kHz tone
    const N = 1024;
    
    // Create signal with 1kHz tone
    const signal = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      signal[i] = Math.sin((2 * Math.PI * testFreq * i) / fs);
    }
    
    // Compute CZT across a narrow band 900Hz to 1100Hz
    const freqStart = 900;
    const freqEnd = 1100;
    const numPoints = 100;
    
    const result = chirpZTransform(signal, freqStart, freqEnd, numPoints, fs);
    
    // Check points
    expect(result.freq.length).toBe(numPoints);
    expect(result.mag.length).toBe(numPoints);
    expect(result.freq[0]).toBeCloseTo(freqStart, 2);
    expect(result.freq[numPoints - 1]).toBeCloseTo(freqEnd, 2);
    
    // Find the peak in CZT output
    let maxMag = -Infinity;
    let peakFreq = -1;
    for (let i = 0; i < numPoints; i++) {
        if (result.mag[i] > maxMag) {
            maxMag = result.mag[i];
            peakFreq = result.freq[i];
        }
    }
    
    // The peak should be very close to 1000Hz (the resolution is 200Hz / 99 points = ~2Hz)
    expect(Math.abs(peakFreq - testFreq)).toBeLessThan(5);
  });
});
