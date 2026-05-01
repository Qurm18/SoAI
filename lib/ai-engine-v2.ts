/**
 * SONIC AI — Phase 2.1: Contextual Bayesian Preference Learning
 *
 * Learns personalized EQ per music context (genre, tempo, complexity)
 * Uses hierarchical Bayesian model for multi-modal preference discovery
 *
 * Effort: 5–6 hours | Impact: ⭐⭐⭐⭐ (major UX improvement)
 */

import { normalisedMutualInformation, distanceCorrelation } from './math';

// ─── Type Definitions ────────────────────────────────────────────────────

export type MusicGenre =
  | 'classical' | 'jazz' | 'folk' | 'acoustic'
  | 'pop' | 'rock' | 'indie' | 'alternative'
  | 'hip-hop' | 'rap' | 'r&b' | 'soul'
  | 'edm' | 'house' | 'techno' | 'trance'
  | 'metal' | 'punk' | 'country' | 'latin'
  | 'ambient' | 'experimental' | 'unknown';

export type TempoCategory = 'slow' | 'moderate' | 'fast' | 'veryFast';
export type MixComplexity = 'sparse' | 'dense' | 'orchestral';
export type VocalPresence = 'none' | 'soft' | 'prominent' | 'lead';

export interface MusicContext {
  genre: MusicGenre;
  tempoCategory: TempoCategory;
  complexity: MixComplexity;
  vocalPresence: VocalPresence;
  // Computed features
  bpm?: number;
  spectralCentroid?: number;
  dynamicRange?: number;
  harmonicContent?: number;
}

export interface ContextualPreferenceState {
  /** Global baseline (no context) */
  globalGains: number[];
  globalUncertainty: number[];
  
  /** Context-specific adjustments */
  contexts: Map<string, {
    contextKey: string;
    gains: number[];
    mean: number[];
    variance: number[];
    confidence: number;      // Posterior credibility [0..1]
    sampleSize: number;
    lastUpdated: number;
    /** Posterior α, β for Beta distribution per band */
    alphas: number[];
    betas: number[];
  }>;

  /** Global statistics */
  totalInteractions: number;
  learningRate: number;      // Adaptive learning: α ∈ [0.001, 0.1]
  memoryDecay: number;       // τ ∈ [0.9, 0.99]: older preferences fade
  explorationBonus: number;  // ε ∈ [0, 0.3]: encourage testing new contexts
}

// ─── Context Key Builder ──────────────────────────────────────────────────

export function contextKey(ctx: MusicContext): string {
  return `${ctx.genre}|${ctx.tempoCategory}|${ctx.complexity}|${ctx.vocalPresence}`;
}

export function contextSimilarity(ctx1: MusicContext, ctx2: MusicContext): number {
  // Hamming distance on categorical features
  let matches = 0;
  if (ctx1.genre === ctx2.genre) matches++;
  if (ctx1.tempoCategory === ctx2.tempoCategory) matches++;
  if (ctx1.complexity === ctx2.complexity) matches++;
  if (ctx1.vocalPresence === ctx2.vocalPresence) matches++;
  return matches / 4; // 0–1, higher = more similar
}

// ─── Prior Definition (Regularization) ────────────────────────────────────

const GENRE_PRIORS: Record<MusicGenre, number[]> = {
  // [32Hz, 64Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz]
  classical:       [ 0,     0,    1,     0.5,   0,    -0.5,  0,    -0.5,  -1,  -0.5 ],
  jazz:            [ 0,    0.5,   1.5,   1,     0,     0,   -0.5,  -0.5,   0,   -1   ],
  folk:            [-0.5,   0,     1,    0.5,   0.5,   0,    -0.5,  -1,    -1.5, -1.5 ],
  acoustic:        [ 0,     0,    0.5,   1,     0.5,   0,     0,    -0.5,  -1,  -0.5 ],
  pop:             [ 0,     0,    -0.5,  0,     0,     0.5,   1,     0.5,   -0.5, 0   ],
  rock:            [-0.5,   0,    -1,   -0.5,  0,     0.5,   0,     1,      0.5,  0   ],
  indie:           [-0.25,  0,     0,    0.5,   0,     0.25,  0.5,   0.25,   0,   -0.5 ],
  alternative:     [-0.5,   0,    -0.5,  0,     0,     0.25,  0.5,   0.5,    0,    0   ],
  'hip-hop':       [ 2,     1.5,   0.5,  0,     0,     0,     0,     0,      0,    -1   ],
  rap:             [ 1.5,   1,     0,   -0.5,  0,     0,     0,     0,      0,    -1   ],
  'r&b':           [ 0.5,   0.5,   1,    1,     0,     0,    -0.5,  -0.5,   -1,   -1   ],
  soul:            [ 0,     0.5,   1.5,   1,     0.5,   0,    -0.5,  -1,    -1.5,  -1.5 ],
  edm:             [ 1.5,   2,     0,    -0.5,  0,     0,     0,     0.5,   0.5,  0    ],
  house:           [ 1,     1.5,   0,    -0.5,  0,     0,     0,     0.5,   0,    0    ],
  techno:          [ 0.5,   1,     0,    -0.5,  0,     0,     0,     0,     0,    0    ],
  trance:          [ 0,     0.5,   0,    -0.5,  0,    -0.5,   0.5,   0.5,   1,    1    ],
  metal:           [-1,    -0.5,   0,     0,     0.5,   1,     2,     1,     0.5,  0    ],
  punk:            [-0.5,   0,    -0.5, -0.5,  0,     0.5,   1.5,   1,      0.5,  0    ],
  country:         [ 0,     0,     1,    1,     0,     0,    -0.5,  -0.5,   -1,  -1.5  ],
  latin:           [ 0.5,   1,     0.5,  0,     0.5,   0.5,   0,     0,     -0.5, -0.5 ],
  ambient:         [-0.5,  -0.5,   0,    0.5,   0,     0,    -0.5,  -1,    -1.5, -1    ],
  experimental:    [ 0,     0,     0,    0,     0,     0,     0,     0,      0,    0    ],
  unknown:         [ 0,     0,     0,    0,     0,     0,     0,     0,      0,    0    ],
};

const TEMPO_EFFECTS: Record<TempoCategory, number[]> = {
  // Slow (60–100 BPM): reduce mud, add presence
  slow:             [ -0.5,  -0.5,  -1,   -0.5,  0,     0.5,   1,     0.5,   0,    0   ],
  // Moderate (100–130 BPM): neutral baseline
  moderate:         [ 0,     0,      0,    0,     0,     0,     0,     0,     0,    0   ],
  // Fast (130–180 BPM): boost sub, reduce harshness
  fast:             [ 0.5,   0.5,    0,   -0.5,  0,    -0.25,  -0.5,  0,     0,   -0.5 ],
  // Very Fast (180+ BPM): more aggressive sub
  veryFast:         [ 1,     0.5,    0,   -0.5,  0,    -0.5,   -1,    0,     0,   -1   ],
};

const COMPLEXITY_EFFECTS: Record<MixComplexity, number[]> = {
  // Sparse: gentle, room-like
  sparse:           [ 0,     0,      0.5,  0.5,   0,     0,     -0.5,  -1,    -1,  -0.5 ],
  // Dense: forward, aggressive
  dense:            [ 0,     0,     -0.5, -0.5,  0,     0.5,   1,     1,     0.5,  0   ],
  // Orchestral: warm mids, controlled highs
  orchestral:       [ 0.5,   0.5,    1,    0.5,   0,    -0.5,  -0.5,  -1,    -0.5, -1  ],
};

const VOCAL_EFFECTS: Record<VocalPresence, number[]> = {
  none:             [ 0,     0,      0,    0,     0,     0,     0,     0,     0,    0   ],
  soft:             [ 0,     0,      0,    0,     0,     0.5,   0.5,   0,    -0.5,  0   ],
  prominent:        [ 0,     0,     -0.5,  0,    -0.5,   1,     1.5,   0.5,  -0.5,  0   ],
  lead:             [ 0,     0,      0,   -0.5,  -1,     1.5,   2,     0.5,  -0.5,  0   ],
};

// ─── Bayesian Learner ────────────────────────────────────────────────────

export class ContextualBayesianLearner {
  private state: ContextualPreferenceState;
  private readonly NUM_BANDS = 10;

  constructor(initialState?: ContextualPreferenceState) {
    if (initialState) {
      // Map requires reconstruct from plain JSON
      initialState.contexts = new Map(initialState.contexts instanceof Map ? initialState.contexts : Object.entries(initialState.contexts));
      this.state = initialState;
    } else {
      this.state = {
        globalGains: new Array(10).fill(0),
        globalUncertainty: new Array(10).fill(1.0),
        contexts: new Map(),
        totalInteractions: 0,
        learningRate: 0.05,
        memoryDecay: 0.95,
        explorationBonus: 0.1,
      };
    }
  }

  /**
   * Update preference given a user choice (A vs B) in a context
   */
  updatePreference(
    context: MusicContext,
    choiceA: number[],
    choiceB: number[],
    userChoice: 'A' | 'B' | 'DISLIKE_BOTH' | 'NO_PREFERENCE',
    metadata?: {
      listenTime?: number;
      confidence?: number; // 0–1
    }
  ): void {
    const key = contextKey(context);
    const metalearningRate = this.computeAdaptiveAlpha(metadata?.confidence ?? 0.5);

    // Initialize or retrieve context state
    let ctxState = this.state.contexts.get(key);
    if (!ctxState) {
      const prior = this.computePriorMean(context);
      ctxState = {
        contextKey: key,
        gains: prior.slice(),
        mean: prior.slice(),
        variance: new Array(this.NUM_BANDS).fill(0.5),
        confidence: 0.3,
        sampleSize: 0,
        lastUpdated: Date.now(),
        alphas: new Array(this.NUM_BANDS).fill(1),
        betas: new Array(this.NUM_BANDS).fill(1),
      };
      this.state.contexts.set(key, ctxState);
    }

    // Determine which choice was preferred
    const preferredGains = userChoice === 'A' ? choiceA : userChoice === 'B' ? choiceB : null;
    if (!preferredGains && userChoice !== 'DISLIKE_BOTH') return;

    // Update Beta priors per band
    for (let i = 0; i < this.NUM_BANDS; i++) {
      // Convert gain to [0, 1] preference signal
      let signal: number;
      if (userChoice === 'DISLIKE_BOTH') {
        // Neither good: move toward neither (regression to 0)
        signal = 0.5;
      } else {
        // Preferred gains are "wins"
        const normalizedGain = (preferredGains![i] + 12) / 24; // Assume ±12 dB range → [0, 1]
        signal = Math.max(0, Math.min(1, normalizedGain));
      }

      // Beta conjugate update: α += wins, β += losses
      ctxState.alphas[i] += signal * metalearningRate * 10;
      ctxState.betas[i] += (1 - signal) * metalearningRate * 10;

      // Mean of Beta(α, β) is α/(α+β)
      const newMean = ctxState.alphas[i] / (ctxState.alphas[i] + ctxState.betas[i]);
      // Convert back to dB
      ctxState.mean[i] = (newMean * 24) - 12;

      // Variance of Beta: α*β / ((α+β)² * (α+β+1))
      const n = ctxState.alphas[i] + ctxState.betas[i];
      ctxState.variance[i] = (ctxState.alphas[i] * ctxState.betas[i]) / (n * n * (n + 1));
    }

    // Update confidence and sample size
    ctxState.sampleSize++;
    ctxState.confidence = Math.min(1, ctxState.sampleSize / 10); // Saturates at 10 samples
    ctxState.lastUpdated = Date.now();

    // Update global state with memory decay
    this.updateGlobalGains(ctxState.mean);

    this.state.totalInteractions++;
  }

  /**
   * Suggest EQ for a given context, with exploration bonus
   */
  suggestGainsForContext(
    context: MusicContext,
    explorationMode = false
  ): {
    gains: number[];
    uncertainty: number[];
    confidence: number;
    contexts: string[];
  } {
    const key = contextKey(context);

    // Exact match
    const exactMatch = this.state.contexts.get(key);
    if (exactMatch && exactMatch.confidence > 0.5) {
      return {
        gains: exactMatch.mean.slice(),
        uncertainty: exactMatch.variance.map((v) => Math.sqrt(v)),
        confidence: exactMatch.confidence,
        contexts: [key],
      };
    }

    // Fallback: find similar contexts and blend
    const candidates = Array.from(this.state.contexts.values())
      .map((ctx) => {
        const ctxObj = this.parseContextKey(ctx.contextKey);
        return {
          ctx,
          similarity: contextSimilarity(context, ctxObj),
        };
      })
      .filter((x) => x.similarity > 0.5)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    if (candidates.length === 0) {
      // Use global + genre prior
      const genrePrior = GENRE_PRIORS[context.genre] ?? new Array(10).fill(0);
      return {
        gains: this.blendGains([this.state.globalGains, genrePrior], [0.7, 0.3]),
        uncertainty: this.state.globalUncertainty.slice(),
        confidence: 0.2,
        contexts: [],
      };
    }

    // Weighted blend
    const weights = candidates.map((x) => x.similarity);
    const normWeights = weights.map((w) => w / weights.reduce((a, b) => a + b, 0));
    const candidateGains = candidates.map((x) => x.ctx.mean);
    const blended = this.blendGains(candidateGains, normWeights);

    // Exploration bonus: if mode enabled, add randomness to encourage discovery
    const explored = explorationMode
      ? blended.map((g, i) => g + (Math.random() - 0.5) * this.state.explorationBonus)
      : blended;

    return {
      gains: explored,
      uncertainty: candidates[0].ctx.variance.map((v) => Math.sqrt(v)),
      confidence: candidates[0].similarity,
      contexts: candidates.map((x) => x.ctx.contextKey),
    };
  }

  /**
   * Compute prior mean for a context (genre + tempo + complexity + vocal)
   */
  private computePriorMean(context: MusicContext): number[] {
    const components = [
      GENRE_PRIORS[context.genre] ?? new Array(10).fill(0),
      TEMPO_EFFECTS[context.tempoCategory] ?? new Array(10).fill(0),
      COMPLEXITY_EFFECTS[context.complexity] ?? new Array(10).fill(0),
      VOCAL_EFFECTS[context.vocalPresence] ?? new Array(10).fill(0),
    ];

    const weights = [0.5, 0.2, 0.15, 0.15]; // Genre dominates
    return this.blendGains(components, weights);
  }

  private blendGains(gainsArray: number[][], weights: number[]): number[] {
    const result = new Array(this.NUM_BANDS).fill(0);
    for (let i = 0; i < gainsArray.length; i++) {
      for (let j = 0; j < this.NUM_BANDS; j++) {
        result[j] += gainsArray[i][j] * weights[i];
      }
    }
    return result;
  }

  private updateGlobalGains(newContextMean: number[]): void {
    // EMA update with memory decay
    for (let i = 0; i < this.NUM_BANDS; i++) {
      this.state.globalGains[i] = this.state.memoryDecay * this.state.globalGains[i] 
        + (1 - this.state.memoryDecay) * newContextMean[i];
    }
  }

  private computeAdaptiveAlpha(confidence: number): number {
    // Higher confidence → faster learning
    return 0.001 + confidence * 0.099; // [0.001, 0.1]
  }

  private parseContextKey(key: string): MusicContext {
    const [genre, tempo, complexity, vocal] = key.split('|');
    return {
      genre: (genre as MusicGenre) ?? 'unknown',
      tempoCategory: (tempo as TempoCategory) ?? 'moderate',
      complexity: (complexity as MixComplexity) ?? 'dense',
      vocalPresence: (vocal as VocalPresence) ?? 'none',
    };
  }

  getState(): ContextualPreferenceState {
    return this.state;
  }

  setState(newState: ContextualPreferenceState): void {
    this.state = newState;
  }
}

// ─── Export for persistence ────────────────────────────────────────────────

export function serializeContextualState(state: ContextualPreferenceState): string {
  const contextsArray = Array.from(state.contexts.values());
  return JSON.stringify({
    globalGains: Array.from(state.globalGains),
    globalUncertainty: Array.from(state.globalUncertainty),
    contexts: contextsArray,
    totalInteractions: state.totalInteractions,
    learningRate: state.learningRate,
    memoryDecay: state.memoryDecay,
    explorationBonus: state.explorationBonus,
  });
}

export function deserializeContextualState(json: string): ContextualPreferenceState {
  const data = JSON.parse(json);
  const contextsMap = new Map<string, any>(
    (data.contexts || []).map((ctx: any) => [
      ctx.contextKey,
      {
        ...ctx,
        alphas: ctx.alphas || new Array(10).fill(1),
        betas: ctx.betas || new Array(10).fill(1),
      },
    ])
  );

  return {
    globalGains: data.globalGains,
    globalUncertainty: data.globalUncertainty,
    contexts: contextsMap,
    totalInteractions: data.totalInteractions,
    learningRate: data.learningRate,
    memoryDecay: data.memoryDecay,
    explorationBonus: data.explorationBonus,
  };
}

// ─── Thompson Sampling for Scenario Selection ──────────────────────────────

export interface TuningPreference {
  choice: 'A' | 'B' | 'NOT_SURE' | 'DISLIKE_BOTH';
  scenario: string;
  context?: MusicContext;
}

export function thompsonSampleNextScenario(
  learnerState: ContextualPreferenceState,
  history: TuningPreference[],
  availableScenarios: Record<string, { A: number[]; B: number[] }>,
  options: {
    exploration: number; // 0–1, favor rare scenarios
    significance: number; // 0.95: statistical threshold
  }
): {
  scenario: string;
  rationale: string;
  expectedGain: number;
} {
  const scenarios = Object.keys(availableScenarios);
  
  // Exclude fully explored scenarios if needed, but here we can just pick the best
  const historyCounts = new Map<string, number>();
  history.forEach(h => historyCounts.set(h.scenario, (historyCounts.get(h.scenario) || 0) + 1));

  let bestScenario = scenarios[0];
  let maxExpectedGain = -Infinity;
  let bestRationale = 'Khởi tạo ngẫu nhiên';

  // For each scenario, estimate expected information gain (KL divergence approx)
  for (const scenario of scenarios) {
    const ab = availableScenarios[scenario];
    const diff = ab.A.map((val, i) => Math.abs(val - ab.B[i]));
    
    // We sample from the posterior variance (uncertainty) per band.
    // Highly uncertain bands will yield higher sampled variance.
    let sampledUncertainty = 0;
    
    for (let i = 0; i < 10; i++) {
      // Gamma sample or just scale variance by random factor for Thompson sampling
      const u = learnerState.globalUncertainty[i] || 1.0;
      // Thompson sample: sample from normal with var = u
      const r1 = Math.random();
      const r2 = Math.random();
      const z = Math.sqrt(-2.0 * Math.log(Math.max(1e-10, r1))) * Math.cos(2.0 * Math.PI * r2);
      const sampledVar = u * Math.abs(z); 
      
      // Expected gain is proportional to how much A and B differ in highly uncertain bands
      sampledUncertainty += sampledVar * diff[i];
    }
    
    // Exploration penalty: if we already tested this scenario, reduce gain
    const timesTested = historyCounts.get(scenario) || 0;
    const explorationPenalty = Math.pow(0.5, timesTested) * (options.exploration * 10);
    
    const expectedGain = sampledUncertainty + explorationPenalty;
    
    if (expectedGain > maxExpectedGain) {
      maxExpectedGain = expectedGain;
      bestScenario = scenario;
      
      if (timesTested === 0) {
        bestRationale = `Scenario chưa được test: Khám phá dải tần thay đổi trong ${scenario}`;
      } else {
        const topBandIdx = diff.indexOf(Math.max(...diff));
        bestRationale = `Độ phân giải chưa chắc chắn tại băng tần ${topBandIdx} cần làm rõ`;
      }
    }
  }

  return {
    scenario: bestScenario,
    rationale: bestRationale,
    expectedGain: maxExpectedGain,
  };
}

// ─── Usage Example ────────────────────────────────────────────────────────

export function exampleContextualLearning() {
  const learner = new ContextualBayesianLearner();

  // User A/B test in classical context
  const classicalContext: MusicContext = {
    genre: 'classical',
    tempoCategory: 'slow',
    complexity: 'orchestral',
    vocalPresence: 'none',
  };

  const gainA = [-1, -1, 2, 1, 0.5, -0.5, -1, -1, -1.5, -0.5];
  const gainB = [0.5, 0.5, 0, -0.5, 0, 0, 0, 0, 0, 0];

  learner.updatePreference(classicalContext, gainA, gainB, 'A', {
    listenTime: 45,
    confidence: 0.8,
  });

  // Later: test in pop context
  const popContext: MusicContext = {
    genre: 'pop',
    tempoCategory: 'moderate',
    complexity: 'dense',
    vocalPresence: 'prominent',
  };

  const popA = [0, 0, -0.5, 0, 0, 0.5, 1, 0.5, -0.5, 0];
  const popB = [1.5, 1.5, 0, 0, 0, 0, 0, 0.5, 0, 0];

  learner.updatePreference(popContext, popA, popB, 'B', {
    listenTime: 30,
    confidence: 0.6,
  });

  // Suggest for new context (similar to classical)
  const newContext: MusicContext = {
    genre: 'classical',
    tempoCategory: 'slow',
    complexity: 'sparse',  // Different complexity
    vocalPresence: 'none',
  };

  const suggestion = learner.suggestGainsForContext(newContext);
  console.log('Suggested EQ:', suggestion.gains);
  console.log('Confidence:', suggestion.confidence);
  console.log('Similar contexts:', suggestion.contexts);
}
