/**
 * Sonic AI - High-Performance Audio Processing Core
 * Optimized for 32-bit Float Processing & Near-Zero Latency
 */

class SonicProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bassEnhance', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'ceiling', defaultValue: -0.3, minValue: -12, maxValue: 0 },
      { name: 'dither', defaultValue: 1.0, minValue: 0, maxValue: 1 },
      { name: 'width', defaultValue: 1.0, minValue: 0, maxValue: 2 },
      { name: 'crossFeed', defaultValue: 0, minValue: 0, maxValue: 1 }
    ];
  }

  constructor() {
    super();
    // Use 64-bit Float for internal states to ensure "audiophile" precision
    this._ditherState = 0;
    this._ditherErrorL = 0;
    this._ditherErrorR = 0;

    this._prevX = new Float64Array(2).fill(0);
    this._prevY = new Float64Array(2).fill(0);
    
    // Crossfeed buffers (slight delay + 2nd order LPF)
    this._cfL = new Float64Array(128).fill(0);
    this._cfR = new Float64Array(128).fill(0);
    this._cfIdx = 0;
    this._cfLpf1L = 0; this._cfLpf2L = 0;
    this._cfLpf1R = 0; this._cfLpf2R = 0;

    // Harmonic HPF states
    this._hL_prevInput = 0;
    this._hR_prevInput = 0;
    this._hL_prevOutput = 0;
    this._hR_prevOutput = 0;

    // Metering
    this._lastMeterUpdate = 0;
    this._shortTermWindow = new Float32Array(30).fill(0);
    this._stIdx = 0;
    
    // Transients
    this._transientEnvL = 0;
    this._transientEnvR = 0;
  }

  // High-Quality TPDF Dithering with 1st-order noise shaping
  _ditherShape(sample, isRight) {
    const r1 = Math.random() * 2 - 1;
    const r2 = Math.random() * 2 - 1;
    const noise = (r1 + r2) * (1 / 65536);
    
    const err = isRight ? this._ditherErrorR : this._ditherErrorL;
    const shaped = sample + noise - err * 0.5; // 1st order noise shaping
    const quantized = Math.round(shaped * 32768) / 32768;
    const newErr = quantized - shaped;
    
    if (isRight) this._ditherErrorR = newErr;
    else this._ditherErrorL = newErr;
    
    return quantized; 
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0] || input[0].length === 0) return true;

    const channelCount = input.length;
    const sampleCount = input[0].length;
    
    const bass = parameters.bassEnhance;
    const ceil = parameters.ceiling;
    const dither = parameters.dither;
    const width = parameters.width;
    const crossFeed = parameters.crossFeed;

    let localPeak = 0;
    
    const delaySamples = Math.max(1, Math.round(sampleRate * 0.0004));
    const bufSize = Math.max(128, delaySamples * 2);
    // 2nd order LPF coeffs 
    const lpfCoeff = Math.exp(-2 * Math.PI * 700 / sampleRate);
    const hpCoeff = Math.exp(-2 * Math.PI * 10 / sampleRate);

    for (let i = 0; i < sampleCount; i++) {
      const b = bass.length > 1 ? bass[i] : bass[0];
      const c = ceil.length > 1 ? ceil[i] : ceil[0];
      const d = dither.length > 1 ? dither[i] : dither[0];
      const w = width.length > 1 ? width[i] : width[0];
      const cf = crossFeed.length > 1 ? crossFeed[i] : crossFeed[0];

      const linCeil = Math.exp(c * 0.11512925464970228);

      let L = input[0][i];
      let R = channelCount > 1 ? input[1][i] : L;

      // Transient detection
      const absLFast = Math.abs(L);
      const absRFast = Math.abs(R);
      this._transientEnvL = 0.9 * this._transientEnvL + 0.1 * absLFast;
      this._transientEnvR = 0.9 * this._transientEnvR + 0.1 * absRFast;
      const isTransientL = absLFast > this._transientEnvL * 2.5 + 0.01;
      const isTransientR = absRFast > this._transientEnvR * 2.5 + 0.01;

      // 1. Stereo Width (M/S processing)
      if (w !== 1.0) {
        const M = (L + R) * 0.5;
        const S = (L - R) * 0.5 * w;
        L = M + S;
        R = M - S;
      }

      // 2. Headphone Cross-feed (Neutron style with 2nd order LPF)
      if (cf > 0) {
        const idxSubDelay = this._cfIdx - delaySamples;
        const safeIdx = (idxSubDelay + bufSize) % bufSize;
        const lOld = this._cfL[safeIdx];
        const rOld = this._cfR[safeIdx];
        
        const curIdx = this._cfIdx % bufSize;
        this._cfL[curIdx] = L;
        this._cfR[curIdx] = R;
        this._cfIdx = (this._cfIdx + 1) % bufSize;
        
        // Two-pole LPF
        this._cfLpf1L = lpfCoeff * this._cfLpf1L + (1 - lpfCoeff) * rOld;
        this._cfLpf2L = lpfCoeff * this._cfLpf2L + (1 - lpfCoeff) * this._cfLpf1L;
        
        this._cfLpf1R = lpfCoeff * this._cfLpf1R + (1 - lpfCoeff) * lOld;
        this._cfLpf2R = lpfCoeff * this._cfLpf2R + (1 - lpfCoeff) * this._cfLpf1R;
        
        L += this._cfLpf2L * cf * 0.2;
        R += this._cfLpf2R * cf * 0.2;
      }

      // 3. Psychoacoustic Enhancements
      if (b > 0) {
        const threshold = 0.25;
        const saturate = (x, isTrans) => {
          const absx = Math.abs(x);
          if (absx < threshold || isTrans) return x; // preserve transients
          const t = Math.min(1.0, (absx - threshold) / threshold);
          const sat = Math.sign(x) * (threshold + threshold * Math.tanh(t));
          return x * (1 - b * 0.3) + sat * b * 0.3;
        };
        
        L = saturate(L, isTransientL);
        R = saturate(R, isTransientR);
        
        // Remove DC drift
        this._hL_prevOutput = hpCoeff * this._hL_prevOutput + (1 - hpCoeff) * (L - this._hL_prevInput);
        this._hR_prevOutput = hpCoeff * this._hR_prevOutput + (1 - hpCoeff) * (R - this._hR_prevInput);
        this._hL_prevInput = L;
        this._hR_prevInput = R;
        L = L + this._hL_prevOutput * b * 0.15;
        R = R + this._hR_prevOutput * b * 0.15;
      }

      // 4. Butterworth soft-knee clipper
      const knee = 0.85;
      const processSide = (x) => {
        const absX = Math.abs(x);
        const limLine = linCeil * knee;
        if (absX < limLine) return x;
        const sign = Math.sign(x);
        
        if (absX < linCeil) {
          const t = (absX - limLine) / (linCeil * (1 - knee));
          // quadratic curve for smoother knee
          return sign * (limLine + (linCeil - limLine) * (t - t * t * 0.5));
        }
        return sign * linCeil * (1.0 + 0.05 * Math.tanh((absX - linCeil) / (linCeil * 0.5)));
      };

      L = processSide(L);
      R = processSide(R);

      const mLR = Math.max(Math.abs(L), Math.abs(R));
      localPeak = mLR > localPeak ? mLR : localPeak;

      // 5. TPDF + Noise Shaping Dither
      if (d > 0) {
        L = this._ditherShape(L, false) * d + L * (1 - d);
        R = this._ditherShape(R, true) * d + R * (1 - d);
      }

      output[0][i] = L;
      if (channelCount > 1) output[1][i] = R;
    }

    if (currentTime - this._lastMeterUpdate > 0.1) {
      let energy = 0;
      for (let i = 0; i < sampleCount; i++) {
        energy += output[0][i] * output[0][i];
        if (channelCount > 1) energy += output[1][i] * output[1][i];
      }
      const mom = 10 * Math.log10(Math.max(1e-9, energy / sampleCount));
      this._shortTermWindow[this._stIdx] = mom;
      this._stIdx = (this._stIdx + 1) % 30;
      
      const st = this._shortTermWindow.reduce((a, b) => a + b) / 30;
      const peakDb = 20 * Math.log10(Math.max(1e-6, localPeak));
      
      this.port.postMessage({
        type: 'metering',
        momentary: mom,
        shortTerm: st,
        peak: peakDb,
        psr: peakDb - st
      });
      this._lastMeterUpdate = currentTime;
    }

    return true;
  }
}

registerProcessor('sonic-processor', SonicProcessor);
