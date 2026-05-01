/**
 * Dynamic EQ Processor
 * Handles sample-accurate envelope following and dynamic gain adjustment per band.
 */

class DynamicEQProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const params = [];
    for (let i = 0; i < 10; i++) {
      params.push({ name: `gain${i}`, defaultValue: 0 });
      params.push({ name: `threshold${i}`, defaultValue: -24 });
      params.push({ name: `ratio${i}`, defaultValue: 2 });
      params.push({ name: `attack${i}`, defaultValue: 10 });
      params.push({ name: `release${i}`, defaultValue: 100 });
      params.push({ name: `range${i}`, defaultValue: 6 });
      params.push({ name: `enabled${i}`, defaultValue: 0 }); // 0 or 1
    }
    return params;
  }

  constructor() {
    super();
    this.numBands = 10;
    // Envelope followers (one per band)
    this.envelopes = new Float32Array(this.numBands).fill(0);
    // Biquad states (one per band, per channel)
    // We assume 2 channels
    this.x1 = [new Float32Array(this.numBands), new Float32Array(this.numBands)];
    this.x2 = [new Float32Array(this.numBands), new Float32Array(this.numBands)];
    this.y1 = [new Float32Array(this.numBands), new Float32Array(this.numBands)];
    this.y2 = [new Float32Array(this.numBands), new Float32Array(this.numBands)];
    
    // Band configurations (freq, q, type) - these come from messages usually as they are semi-static
    this.freqs = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    this.qs = [0.7, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 0.7];
    this.types = ['lowshelf', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'highshelf'];

    this.port.onmessage = (e) => {
      if (e.data.type === 'updateBands') {
        e.data.bands.forEach((b, i) => {
          this.freqs[i] = b.frequency;
          this.qs[i] = b.q;
          this.types[i] = b.type;
        });
      }
    };
  }

  // Fast precalculated biquad coefficients
  getCoeffsFast(type, dbGain, cos, alpha) {
    // Math.pow(10, x) is Math.exp(x * Math.LN10). dbGain / 40 * LN10 = dbGain * 0.05756462732485115
    const A = Math.exp(dbGain * 0.05756462732485115);
    let b0, b1, b2, a0, a1, a2;

    switch (type) {
      case 'peaking':
        b0 = 1 + alpha * A;
        b1 = -2 * cos;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cos;
        a2 = 1 - alpha / A;
        break;
      case 'lowshelf':
        const sqrtA2 = 2 * Math.sqrt(A) * alpha; // simplified
        b0 = A * ((A + 1) - (A - 1) * cos + sqrtA2);
        b1 = 2 * A * ((A - 1) - (A + 1) * cos);
        b2 = A * ((A + 1) - (A - 1) * cos - sqrtA2);
        a0 = (A + 1) + (A - 1) * cos + sqrtA2;
        a1 = -2 * ((A - 1) + (A + 1) * cos);
        a2 = (A + 1) + (A - 1) * cos - sqrtA2;
        break;
      case 'highshelf':
        const sqrtA2h = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cos + sqrtA2h);
        b1 = -2 * A * ((A - 1) + (A + 1) * cos);
        b2 = A * ((A + 1) + (A - 1) * cos - sqrtA2h);
        a0 = (A + 1) - (A - 1) * cos + sqrtA2h;
        a1 = 2 * ((A - 1) - (A + 1) * cos);
        a2 = (A + 1) - (A - 1) * cos - sqrtA2h;
        break;
      default:
        b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
    }

    const invA0 = 1.0 / a0;
    return [b0 * invA0, b1 * invA0, b2 * invA0, a1 * invA0, a2 * invA0];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const sampleCount = input[0].length;
    const channelCount = Math.min(input.length, output.length);

    // Initialize output with input
    for (let s = 0; s < sampleCount; s++) {
      output[0][s] = input[0][s];
      if (channelCount > 1) output[1][s] = input[1][s];
    }

    for (let b = 0; b < this.numBands; b++) {
      const baseGain = parameters[`gain${b}`][0];
      const enabled = parameters[`enabled${b}`][0] > 0.5;
      
      // If not dynamic and gain is 0, skip for performance
      if (!enabled && Math.abs(baseGain) < 0.01) continue;

      const threshold = parameters[`threshold${b}`][0];
      const ratio = parameters[`ratio${b}`][0];
      const attack = parameters[`attack${b}`][0];
      const release = parameters[`release${b}`][0];
      const range = parameters[`range${b}`][0];

      const attackAlpha = Math.exp(-1.0 / (sampleRate * (attack / 1000)));
      const releaseAlpha = Math.exp(-1.0 / (sampleRate * (release / 1000)));

      // Precalculate static coefficients
      // Note: we calculate alpha and cos outside the loop since f0 and Q don't change inside this block
      const omega = 2 * Math.PI * this.freqs[b] / sampleRate;
      const cos = Math.cos(omega);
      const alpha = Math.sin(omega) / (2 * this.qs[b]);

      let staticCoeffs = null;
      if (!enabled) {
        staticCoeffs = this.getCoeffsFast(this.types[b], baseGain, cos, alpha);
      }

      for (let s = 0; s < sampleCount; s++) {
        let sL = output[0][s];
        let sR = channelCount > 1 ? output[1][s] : sL;

        let b0, b1, b2, a1, a2;

        if (enabled) {
          // 1. Update Envelope
          const rectL = sL < 0 ? -sL : sL;
          const rectR = sR < 0 ? -sR : sR;
          const rect = rectL > rectR ? rectL : rectR;
          const aE = rect > this.envelopes[b] ? attackAlpha : releaseAlpha;
          this.envelopes[b] = aE * this.envelopes[b] + (1 - aE) * rect;

          // 2. Calculate Gain Adjustment
          // Instead of Math.log10(max) inside the loop, use Math.log(max) * Math.LOG10E
          const e = this.envelopes[b];
          const envDb = 20 * Math.log(e > 1e-6 ? e : 1e-6) * Math.LOG10E;
          let dynGain = 0;
          if (envDb > threshold) {
            dynGain = (envDb - threshold) * (1 / ratio - 1);
            if (dynGain < -range) dynGain = -range;
          }

          const totalGain = baseGain + dynGain;
          [b0, b1, b2, a1, a2] = this.getCoeffsFast(this.types[b], totalGain, cos, alpha);
        } else {
          [b0, b1, b2, a1, a2] = staticCoeffs;
        }
        
        // 3. Apply Filter
        const yL = b0 * sL + b1 * this.x1[0][b] + b2 * this.x2[0][b] - a1 * this.y1[0][b] - a2 * this.y2[0][b];
        this.x2[0][b] = this.x1[0][b]; this.x1[0][b] = sL;
        this.y2[0][b] = this.y1[0][b]; this.y1[0][b] = yL;
        output[0][s] = isFinite(yL) ? yL : sL;

        if (channelCount > 1) {
          const yR = b0 * sR + b1 * this.x1[1][b] + b2 * this.x2[1][b] - a1 * this.y1[1][b] - a2 * this.y2[1][b];
          this.x2[1][b] = this.x1[1][b]; this.x1[1][b] = sR;
          this.y2[1][b] = this.y1[1][b]; this.y1[1][b] = yR;
          output[1][s] = isFinite(yR) ? yR : sR;
        }
      }
    }

    return true;
  }
}

registerProcessor('dynamic-eq-processor', DynamicEQProcessor);
