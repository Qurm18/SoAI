
import { EQBand } from './audio-engine';

function normalisedMutualInformation(X: string[], Y: string[]): number {
  if (X.length === 0 || Y.length === 0 || X.length !== Y.length) return 0;
  const n = X.length;
  const mapX = new Map<string, number>();
  const mapY = new Map<string, number>();
  const mapXY = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const x = X[i], y = Y[i], xy = x + '|' + y;
    mapX.set(x, (mapX.get(x) || 0) + 1);
    mapY.set(y, (mapY.get(y) || 0) + 1);
    mapXY.set(xy, (mapXY.get(xy) || 0) + 1);
  }
  let hX = 0, hY = 0, hXY = 0;
  for (const count of mapX.values()) { const p = count / n; hX -= p * Math.log2(p); }
  for (const count of mapY.values()) { const p = count / n; hY -= p * Math.log2(p); }
  for (const count of mapXY.values()) { const p = count / n; hXY -= p * Math.log2(p); }
  const mi = hX + hY - hXY;
  if (hX === 0 && hY === 0) return 0;
  return 2 * mi / (hX + hY);
}

export interface LearnerAudioContext {
  sectionType: 'intro' | 'verse' | 'chorus' | 'drop' | 'outro';
  bassEnergy: number; // 0..1
  loudness: number;   // LUFS
  fingerprint?: number[]; // [sub, bass, low-mid, mids, highs, centroid, flatness, crest]
}

export interface AudioFeatures {
  lowEnergy: number;
  midEnergy: number;
  highEnergy: number;
  spectralCentroid: number;
  dynamicRange: number;
  isMuddy: boolean;
  isHarsh: boolean;
  isThin: boolean;
}

export interface Interaction {
  eqA: number[];
  eqB: number[];
  choice: 'A' | 'B' | 'DISLIKE_BOTH' | 'NOT_SURE';
  listenTime?: number; // seconds
  confidence?: number; // Tầng 2 implicit signal [0..1.5+]
}

export interface LearnerState {
  globalPreference: number[];  // -1..1 per band
  globalVelocity?: number[];    // For Polyak momentum
  contextPreferences: Record<string, number[]>; // key: sectionType
  contextVelocities?: Record<string, number[]>;
  W?: number[][];               // [10 bands][8 dimensions] ma trận hồi quy
  b?: number[];                 // [10 bands] bias vector
  uncertainty?: number[];       // [10 bands] độ bất định (variance)
  stability: number;           // 0..1
  convergence?: number;         // NEW: Chỉ số hội tụ (0..1)
  interactionCount: number;
}

export class AdaptiveEQLearner {
  private state: LearnerState;
  private readonly LEARNING_RATE_BASE = 0.2;
  private readonly NUM_BANDS = 10;
  private readonly MOMENTUM = 0.8;
  private readonly NUM_FINGERPRINT_DIMS = 8;
  private readonly REG_LAMBDA = 0.01; // Regularization for ridge regression
  private readonly CONVERGENCE_ALPHA = 0.8;
  private readonly CONVERGENCE_THRESHOLD = 0.1;

  private _interactionHistory: Array<{ eqA: number[]; eqB: number[]; choice: string }> = [];

  constructor(initialState?: any) {
    if (initialState) {
      this.state = initialState;
    } else {
      this.state = {
        globalPreference: new Array(this.NUM_BANDS).fill(0),
        contextPreferences: {},
        W: Array.from({ length: this.NUM_BANDS }, () => new Array(this.NUM_FINGERPRINT_DIMS).fill(0)),
        b: new Array(this.NUM_BANDS).fill(0),
        uncertainty: new Array(this.NUM_BANDS).fill(1.0),
        stability: 0.5,
        convergence: 0,
        interactionCount: 0,
      };
    }

    // Ensure metadata exists for older profiles
    if (!this.state.W) {
      this.state.W = Array.from({ length: this.NUM_BANDS }, () => new Array(this.NUM_FINGERPRINT_DIMS).fill(0));
    }
    if (!this.state.b) {
      this.state.b = new Array(this.NUM_BANDS).fill(0);
    }
    if (!this.state.uncertainty) {
      this.state.uncertainty = new Array(this.NUM_BANDS).fill(1.0);
    }
    if (this.state.convergence === undefined) {
      this.state.convergence = 0;
    }
  }

  public getState() {
    return { ...this.state };
  }

  // Implementation of the requested idea
  private computeRealNMI(
    interactionHistory: Array<{ eqA: number[]; eqB: number[]; choice: string }>
  ): number {
    if (interactionHistory.length < 4) return 0.5; // chưa đủ data

    // Discretize preference signal: preference direction per band (cut/neutral/boost)
    const choiceSignals = interactionHistory.map(h => {
      if (h.choice === 'NOT_SURE' || h.choice === 'DISLIKE_BOTH') return 'N';
      return h.choice; // 'A' | 'B'
    });

    // Audio feature signal: which band was most differentiated
    const dominantBands = interactionHistory.map(h => {
      const delta = h.eqA.map((a, i) => Math.abs(a - h.eqB[i]));
      return String(delta.indexOf(Math.max(...delta)));
    });

    return normalisedMutualInformation(choiceSignals, dominantBands);
  }

  private _applyNegativeFeedback(
    interaction: Interaction,
    context: LearnerAudioContext,
    features: AudioFeatures
  ): LearnerState {
    // Cả hai đều bị reject → push preference về phía trung tính (0)
    // Thay vì cập nhật direction, ta giảm magnitude của preference hiện tại
    const SHRINK = 0.85; // co 15% về 0
    const newGlobal = this.state.globalPreference.map(v => v * SHRINK);
    
    // Tăng uncertainty vì user không hài lòng với không gian tìm kiếm hiện tại
    const newUncertainty = this.state.uncertainty!.map(u =>
      Math.min(1.0, u * 1.1)
    );

    // Cập nhật velocity về 0 (dừng momentum)
    const newVelocity = new Array(this.NUM_BANDS).fill(0);

    return {
      ...this.state,
      globalPreference: newGlobal,
      globalVelocity: newVelocity,
      uncertainty: newUncertainty,
      stability: Math.max(0, this.state.stability - 0.04),
      interactionCount: this.state.interactionCount + 1,
    };
  }

  public update(
    context: LearnerAudioContext,
    features: AudioFeatures,
    interaction: Interaction
  ): LearnerState {
    this._interactionHistory.push({ eqA: interaction.eqA, eqB: interaction.eqB, choice: interaction.choice });

    // Early exit + negative learning cho DISLIKE_BOTH
    if (interaction.choice === 'DISLIKE_BOTH') {
      this.state = this._applyNegativeFeedback(interaction, context, features);
      return this.state;
    }

    let chosen = [...(interaction.choice === 'A' ? interaction.eqA : interaction.eqB)];
    let rejected = [...(interaction.choice === 'A' ? interaction.eqB : interaction.eqA)];

    // 7. Loudness normalization (Zero-mean normalization for spectral balance comparison)
    const chosenMean = chosen.reduce((a, b) => a + b, 0) / chosen.length;
    const rejectedMean = rejected.reduce((a, b) => a + b, 0) / rejected.length;
    rejected = rejected.map(v => v + (chosenMean - rejectedMean));

    // 12. Confidence weighting
    const listenTime = interaction.listenTime || 0;
    const baseConfidence = Math.max(0.3, Math.min(1.0, listenTime / 20));
    const confidence = interaction.confidence ?? baseConfidence;

    // 8. Compute delta = chosen - rejected, normalize to [-1, 1]
    const delta = chosen.map((val, i) => {
      const diff = val - rejected[i];
      // 9. Perceptual scaling: bass > mid > treble sensitivity
      let sensitivity = 1.0;
      if (i < 3) sensitivity = 1.5; // High sensitivity to bass preference
      else if (i < 7) sensitivity = 1.0; // Mid
      else sensitivity = 0.7; // Treble

      return Math.max(-1, Math.min(1, (diff / 5) * sensitivity));
    });

    const contextWeight = this.computeContextWeight(context);
    
    // 13. Early-stage control: reduce lr during first few interactions
    const stageMultiplier = this.state.interactionCount < 5 ? 0.5 : 1.0;
    const lr = this.LEARNING_RATE_BASE * confidence * (1 - this.state.stability) * stageMultiplier;
    
    // Tầng 1: Online Ridge Regression for Spectral-Conditioned EQ
    const fingerprint = context.fingerprint || new Array(this.NUM_FINGERPRINT_DIMS).fill(0.5);
    const nextW = this.state.W!.map(row => [...row]);
    const nextB = [...this.state.b!];

    for (let i = 0; i < this.NUM_BANDS; i++) {
      for (let d = 0; d < this.NUM_FINGERPRINT_DIMS; d++) {
        // ΔW = lr * (delta ⊗ fingerprint) - λ * W
        const gradW = delta[i] * fingerprint[d];
        nextW[i][d] = nextW[i][d] * (1 - this.REG_LAMBDA) + lr * gradW;
      }
      nextB[i] = nextB[i] * (1 - this.REG_LAMBDA) + lr * delta[i];
    }

    // Tầng 4: Uncertainty update
    const nextUncertainty = this.state.uncertainty!.map((u, i) => {
      // Coherence (using globalPref as a proxy for consistent direction)
      const alignment = delta[i] * this.state.globalPreference[i];
      const factor = alignment > 0 ? 0.95 : 1.05; // Decrease uncertainty if aligned
      return Math.max(0.1, Math.min(1.0, u * factor));
    });

    // Update both global and specific context vectors
    const updateVector = (pref: number[], velocity?: number[]) => {
      const v = velocity || new Array(this.NUM_BANDS).fill(0);
      const nextPref = new Array(this.NUM_BANDS);
      const nextVel = new Array(this.NUM_BANDS);

      for (let i = 0; i < this.NUM_BANDS; i++) {
        let grad = lr * delta[i] * contextWeight[i];

        // 15. Anti-contradiction: if conflicting with current pref, reduce impact
        if (grad * pref[i] < 0) {
          grad *= 0.5;
        }

        // 11. Audio constraints
        if (i < 3) { // Bass
          if (features.isMuddy) grad *= 0.2;
          if (features.isThin) grad *= 1.5;
        }
        if (i > 7 && features.isHarsh) grad *= 0.2;

        // 14. Polyak Momentum (Heavy Ball)
        // v_t = momentum * v_{t-1} + update
        // p_t = p_{t-1} + v_t
        nextVel[i] = this.MOMENTUM * v[i] + grad;
        nextPref[i] = Math.max(-1, Math.min(1, pref[i] + nextVel[i]));
      }
      return { pref: nextPref, vel: nextVel };
    };

    const { pref: newGlobal, vel: newGlobalVel } = updateVector(
      this.state.globalPreference, 
      this.state.globalVelocity
    );

    const gainsDelta = newGlobal.reduce((acc, v, i) => acc + Math.abs(v - this.state.globalPreference[i]), 0) / this.NUM_BANDS;
    const currentConvergence = this.state.convergence || 0;
    const newConvergence = this.CONVERGENCE_ALPHA * currentConvergence + 
                           (1 - this.CONVERGENCE_ALPHA) * (1 - Math.min(1, gainsDelta / this.CONVERGENCE_THRESHOLD));
    
    const contextType = context.sectionType;
    const currentContextPref = this.state.contextPreferences[contextType] || new Array(this.NUM_BANDS).fill(0);
    const currentContextVel = (this.state.contextVelocities || {})[contextType] || new Array(this.NUM_BANDS).fill(0);
    
    const { pref: newContextPref, vel: newContextVel } = updateVector(currentContextPref, currentContextVel);

    // Symmetric Stability Update
    const manualMag = Math.sqrt(delta.reduce((a, v) => a + v * v, 0));
    const globalMag = Math.sqrt(this.state.globalPreference.reduce((a, v) => a + v * v, 0));
    const dot = delta.reduce((a, v, i) => a + v * this.state.globalPreference[i], 0);
    const alignment = (manualMag > 1e-4 && globalMag > 1e-4) ? dot / (manualMag * globalMag) : 0;

    // Stability Asymmetry: Reduced punishment for "human noise" (wrong), 
    // higher reward for consistency (right).
    const stabilityDelta = (alignment > 0 ? 0.06 : -0.03);
    const newStability = Math.max(0, Math.min(0.95, (this.state.stability || 0.5) + stabilityDelta));

    this.state = {
      globalPreference: newGlobal,
      globalVelocity: newGlobalVel,
      contextPreferences: {
        ...this.state.contextPreferences,
        [contextType]: newContextPref
      },
      contextVelocities: {
        ...(this.state.contextVelocities || {}),
        [contextType]: newContextVel
      },
      W: nextW,
      b: nextB,
      uncertainty: nextUncertainty,
      stability: newStability,
      convergence: newConvergence,
      interactionCount: this.state.interactionCount + 1,
    };

    return this.state;
  }

  public predict(context: LearnerAudioContext, features: AudioFeatures): number[] {
    const contextWeight = this.computeContextWeight(context);
    const contextPref = this.state.contextPreferences[context.sectionType] || new Array(this.NUM_BANDS).fill(0);
    
    // Base preference blending
    const basePref = this.state.globalPreference.map((g, i) => {
      return 0.7 * g + 0.3 * contextPref[i];
    });

    // Tầng 1: Spectral-Conditioned Prediction
    const fingerprint = context.fingerprint || new Array(this.NUM_FINGERPRINT_DIMS).fill(0.5);
    const predictedGains = new Array(this.NUM_BANDS).fill(0);
    
    if (this.state.W && this.state.b) {
      for (let i = 0; i < this.NUM_BANDS; i++) {
        let regressionSum = this.state.b[i];
        for (let d = 0; d < this.NUM_FINGERPRINT_DIMS; d++) {
          regressionSum += this.state.W[i][d] * fingerprint[d];
        }
        // Combined global + conditioned signal
        predictedGains[i] = 0.5 * basePref[i] + 0.5 * regressionSum;
      }
    } else {
      predictedGains.push(...basePref);
    }

    let eqAdjustment = predictedGains.map((pref, i) => {
      let adj = pref * contextWeight[i];

      // Khi stability cao (người dùng nhất quán), hệ thống sẽ gợi ý các bước cực nhỏ để tinh chỉnh
      // Thay vì dừng lại, ta "mài sắc" (refine) kết quả.
      const uncertainty = this.state.uncertainty ? this.state.uncertainty[i] : 1.0;
      
      // Precision Refinement: Giảm biên độ thay đổi khi đã hội tụ (stability > 0.8)
      // Điều này giúp gợi ý các EQ "tốt nhất" một cách tinh tế.
      const precisionFactor = this.state.stability > 0.8 ? 0.4 : 1.0;
      adj *= (1 - uncertainty * 0.4) * precisionFactor; 

      // Small-step constraint (giữ cho âm thanh tự nhiên)
      adj = Math.max(-2.5, Math.min(2.5, adj));

      // Audio safety (chống hú/rè ở các tần số cực cao/thấp)
      if (i > 7 && features.spectralCentroid > 8000) adj = Math.min(0, adj);
      if (i < 2 && features.spectralCentroid < 200) adj = Math.min(0, adj);

      return adj;
    });

    // EQ budget constraint: Giới hạn tổng năng lượng biến đổi để tránh méo tiếng
    const totalAbsGain = eqAdjustment.reduce((acc, val) => acc + Math.abs(val), 0);
    const budget = this.state.stability > 0.8 ? 2.5 : 5.0; 
    if (totalAbsGain > budget) {
      const scale = budget / totalAbsGain;
      eqAdjustment = eqAdjustment.map(v => v * scale);
    }

    return eqAdjustment;
  }

  public checkEarlyStopping(): { stop: boolean; reason?: string } {
    // Thuật toán không bao giờ tự dừng theo yêu cầu của người dùng.
    return { stop: false };
  }

  private computeContextWeight(context: LearnerAudioContext): number[] {
    const weights = new Array(this.NUM_BANDS).fill(1.0);
    
    // Section based adjustments
    let globalMod = 0;
    if (context.sectionType === 'drop') globalMod = 0.3;
    if (context.sectionType === 'verse') globalMod = -0.2;

    // Apply global and bass-specific context
    return weights.map((w, i) => {
      let finalW = w + globalMod;
      if (i < 3) { // Bass bands
        if (context.bassEnergy < 0.3) finalW *= 0.8; // Reduce if low energy
        if (context.bassEnergy > 0.7) finalW *= 1.2; // Increase if heavy
      }
      return finalW;
    });
  }

  private computeAudioConstraints(features: AudioFeatures): number[] {
    // Simple band constraints 1.0 = neutral
    return new Array(this.NUM_BANDS).fill(1.0);
  }
}
