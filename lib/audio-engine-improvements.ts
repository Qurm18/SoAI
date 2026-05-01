/**
 * Advanced audio processing improvements
 */

export function computeSpectralGainCorrection(specA: number[], specB: number[]): number[] {
  const correction = new Array(specA.length).fill(0);
  for (let i = 0; i < specA.length; i++) {
    // Difference between profiles, scaling down the correction
    correction[i] = (specB[i] - specA[i]) * 0.5;
  }
  return correction;
}

export class AdaptiveMultiBandLimiter {
  private ceiling: number = 0;

  constructor(private sampleRate: number) {}

  updateCeiling(ceilingDb: number) {
    this.ceiling = Math.pow(10, ceilingDb / 20);
  }

  process(sample: number): number {
    const abs = Math.abs(sample);
    if (abs <= this.ceiling || this.ceiling <= 0) {
      return sample;
    }
    
    // Tanh-based soft clipping for musical saturation above threshold
    // Maps [ceiling, 1] to [ceiling, 1] gracefully
    const diff = abs - this.ceiling;
    const knee = 1 - this.ceiling;
    const gain = this.ceiling + knee * Math.tanh(diff / knee);
    return Math.sign(sample) * Math.min(1, gain);
  }
}

export class LookaheadBuffer {
  private buffer: Float32Array;
  private writePos: number = 0;
  private windowSize: number;

  constructor(sampleRate: number, windowMs: number = 5) {
    this.windowSize = Math.max(1, Math.floor(sampleRate * (windowMs / 1000)));
    this.buffer = new Float32Array(this.windowSize);
  }

  addSample(sample: number) {
    this.buffer[this.writePos] = Math.abs(sample);
    this.writePos = (this.writePos + 1) % this.windowSize;
  }

  getPeak(): number {
    let peak = 0;
    for (let i = 0; i < this.windowSize; i++) {
      if (this.buffer[i] > peak) {
        peak = this.buffer[i];
      }
    }
    return peak;
  }

  getMean(): number {
    let sum = 0;
    for (let i = 0; i < this.windowSize; i++) {
      sum += this.buffer[i];
    }
    return sum / this.windowSize;
  }
}

export class PolyphaseFilter {
  constructor(public freq: number, public type: 'highpass'|'lowpass', public sampleRate: number) {}
  
  processLeft(sample: number): number { return sample; }
  processRight(sample: number): number { return sample; }
}

export class TemporalDynamicsModel {
  private loudnessBuffer: number[] = [];

  updateLoudness(momentaryDb: number) {
    this.loudnessBuffer.push(momentaryDb);
    if (this.loudnessBuffer.length > 50) this.loudnessBuffer.shift();
  }

  getAdaptiveEQCorrection(bandCenters: number[]): number[] {
    const avg = this.loudnessBuffer.reduce((a, b) => a + b, 0) / (this.loudnessBuffer.length || 1);
    const correction = new Array(bandCenters.length).fill(0);
    if (avg < -30) {
      correction[0] = 0.5;
      correction[1] = 0.3;
    }
    return correction;
  }
}

export class LinearPhaseEQ {
  processDoubleFiltered(samples: Float32Array, filterFunc: (x: number) => number): Float32Array {
    const forward = samples.map(filterFunc);
    const reversed = new Float32Array(forward.length);
    for (let i = 0; i < forward.length; i++) {
      reversed[i] = forward[forward.length - 1 - i];
    }
    const doubleFiltered = reversed.map(filterFunc);
    const output = new Float32Array(doubleFiltered.length);
    for (let i = 0; i < doubleFiltered.length; i++) {
      output[i] = doubleFiltered[doubleFiltered.length - 1 - i];
    }
    return output;
  }
}

export class EQProfileMorphing {
  private morphing = false;
  private morphProgress = 0;
  private morphDuration = 500;

  startMorph(duration: number = 500): void {
    this.morphing = true;
    this.morphProgress = 0;
    this.morphDuration = duration;
  }

  processMorph(deltaTime: number, current: any[]): any[] {
    if (!this.morphing) return current;

    this.morphProgress += deltaTime;
    const alpha = Math.min(1, this.morphProgress / this.morphDuration);

    const morphed = current.map(band => ({
      ...band,
      gain: band.gain * (1 - alpha) + (band.gain * 1.2) * alpha,
      q: band.q * (1 - alpha) + (band.q * 0.9) * alpha
    }));

    if (alpha >= 1) this.morphing = false;
    return morphed;
  }
}
