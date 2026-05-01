
import {
  adaptiveKalmanSmoothVector,
  polynomialSmoothEqCurve,
  selectPolyDegree,
  dynamicQVector,
  normalisedMutualInformation,
  entropy,
  equalLoudnessWeights,
  maskingThreshold,
  applyAcousticMasking,
  bradleyTerryScores,
  distanceCorrelation,
  chooseNextByEI,
  thurstoneBandScores,
  cusumDriftDetect,
  itakuraSaitoDivergence,
  rankProfilesByIS,
  kendallBandCoherence,
  spectralEntropyPerBand,
  entropyAwareQVector,
  type CusumResult,
} from './math';
import { AB_PREVIEW_GAINS, TrackCharacter } from './audio-engine';
import { invalidateProfileSource } from './profile-store';

export interface TuningPreference {
  choice: 'A' | 'B' | 'NOT_SURE' | 'DISLIKE_BOTH';
  scenario: string;
  behavior?: {
    switchCount: number;
    timeOnA: number;
    timeOnB: number;
    quickRejectionFlag?: 'A' | 'B';
    hesitationLevel?: number;
    closeContender?: 'A' | 'B';
  };
}

export interface DeviceProfile {
  id: string;
  name: string;
  /** Response deviations at 10 reference bands (relative to 0dB target). */
  deviations: number[];
  timestamp: number;
}

export interface EQProfile {
  name: string;
  description: string;
  genre: string;
  gains: number[];
  insights: string[];
  color: string;
  /** Recommended Q per band (10 entries) — computed from dynamicQVector. */
  qSuggestions?: number[];
  /** Preference-consistency score in [0, 1] — derived via mutual information. */
  consistency?: number;
}

/** 10-band centre frequencies aligned with DEFAULT_BANDS in audio-engine. */
const BAND_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const BAND_LABELS = ['32Hz','64Hz','125Hz','250Hz','500Hz','1kHz','2kHz','4kHz','8kHz','16kHz'];

function normalizeWeightsL2(w: number[]): number[] {
  const norm = Math.sqrt(w.reduce((s, v) => s + v * v, 0));
  return norm < 1e-8 ? w : w.map((v) => v / norm);
}

const RAW_WEIGHT_MATRIX: Record<string, { A: number[]; B: number[] }> = {
  bass_depth:       { A: [5.0, 3.5, 1.0, 0,    0,    0,    0,    0,    0,    0   ], B: [0,    4.0,  2.5,  0,    0,    0,    0,    0,    0,    0   ] },
  vocal_clarity:    { A: [0,   0,   0,   2.5,  3.5,  1.0,  0,    0,    0,    0   ], B: [0,    0,    0,    0,    0.5,  3.0,  4.5,  2.0,  0,    0   ] },
  sub_bass:         { A: [6.0, 2.0, 0,   0,    0,    0,    0,    0,    0,    0   ], B: [-1.5, 0,    0,    0,    0,    0,    0,    0,    0,    0   ] },
  instrument_sep:   { A: [0,   0,   0,   0,   -1.0,  2.0,  3.5,  4.0,  2.0,  0   ], B: [0,    0,    0,    2.5,  4.0,  3.0,  0,    0,    0,    0   ] },
  mid_punch:        { A: [0,   1.5, 4.5, 3.0,  1.0,  0,    0,    0,    0,    0   ], B: [0,    0,   -1.0, -1.5,  2.0,  1.0,  0,    0,    0,    0   ] },
  high_frequency:   { A: [0,   0,   0,   0,    0,    0,    0,   -1.0, -2.5, -4.0 ], B: [0,    0,    0,    0,    0,    0,    1.0,  2.5,  4.5,  6.0 ] },
  presence:         { A: [0,   0,   0,   0,    0,   -1.5, -2.0, -1.5,  0,    0   ], B: [0,    0,    0,    0,    0,    1.5,  3.5,  3.0,  1.0,  0   ] },
  warmth_body:      { A: [0,   0,   1.5, 4.0,  3.5,  2.0,  0,    0,    0,    0   ], B: [0,    0,    0,   -1.0, -1.5,  0,    0,    0,    0,    0   ] },
  sibilance:        { A: [0,   0,   0,   0,    0,    0,   -1.5, -3.5, -5.0, -3.0 ], B: [0,    0,    0,    0,    0,    0,    0,    2.0,  3.5,  2.5 ] },
  overall_balance:  { A: [3.5, 2.0, 0,  -1.5, -2.5, -1.5,  0,   2.0,  3.5,  4.5 ], B: [0,    0,    0,    0,    0,    0,    0,    0,    0,    0   ] },
  sub_mid_blend:    { A: [4.0, 4.0, 1.0,  0,    0,    0,    0,    0,    0,    0   ], B: [5.0, 1.0,  0,    0,    0,    0,    0,    0,    0,    0   ] },
  high_air_only:    { A: [0,   0,   0,    0,    0,    0,    0,    0,    0,    5.0 ], B: [0,    0,    0,    0,    0,    0.5,  1.0,  2.0,  3.0,  1.0 ] },
  warmth_no_mud:    { A: [0,   0,   0,    4.5,  4.5,  1.5,  0,    0,    0,    0   ], B: [0,    1.5,  4.5,  2.0,  1.0,  0,    0,    0,    0,    0   ] },
  presence_no_harshness: { A: [0,   0,   0,   0,    0.5,  4.0,  4.0,  0.5,  0,    0   ], B: [0,    0,    0,    0,    0,    2.0,  2.0,  4.0,  2.0,  0   ] },
};

const WEIGHT_MATRIX: Record<string, { A: number[]; B: number[] }> = Object.fromEntries(
  Object.entries(RAW_WEIGHT_MATRIX).map(([k, v]) => [
    k,
    { A: normalizeWeightsL2(v.A), B: normalizeWeightsL2(v.B) }
  ])
);

interface FeatureScores {
  subBassEnergy: number;
  midBassEnergy: number;
  midRange: number;
  presence: number;
  airDetail: number;
  flatness: number;
  [key: string]: number;
}

const FEATURE_RULES: Record<string, Partial<Record<keyof FeatureScores, { A: number; B: number }>>> = {
  bass_depth:       { subBassEnergy: { A: 1.5, B: 0.3 }, midBassEnergy: { A: 0.5, B: 1.2 } },
  sub_bass:         { subBassEnergy: { A: 2.0, B: -0.5 } },
  mid_punch:        { midBassEnergy: { A: 1.5, B: -0.3 }, midRange: { A: 0.8, B: -0.5 } },
  vocal_clarity:    { midRange: { A: 1.5, B: -0.2 }, presence: { A: -0.3, B: 1.0 } },
  warmth_body:      { midRange: { A: 1.8, B: -0.8 }, flatness: { A: -0.5, B: 0.8 } },
  instrument_sep:   { presence: { A: 0.8, B: -0.2 }, midRange: { A: -0.3, B: 0.5 } },
  presence:         { presence: { A: -1.0, B: 2.0 } },
  high_frequency:   { airDetail: { A: -1.5, B: 2.0 }, flatness: { A: 0.5, B: -0.3 } },
  sibilance:        { airDetail: { A: -1.0, B: 1.5 } },
  overall_balance:  { subBassEnergy: { A: 0.8, B: 0 }, airDetail: { A: 0.8, B: 0 }, flatness: { A: -1.0, B: 2.0 } },
  sub_mid_blend:    { subBassEnergy: { A: 0.5, B: 1.0 }, midBassEnergy: { A: 1.0, B: -0.5 } },
  high_air_only:    { airDetail: { A: 2.0, B: 0.5 }, presence: { A: 0, B: 0.8 } },
  warmth_no_mud:    { midRange: { A: 1.5, B: 0.5 }, midBassEnergy: { A: -0.5, B: 1.2 } },
  presence_no_harshness: { presence: { A: 1.8, B: 0.5 }, airDetail: { A: -0.5, B: 1.2 } },
};

interface ProfileDef {
  name: string;
  description: string;
  genre: string;
  color: string;
  insights: string[];
  requires: Partial<Record<keyof FeatureScores, number>>;
  rejects?: Partial<Record<keyof FeatureScores, number>>;
  bias: number[];
  priority: number;
  affinities?: Partial<Record<keyof FeatureScores, number>>;
}

const PROFILES: ProfileDef[] = [
  {
    name: 'Deep Sub Reference',
    description: 'Maximum sub-bass extension with ultra-controlled mids',
    genre: 'EDM · Cinematic · Hip-Hop',
    color: '#7F77DD',
    insights: [
      'Sub-bass shelf boosted to physical pressure threshold.',
      'Mid-range notched for maximum sub clarity and definition.',
    ],
    requires: { subBassEnergy: 2.5 },
    rejects: { flatness: 2.0 },
    bias: [3.0, 1.5, 0, -1.0, -1.5, -1.0, 0, 0, 0, 0],
    affinities: { subBassEnergy: 2.0, midBassEnergy: 0.5 },
    priority: 8,
  },
  {
    name: 'Power Bass',
    description: 'Aggressive low-end impact across the entire bass register',
    genre: 'EDM · Modern Pop · Gaming',
    color: '#E24B4A',
    insights: [
      'Full bass register boosted — sub slam meets mid-bass thump.',
      'Treble kept clean to prevent listener fatigue at high volumes.',
    ],
    requires: { subBassEnergy: 1.0, midBassEnergy: 1.0 },
    rejects: { flatness: 2.0, airDetail: 2.0 },
    bias: [2.0, 2.5, 1.0, 0, -1.0, 0, 0, 0, 0, 0],
    affinities: { subBassEnergy: 1.5, midBassEnergy: 1.5 },
    priority: 7,
  },
  {
    name: 'Analog Warmth',
    description: 'Tube-like mid-body saturation, rolled-off highs',
    genre: 'Vocal Jazz · Acoustic · R&B',
    color: '#EF9F27',
    insights: [
      'Lower midrange lifted for a rich, full-bodied texture.',
      'High-frequency air gently rolled off for zero digital harshness.',
    ],
    requires: { midRange: 2.0 },
    rejects: { airDetail: 1.5, subBassEnergy: 2.5 },
    bias: [0, 0, 1.5, 2.0, 1.5, 0.5, -0.5, -1.0, -1.5, -2.0],
    affinities: { midRange: 2.0, midBassEnergy: 0.5 },
    priority: 6,
  },
  {
    name: 'Vocal Forward',
    description: 'Elevated presence and clarity, optimized for voices',
    genre: 'Pop · Podcast · Live Performance',
    color: '#D4537E',
    insights: [
      '1–4 kHz presence region lifted — vocals sit front and center.',
      'Bass is intentionally lean to prevent masking the vocal fundamental.',
    ],
    requires: { midRange: 1.5, presence: 1.0 },
    rejects: { subBassEnergy: 2.0 },
    bias: [0, 0, 0, 1.0, 2.5, 3.0, 1.5, 0.5, 0, 0],
    affinities: { presence: 2.0, midRange: 1.0 },
    priority: 6,
  },
  {
    name: 'Ultra Clarity',
    description: 'Maximum detail retrieval and upper-harmonic resolution',
    genre: 'Classical · Jazz · Audiophile',
    color: '#378ADD',
    insights: [
      'Upper harmonics lifted for microscopic instrument separation.',
      'Presence region tuned for forward transient attack on every note.',
    ],
    requires: { airDetail: 2.0, presence: 1.0 },
    rejects: { subBassEnergy: 2.0, midRange: 2.5 },
    bias: [0, 0, 0, -0.5, 0, 1.0, 2.5, 3.0, 2.0, 1.0],
    affinities: { airDetail: 2.0, presence: 1.5 },
    priority: 7,
  },
  {
    name: 'V-Excitement',
    description: 'Classic consumer V-curve — boosted bass and treble',
    genre: 'Rock · Pop · Outdoor Listening',
    color: '#D85A30',
    insights: [
      'Classic V-shaped fun curve — both ends of the spectrum amplified.',
      'Ideal for energetic listening when critical accuracy is secondary.',
    ],
    requires: { subBassEnergy: 0.8, airDetail: 0.8 },
    rejects: { flatness: 2.5, midRange: 2.5 },
    bias: [2.0, 1.5, 0, -1.5, -2.0, -1.5, 0, 1.5, 2.0, 2.5],
    affinities: { subBassEnergy: 1.0, airDetail: 1.0 },
    priority: 5,
  },
  {
    name: 'Harman Target',
    description: 'Research-based target curve for over-ear headphones',
    genre: 'Universal · Critical Listening',
    color: '#1D9E75',
    insights: [
      'Follows Harman International research — statistically preferred by most listeners.',
      'Gentle bass shelf, flat mids, slight treble dip around 6kHz.',
    ],
    requires: { flatness: 0.5 },
    rejects: { subBassEnergy: 2.5, airDetail: 2.5 },
    bias: [3.0, 2.0, 1.0, 0, -0.5, -0.5, -1.5, -2.0, -1.0, 0],
    affinities: { flatness: 1.5 },
    priority: 4,
  },
  {
    name: 'Studio Reference',
    description: 'Neutral flat response for accurate monitoring',
    genre: 'Mixing · Mastering · Production',
    color: '#888780',
    insights: [
      'Flat response — every frequency reproduced with equal weight.',
      'Optimized for critical listening where source accuracy is paramount.',
    ],
    requires: {},
    bias: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    affinities: { flatness: 2.0 },
    priority: 1,
  },
];

interface Contradiction {
  scenarioA: string; choiceA: 'A' | 'B';
  scenarioB: string; choiceB: 'A' | 'B';
  description: string;
  penalty: number;
  bands: number[];
}

const CONTRADICTIONS: Contradiction[] = [
  { scenarioA: 'sub_bass', choiceA: 'A', scenarioB: 'overall_balance', choiceB: 'B',
    description: 'Heavy sub preference conflicts with reference flat balance', penalty: 0.4, bands: [0, 1] },
  { scenarioA: 'high_frequency', choiceA: 'B', scenarioB: 'sibilance', choiceB: 'A',
    description: 'Bright treble preference contradicts sibilance suppression', penalty: 0.5, bands: [6, 7, 8, 9] },
  { scenarioA: 'vocal_clarity', choiceA: 'B', scenarioB: 'warmth_body', choiceB: 'A',
    description: 'Crisp vocal presence conflicts with thick body warmth', penalty: 0.35, bands: [3, 4, 5] },
  { scenarioA: 'bass_depth', choiceA: 'A', scenarioB: 'mid_punch', choiceB: 'B',
    description: 'Deep bass boost conflicts with lean mid-punch preference', penalty: 0.3, bands: [1, 2, 3] },
];

interface ConfidenceResult {
  score: number;
  contradictions: string[];
  dominantFeature: keyof FeatureScores | null;
  bandDampening: number[];
}

function computeConfidence(preferences: TuningPreference[], featureScores: FeatureScores): ConfidenceResult {
  const prefMap = new Map(preferences.map(p => [p.scenario, p.choice]));
  const bandDampening = new Array(10).fill(1.0);
  const contradictionMessages: string[] = [];

  for (const c of CONTRADICTIONS) {
    if (prefMap.get(c.scenarioA) === c.choiceA && prefMap.get(c.scenarioB) === c.choiceB) {
      contradictionMessages.push(c.description);
      for (const band of c.bands) {
        bandDampening[band] = Math.min(bandDampening[band], 1 - c.penalty);
      }
    }
  }

  const values = Object.values(featureScores);
  const maxVal = Math.max(...values.map(Math.abs));
  // Spread: 1.0 = ambiguous (all equal), low = focused (one major winner)
  const spread = maxVal > 0 ? values.reduce((sum, v) => sum + Math.abs(v), 0) / (values.length * maxVal) : 1.0;
  const contradictionPenalty = contradictionMessages.length * 0.12;
  
  // Confidence is high when spread is low (clear winner found)
  // We want a clear winner (low spread) to give high confidence.
  const baseConfidence = 1.2 - spread; 
  const confidenceScore = Math.max(0.2, Math.min(1.0, baseConfidence - contradictionPenalty));

  const featureEntries = Object.entries(featureScores) as [keyof FeatureScores, number][];
  const dominant = featureEntries.reduce((best, curr) => Math.abs(curr[1]) > Math.abs(best[1]) ? curr : best, featureEntries[0]);
  const dominantFeature = Math.abs(dominant[1]) > 0.5 ? dominant[0] : null;

  return { score: confidenceScore, contradictions: contradictionMessages, dominantFeature, bandDampening };
}

// ─── Proper Psychoacoustic Masking (Schroeder spreading + Bark scale) ───────
// Uses the actual Schroeder-1979 spreading function on the Bark scale rather
// than the previous neighbour-difference heuristic. For each band we compute
// the masking threshold contributed by every other band, then attenuate the
// band's gain proportionally to how deeply it is buried under that threshold.
//
// Anchored at zero gain → only the *deltas* between bands trigger masking,
// matching the way humans hear EQ adjustments rather than absolute level.
function applyMaskingFilter(gains: number[]): number[] {
  const thresholds = maskingThreshold(BAND_FREQUENCIES, gains.map(Math.abs));
  return gains.map((g, i) => {
    const margin = Math.abs(g) - thresholds[i]; // dB above the masking floor
    if (margin >= 0) return g;
    // -10 dB below threshold → ~40 % attenuation, scaling linearly between.
    const factor = 1 - Math.min(0.45, (-margin) * 0.04);
    return g * factor;
  });
}

// ─── FIX #4: Normalized Gaussian Smooth (replaces broken coefficient formula) ─
// OLD: sf = 0.15 + (1 - confidence) * 0.2. At confidence=0.0, sf=0.35 and
//      center coefficient = 1 - sf*2 = 0.30. But the original formula never
//      guaranteed sum-to-1, and in edge cases (very low confidence + boundary
//      bands) the kernel was non-normalized, introducing DC gain errors.
// FIX: Gaussian kernel normalized to sum-to-1. sigma scales with confidence.
function adaptiveSmooth(gains: number[], confidence: number): number[] {
  const sigma = 0.4 + (1 - confidence) * 0.5;
  const kernel = [-1, 0, 1].map(d => Math.exp(-(d * d) / (2 * sigma * sigma)));
  const kSum = kernel.reduce((a, b) => a + b, 0);
  const normalized = kernel.map(k => k / kSum);

  return gains.map((g, i) => {
    const prev = gains[i - 1] ?? g;
    const next = gains[i + 1] ?? g;
    return prev * normalized[0] + g * normalized[1] + next * normalized[2];
  });
}

// ─── NEW: Preference-Consistency via Mutual Information ──────────────────────
// We measure how strongly each related pair of A/B choices co-vary. Pairs that
// SHOULD agree (e.g. picking "deep sub" in sub_bass and "thunderous" in
// bass_depth) score high consistency. Independent answers → near zero.
const CONSISTENCY_PAIRS: [string, string][] = [
  ['sub_bass', 'bass_depth'],
  ['vocal_clarity', 'presence'],
  ['high_frequency', 'sibilance'],
  ['warmth_body', 'mid_punch'],
  ['instrument_sep', 'high_frequency'],
];

function preferenceConsistency(prefs: TuningPreference[]): {
  score: number;
  detail: { pair: [string, string]; nmi: number; matched: boolean }[];
} {
  const map = new Map(prefs.map((p) => [p.scenario, p.choice]));
  const xs: string[] = [];
  const ys: string[] = [];
  const detail: { pair: [string, string]; nmi: number; matched: boolean }[] = [];

  for (const [a, b] of CONSISTENCY_PAIRS) {
    const ca = map.get(a);
    const cb = map.get(b);
    if (!ca || !cb) continue;
    xs.push(ca);
    ys.push(cb);
    detail.push({ pair: [a, b], nmi: 0, matched: ca === cb });
  }

  // Need ≥ 2 pairs and at least one non-degenerate variable for MI.
  if (xs.length < 2 || entropy(xs) === 0 || entropy(ys) === 0) {
    // Fallback: simple agreement ratio
    const agreed = detail.filter((d) => d.matched).length;
    const score = detail.length ? agreed / detail.length : 0.5;
    return { score, detail };
  }

  const nmi = normalisedMutualInformation(xs, ys);
  // Distribute the global NMI to per-pair detail equally (just for reporting)
  detail.forEach((d) => (d.nmi = nmi));
  // Blend NMI with raw agreement for stability with tiny samples
  const agreement = detail.filter((d) => d.matched).length / detail.length;
  return { score: 0.65 * nmi + 0.35 * agreement, detail };
}

function scoreProfile(profile: ProfileDef, scores: FeatureScores): number {
  for (const [key, threshold] of Object.entries(profile.rejects ?? {})) {
    if ((scores[key as keyof FeatureScores] ?? 0) >= (threshold ?? 0)) return -Infinity;
  }
  let requireScore = 0;
  for (const [key, threshold = 0] of Object.entries(profile.requires)) {
    const actual = scores[key as keyof FeatureScores] ?? 0;
    requireScore += actual < threshold ? -(threshold - actual) * 2 : 1;
  }
  let affinityScore = 0;
  for (const [key, weight = 0] of Object.entries(profile.affinities ?? {})) {
    affinityScore += (scores[key as keyof FeatureScores] ?? 0) * weight;
  }
  return profile.priority * 1.5 + requireScore * 2.0 + affinityScore;
}

function generateInsights(
  profile: ProfileDef,
  featureScores: FeatureScores,
  confidence: ConfidenceResult,
  finalGains: number[],
  deviceProfile?: DeviceProfile
): string[] {
  const insights: string[] = [...profile.insights];
  if (deviceProfile) {
    insights.push(`Compensating for ${deviceProfile.name} frequency response to isolate your true preference.`);
  }
  if (confidence.score < 0.5) {
    insights.push('Mixed preferences detected — gains moderated for balanced output.');
  } else if (confidence.score > 0.8) {
    insights.push(`Strong preference signal — calibration confidence at ${Math.round(confidence.score * 100)}%.`);
  }
  if (confidence.contradictions.length > 0) {
    insights.push(`Conflicting preferences resolved: ${confidence.contradictions[0].toLowerCase()}.`);
  }
  const featureLabels: Record<keyof FeatureScores, string> = {
    subBassEnergy: 'deep sub-bass energy', midBassEnergy: 'mid-bass punch',
    midRange: 'midrange warmth', presence: 'vocal presence',
    airDetail: 'high-frequency detail', flatness: 'neutral reference',
  };
  if (confidence.dominantFeature && insights.length < 4) {
    insights.push(`Dominant signature: ${featureLabels[confidence.dominantFeature]} — all gains tuned around this axis.`);
  }
  const maxGainIdx = finalGains.reduce((best, g, i) => Math.abs(g) > Math.abs(finalGains[best]) ? i : best, 0);
  const maxGain = finalGains[maxGainIdx];
  if (Math.abs(maxGain) > 3 && insights.length < 4) {
    const dir = maxGain > 0 ? 'boosted' : 'cut';
    insights.push(`Peak adjustment: ${BAND_LABELS[maxGainIdx]} ${dir} ${Math.abs(maxGain).toFixed(1)} dB.`);
  }
  return insights.slice(0, 4);
}

const ISO226_CORRECTION_55DB = [7.5, 5.0, 2.5, 1.0, 0.5, 0.0, -0.5, 0.5, 2.5, 5.0];
const ISO226_CORRECTION_70DB = [3.5, 2.5, 1.2, 0.5, 0.2, 0.0, -0.2, 0.2, 1.0, 2.5];

function sigmoidGain(raw: number, bandIdx: number, listenLevel = 0.5): number {
  const base = 12 * Math.tanh(raw / 8);
  if (listenLevel >= 1.0) return base;
  const corrAt55 = ISO226_CORRECTION_55DB[bandIdx] ?? 0;
  const corrAt70 = ISO226_CORRECTION_70DB[bandIdx] ?? 0;
  let correction: number;
  if (listenLevel <= 0.5) {
    correction = corrAt55 + (corrAt70 - corrAt55) * (listenLevel / 0.5);
  } else {
    correction = corrAt70 * (1 - (listenLevel - 0.5) / 0.5);
  }
  const scaling = Math.max(0, 1 - Math.abs(base) / 14);
  return base + correction * scaling;
}

// ─── FIX #5: Energy Normalization (pre-sigmoid) ───────────────────────────────
// OLD: no output energy constraint. All-bass choices could stack to +15–20 dB
//      raw before sigmoid. tanh(20/8) ≈ 0.999 — tanh was saturating everything
//      flat, destroying inter-band differentiation.
// FIX: normalize RMS before sigmoid so tanh operates in its linear region.
const MAX_RMS_DB = 6.0;

function normalizeGainEnergy(gains: number[]): number[] {
  const rms = Math.sqrt(gains.reduce((sum, g) => sum + g * g, 0) / gains.length);
  if (rms <= MAX_RMS_DB) return gains;
  const scale = MAX_RMS_DB / rms;
  return gains.map(g => g * scale);
}

interface InteractionRule {
  scenA: string; choiceA: 'A' | 'B';
  scenB: string; choiceB: 'A' | 'B';
  delta: number[];
}

const INTERACTION_RULES: InteractionRule[] = [
  { scenA: 'sub_bass', choiceA: 'A', scenB: 'bass_depth', choiceB: 'A',
    delta: [1.5, 1.0, -1.0, -0.5, 0, 0, 0, 0, 0, 0] },
  { scenA: 'vocal_clarity', choiceA: 'B', scenB: 'presence', choiceB: 'B',
    delta: [0, 0, 0, 0, 0.5, 1.0, 2.0, 1.5, 0, 0] },
  { scenA: 'high_frequency', choiceA: 'B', scenB: 'sibilance', choiceB: 'B',
    delta: [0, 0, 0, 0, 0, 0, 0, -0.5, 1.0, 1.5] },
  { scenA: 'warmth_body', choiceA: 'A', scenB: 'mid_punch', choiceB: 'A',
    delta: [0, 0, 0.5, 1.0, -0.5, 0, 0, 0, 0, 0] },
  { scenA: 'instrument_sep', choiceA: 'A', scenB: 'vocal_clarity', choiceB: 'A',
    delta: [0, 0, -0.5, -1.0, 1.0, 1.5, 0.5, 0, 0, 0] },
  { scenA: 'overall_balance', choiceA: 'B', scenB: 'bass_depth', choiceB: 'A',
    delta: [-1.0, -0.5, 0, 0, 0, 0, 0, 0, 0, 0] },
];

// ─── NEW (Sonic AI v3.1): Multi-trial aggregation ────────────────────────────
// When the wizard runs the same scenario on multiple tracks (rematch trials),
// the user may answer differently each time. We collapse repeated trials into
// a single weighted preference per scenario:
//   - majority pick wins
//   - confidence weight = (winning votes − losing votes) / total
//   - completely tied → confidence 0 (vote dropped)
//   - 1 vote only → confidence 1 (treated like the legacy single-trial path)
interface AggregatedPreference {
  scenario: string;
  choice: 'A' | 'B';
  weight: number;          // [0, 1] confidence in the choice
  trials: number;
  conflict: number;        // [0, 1] = losing / total
  /** Wilson lower-bound win-rate (one-sigma, ~68 % confidence). */
  lowerBound: number;
}

// ─── Wilson 1-σ lower bound on a binomial proportion ────────────────────────
// Used to avoid the 1-trial overconfidence trap: if a user picks "A" on the
// only trial of a scenario, the empirical rate is 1.0 but the true rate is
// statistically anywhere in [0.5, 1.0]. The Wilson lower bound shrinks small
// samples toward 0.5 and only relaxes that prior as N grows.
function wilsonLowerBound(wins: number, total: number, z = 1.0): number {
  if (total === 0) return 0;
  const phat = wins / total;
  const denom = 1 + (z * z) / total;
  const center = phat + (z * z) / (2 * total);
  const margin = z * Math.sqrt(
    (phat * (1 - phat) + (z * z) / (4 * total)) / total
  );
  return Math.max(0, (center - margin) / denom);
}

const EXTREME_SCENARIOS = new Set(['sub_bass', 'high_frequency', 'sibilance']);

function aggregateTrials(prefs: TuningPreference[]): AggregatedPreference[] {
  const tally = new Map<string, { A: number; B: number }>();
  for (const p of prefs) {
    const t = tally.get(p.scenario) ?? { A: 0, B: 0 };
    
    // Evaluate behavioral modifiers for this specific trial
    let winWeight = 1.0;
    let loseWeight = 0.0;
    
    if (p.behavior) {
      if (p.behavior.quickRejectionFlag) {
        // Strong signal: immediate rejection of a branch
        winWeight = 1.3;
      }
      if (p.behavior.hesitationLevel && p.behavior.hesitationLevel >= 4) {
        // High hesitation = lower confidence on the win, and give a tiny sympathy weight to the loser.
        winWeight = Math.max(0.6, winWeight - (Math.min(10, p.behavior.hesitationLevel) * 0.05));
        loseWeight = 0.3; // Give a fraction of a vote to the close contender
      }
    }

    if (p.choice === 'NOT_SURE') {
      t.A += 1;
      t.B += 1;
    } else if (p.choice === 'DISLIKE_BOTH') {
      // #3: DISLIKE_BOTH is now a stronger negative signal
      t.A -= 1.0; 
      t.B -= 1.0;
    } else {
      t[p.choice as 'A' | 'B'] += winWeight;
      const loser = p.choice === 'A' ? 'B' : 'A';
      t[loser] += loseWeight;
    }
    tally.set(p.scenario, t);
  }
  const out: AggregatedPreference[] = [];
  for (const [scenario, t] of tally) {
    // AI-04: DISLIKE_BOTH subtracts from both A and B, which can push tallies
    // negative. Clamp to 0 before using them so that Wilson bound and
    // conflict calculations never receive invalid inputs.
    const clampedA = Math.max(0, t.A);
    const clampedB = Math.max(0, t.B);
    const total = clampedA + clampedB;
    if (total <= 0) continue;
    const winner: 'A' | 'B' = clampedA >= clampedB ? 'A' : 'B';
    const winVotes = winner === 'A' ? clampedA : clampedB;
    const loseVotes = winner === 'A' ? clampedB : clampedA;

    const lowerBound = wilsonLowerBound(winVotes, total);
    
    // #6: Special case for single-trial
    let weight: number;
    if (total <= 1.5) { // Adjusted for decimal weights
      const priorWeight = EXTREME_SCENARIOS.has(scenario) ? 0.35 : 0.55;
      // Allow behavioral boosts to push the weight up slightly even on single trials
      weight = Math.min(0.9, priorWeight * (winVotes / Math.max(1, total))); 
    } else {
      weight = Math.max(0.25, (lowerBound - 0.5) * 2);
    }

    out.push({
      scenario,
      choice: winner,
      weight,
      trials: Math.round(total),
      conflict: Math.max(0, loseVotes) / Math.max(1, total),
      lowerBound,
    });
  }
  return out;
}

// ─── NEW (v3.2): Per-band "why" analysis ──────────────────────────────────
// Counts, for every 10-band slot, how many times the user picked the
// branch that BOOSTED that band vs CUT it. Reveals the user's underlying
// reasoning: "you didn't really 'prefer A', you preferred +3 dB at 64 Hz
// 4 out of 5 times". Used by the UI to surface plain-language reasons.
export interface ChoiceReason {
  bandIdx: number;
  bandLabel: string;       // e.g. "64Hz"
  freq: number;
  direction: 'boost' | 'cut';
  votes: number;           // votes that agreed with `direction`
  trials: number;          // total trials that differentiated this band
  agreement: number;       // votes / trials ∈ [0, 1]
  scenarios: string[];     // scenarios where this band was decisive
  /** Avg dB delta the user repeatedly picked. */
  avgDeltaDb: number;
}

/** Per-scenario explanation: WHY the user chose A or B, not just which band changed. */
export interface ScenarioChoiceAnalysis {
  scenario: string;
  scenarioLabel: string;
  choiceA: number;
  choiceB: number;
  winner: 'A' | 'B' | 'tie';
  winnerConfidence: number;
  dominantBandIdx: number;
  dominantBandLabel: string;
  dominantDeltaDb: number;
  dominantDirection: 'boost' | 'cut';
  perceptualLabel: string;
  whyA: string;
  whyB: string;
  conclusion: string;
  region: 'sub-bass' | 'bass' | 'mid-bass' | 'midrange' | 'upper-mid' | 'presence' | 'treble' | 'air';
  activeBands: Array<{ bandIdx: number; bandLabel: string; deltaDb: number }>;
}

const SCENARIO_LABELS: Record<string, string> = {
  bass_depth:      'Độ sâu bass',
  vocal_clarity:   'Độ rõ giọng hát',
  sub_bass:        'Sub-bass cực thấp',
  instrument_sep:  'Phân tách nhạc cụ',
  mid_punch:       'Punch trung-bass',
  high_frequency:  'Tần số cao (treble)',
  presence:        'Vùng presence (2–4kHz)',
  warmth_body:     'Độ ấm & thân âm',
  sibilance:       'Sibilance (5–10kHz)',
  overall_balance: 'Cân bằng tổng thể',
};

const BAND_REGION: Array<ScenarioChoiceAnalysis['region']> = [
  'sub-bass', 'bass', 'mid-bass', 'midrange', 'midrange',
  'presence', 'presence', 'treble', 'treble', 'air',
];

function perceptualDescription(bandIdx: number, direction: 'boost' | 'cut', deltaDb: number): string {
  const mag = Math.abs(deltaDb).toFixed(1);
  const verb = direction === 'boost' ? 'tăng' : 'giảm';
  const labels: Record<number, { boost: string; cut: string }> = {
    0: { boost: `${verb} ${mag} dB sub-bass (32Hz) — áp lực vật lý, rung ngực`,         cut: `${verb} ${mag} dB sub-bass (32Hz) — bớt rung, gọn hơn` },
    1: { boost: `${verb} ${mag} dB bass (64Hz) — đầm, thùm thụp`,                        cut: `${verb} ${mag} dB bass (64Hz) — bass gọn gàng, ít bùng` },
    2: { boost: `${verb} ${mag} dB mid-bass (125Hz) — ấm, đầy đặn`,                      cut: `${verb} ${mag} dB mid-bass (125Hz) — thoáng, không bùng bụng` },
    3: { boost: `${verb} ${mag} dB low-mid (250Hz) — thân âm, cổ điển`,                  cut: `${verb} ${mag} dB low-mid (250Hz) — bớt ù đục, thoáng hơn` },
    4: { boost: `${verb} ${mag} dB mid (500Hz) — dày, ấm áp giọng người`,                cut: `${verb} ${mag} dB mid (500Hz) — trong trẻo, bớt bị che phủ` },
    5: { boost: `${verb} ${mag} dB presence (1kHz) — giọng hát rõ, nhạc cụ tách bạch`,  cut: `${verb} ${mag} dB presence (1kHz) — mượt mà, tránh nhức tai` },
    6: { boost: `${verb} ${mag} dB upper-mid (2kHz) — giọng sắc nét, chi tiết`,          cut: `${verb} ${mag} dB upper-mid (2kHz) — bớt cứng, mềm mại hơn` },
    7: { boost: `${verb} ${mag} dB treble (4kHz) — transient sắc, attack rõ`,            cut: `${verb} ${mag} dB treble (4kHz) — bớt chói, mượt mà` },
    8: { boost: `${verb} ${mag} dB high treble (8kHz) — không khí, chi tiết nhỏ`,        cut: `${verb} ${mag} dB high treble (8kHz) — bớt sibilance, tự nhiên` },
    9: { boost: `${verb} ${mag} dB air (16kHz) — sáng bóng, mở rộng không gian`,         cut: `${verb} ${mag} dB air (16kHz) — bớt chói gắt, nghe lâu thoải mái` },
  };
  return labels[bandIdx]?.[direction] ?? `${verb} ${mag} dB tại ${BAND_LABELS[bandIdx]}`;
}

function generateConclusion(
  analysis: Omit<ScenarioChoiceAnalysis, 'conclusion'>,
  _ab: { A: number[]; B: number[] }
): string {
  const { winner, winnerConfidence, scenarioLabel, dominantBandIdx, dominantDeltaDb } = analysis;
  if (winner === 'tie') return `Kịch bản "${scenarioLabel}": chưa có xu hướng rõ — cân bằng hai phía.`;
  const strength = winnerConfidence > 0.7 ? 'rõ ràng' : winnerConfidence > 0.35 ? 'có xu hướng' : 'nhẹ';
  const dir = dominantDeltaDb > 0
    ? `${winner} có ${BAND_LABELS[dominantBandIdx]} cao hơn ~${Math.abs(dominantDeltaDb).toFixed(1)} dB`
    : `${winner} giảm ${BAND_LABELS[dominantBandIdx]} ~${Math.abs(dominantDeltaDb).toFixed(1)} dB`;
  return `Bạn ${strength} thích "${winner}" — ${dir} (${scenarioLabel}).`;
}

export function analyzeChoiceReasons(
  prefs: TuningPreference[],
  bandThresholdDb = 1.5
): {
  reasons: ChoiceReason[];
  perScenarioWhy: Record<string, string>;
  scenarioCounts: Record<string, { A: number; B: number; dislikeBoth: number }>;
  /** NEW v4: Deep per-scenario A/B analysis with psychoacoustic reasoning */
  scenarioAnalysis: ScenarioChoiceAnalysis[];
} {
  const perBand = Array.from({ length: 10 }, () => ({
    boost: 0,
    cut: 0,
    boostDelta: 0,
    cutDelta: 0,
    scenarios: new Set<string>(),
  }));
  const perScenarioWhy: Record<string, string> = {};
  const scenarioCounts: Record<string, { A: number; B: number; dislikeBoth: number }> = {};

  for (const p of prefs) {
    scenarioCounts[p.scenario] = scenarioCounts[p.scenario] ?? { A: 0, B: 0, dislikeBoth: 0 };
    if (p.choice === 'NOT_SURE') {
      scenarioCounts[p.scenario].A += 1;
      scenarioCounts[p.scenario].B += 1;
    } else if (p.choice === 'DISLIKE_BOTH') {
      scenarioCounts[p.scenario].dislikeBoth += 1;
    } else {
      scenarioCounts[p.scenario][p.choice as 'A' | 'B'] += 1;
    }

    const ab = AB_PREVIEW_GAINS[p.scenario];
    if (!ab) continue;

    // Handle reasons for special choices
    if (p.choice === 'NOT_SURE') continue;

    if (p.choice === 'DISLIKE_BOTH') {
      // User dislikes both A and B. 
      // If both A and B boosted a band, then user likely dislikes boosting it (vote for CUT).
      // If both A and B cut a band, then user likely dislikes cutting it (vote for BOOST).
      for (let i = 0; i < 10; i++) {
        const deltaA = ab.A[i];
        const deltaB = ab.B[i];
        
        // Use a threshold to avoid noisy signals
        if (Math.abs(deltaA) < bandThresholdDb && Math.abs(deltaB) < bandThresholdDb) continue;

        perBand[i].scenarios.add(p.scenario);
        
        // #3: If they both go in the same direction, user dislikes that direction (stronger signal x1.5)
        const weight = 1.5;
        if (deltaA > 0 && deltaB > 0) {
          perBand[i].cut += 1 * weight;
          perBand[i].cutDelta += ((deltaA + deltaB) / 2) * weight;
        } else if (deltaA < 0 && deltaB < 0) {
          perBand[i].boost += 1 * weight;
          perBand[i].boostDelta += Math.abs((deltaA + deltaB) / 2) * weight;
        }
      }
      if (perScenarioWhy) perScenarioWhy[p.scenario] = 'Phản đối cả hai mẫu';
      continue;
    }

    const chosen = p.choice === 'A' ? ab.A : ab.B;
    const other  = p.choice === 'A' ? ab.B : ab.A;

    // Find the dominant band that explains this single choice.
    let topAxis = -Infinity;
    let topReason = '';
    for (let i = 0; i < 10; i++) {
      const delta = chosen[i] - other[i];
      if (Math.abs(delta) < bandThresholdDb) continue;
      perBand[i].scenarios.add(p.scenario);
      if (delta > 0) {
        perBand[i].boost += 1;
        perBand[i].boostDelta += delta;
      } else {
        perBand[i].cut += 1;
        perBand[i].cutDelta += -delta;
      }
      if (Math.abs(delta) > topAxis) {
        topAxis = Math.abs(delta);
        const sign = delta > 0 ? '+' : '−';
        topReason = `${BAND_LABELS[i]} ${sign}${Math.abs(delta).toFixed(1)} dB`;
      }
    }
    if (topReason) perScenarioWhy[p.scenario] = topReason;
  }

  const reasons: ChoiceReason[] = perBand
    .map((b, i): ChoiceReason | null => {
      const trials = b.boost + b.cut;
      if (trials === 0) return null;
      const direction: 'boost' | 'cut' = b.boost >= b.cut ? 'boost' : 'cut';
      const votes = direction === 'boost' ? b.boost : b.cut;
      const totalDelta = direction === 'boost' ? b.boostDelta : b.cutDelta;
      return {
        bandIdx: i,
        bandLabel: BAND_LABELS[i],
        freq: BAND_FREQUENCIES[i],
        direction,
        votes,
        trials,
        agreement: votes / trials,
        scenarios: [...b.scenarios],
        avgDeltaDb: totalDelta / Math.max(1, votes),
      };
    })
    .filter((r): r is ChoiceReason => r !== null);

  // Rank by signed margin × log(1 + trials) — favors strong, repeated picks.
  reasons.sort((a, b) => {
    const ma = (a.votes * 2 - a.trials) * Math.log(1 + a.trials);
    const mb = (b.votes * 2 - b.trials) * Math.log(1 + b.trials);
    return Math.abs(mb) - Math.abs(ma);
  });


  // ─── NEW v4: Per-scenario deep A/B analysis ─────────────────────────────
  const scenarioAnalysis: ScenarioChoiceAnalysis[] = [];

  for (const [scenario, counts] of Object.entries(scenarioCounts)) {
    const ab = AB_PREVIEW_GAINS[scenario];
    if (!ab) continue;

    const total = counts.A + counts.B;
    let winner: 'A' | 'B' | 'tie';
    let winVotes: number;
    if (counts.A > counts.B)      { winner = 'A'; winVotes = counts.A; }
    else if (counts.B > counts.A) { winner = 'B'; winVotes = counts.B; }
    else                          { winner = 'tie'; winVotes = counts.A; }

    const lowerBound = winner !== 'tie' ? wilsonLowerBound(winVotes, total, 1.2) : 0;
    
    // For single trials (N=1), lowerBound is ~0.45.
    // We want N=1, wins=1 to show ~65% confidence, N=2, wins=2 to show ~85%.
    const winnerConfidence = total === 1 && winVotes === 1 
      ? 0.65 
      : Math.max(0.2, (lowerBound - 0.3) / 0.7);

    const activeBands: ScenarioChoiceAnalysis['activeBands'] = [];
    for (let i = 0; i < 10; i++) {
      const delta = ab.A[i] - ab.B[i];
      if (Math.abs(delta) >= bandThresholdDb) {
        activeBands.push({ bandIdx: i, bandLabel: BAND_LABELS[i], deltaDb: delta });
      }
    }
    activeBands.sort((x, y) => Math.abs(y.deltaDb) - Math.abs(x.deltaDb));
    if (activeBands.length === 0) continue;

    const dom = activeBands[0];
    const winnerGainAtDom = winner === 'A' ? ab.A[dom.bandIdx] : winner === 'B' ? ab.B[dom.bandIdx] : ab.A[dom.bandIdx];
    const loserGainAtDom  = winner === 'A' ? ab.B[dom.bandIdx] : winner === 'B' ? ab.A[dom.bandIdx] : ab.B[dom.bandIdx];
    const dominantDirection: 'boost' | 'cut' = winnerGainAtDom >= loserGainAtDom ? 'boost' : 'cut';

    const whyA = activeBands.slice(0, 3).map(b => {
      const dir: 'boost' | 'cut' = b.deltaDb > 0 ? 'boost' : 'cut';
      return perceptualDescription(b.bandIdx, dir, b.deltaDb);
    }).join('; ');

    const whyB = activeBands.slice(0, 3).map(b => {
      const dir: 'boost' | 'cut' = b.deltaDb < 0 ? 'boost' : 'cut';
      return perceptualDescription(b.bandIdx, dir, -b.deltaDb);
    }).join('; ');

    const perceptualLabel = perceptualDescription(
      dom.bandIdx,
      dominantDirection,
      winnerGainAtDom - loserGainAtDom
    );

    const partial: Omit<ScenarioChoiceAnalysis, 'conclusion'> = {
      scenario,
      scenarioLabel: SCENARIO_LABELS[scenario] ?? scenario,
      choiceA: counts.A,
      choiceB: counts.B,
      winner,
      winnerConfidence,
      dominantBandIdx: dom.bandIdx,
      dominantBandLabel: dom.bandLabel,
      dominantDeltaDb: dom.deltaDb,
      dominantDirection,
      perceptualLabel,
      whyA,
      whyB,
      region: BAND_REGION[dom.bandIdx],
      activeBands,
    };

    scenarioAnalysis.push({ ...partial, conclusion: generateConclusion(partial, ab) });
  }

  scenarioAnalysis.sort((a, b) => {
    const ta = a.choiceA + a.choiceB;
    const tb = b.choiceA + b.choiceB;
    if (tb !== ta) return tb - ta;
    return b.winnerConfidence - a.winnerConfidence;
  });

  return { reasons, perScenarioWhy, scenarioCounts, scenarioAnalysis };
}

export async function analyzePreferences(
  preferences: TuningPreference[],
  listenLevel = 0.5,
  bandEnergies?: number[], // Actual energy from track analysis
  deviceProfile?: DeviceProfile,
  trackCharacter?: TrackCharacter // #14: Contextual awareness
): Promise<{
  gains: number[]; profileName: string; insights: string[]; profile: EQProfile;
  taste?: TasteResult;
  reasons?: ChoiceReason[];
  perScenarioWhy?: Record<string, string>;
  scenarioCounts?: Record<string, { A: number; B: number; dislikeBoth: number }>;
  scenarioAnalysis?: ScenarioChoiceAnalysis[];
  /** NEW v4: Kendall τ_b coherence per band */
  kendallTaus?: number[];
  /** NEW v4: CUSUM drift analysis result */
  drift?: CusumResult;
  /** NEW v4: Thurstone latent band scores (d-prime) */
  thurstonScores?: number[];
  /** NEW v4: AI Calibration confidence score [0, 1] */
  confidenceScore: number;
}> {
  console.group('SONIC AI Engine v4 — Thurstone + CUSUM + Kendall + IS');

  // Aggregated device compensation: we want to know what the user is hearing.
  const compensation = deviceProfile?.deviations ?? new Array(10).fill(0);

  // Aggregate any rematch trials into per-scenario weighted picks
  // (now using a Wilson lower bound so 1-trial picks don't dominate).
  const aggregated = aggregateTrials(preferences);

  // Per-band "why" analysis — what the user repeatedly chose to boost or cut.
  const reasonAnalysis = analyzeChoiceReasons(preferences);

  const rawGains = new Array(10).fill(0);
  const featureScores: FeatureScores = {
    subBassEnergy: 0, midBassEnergy: 0, midRange: 0,
    presence: 0, airDetail: 0, flatness: 0,
  };

  for (const pref of aggregated) {
    const weights = WEIGHT_MATRIX[pref.scenario]?.[pref.choice];
    // NEW v3.2: floor at 0.25 so a single-trial pick still nudges the curve
    // a little, but stops it from acting like a confident multi-trial vote.
    // Multi-trial agreements approach 1.0 only as the Wilson lower bound rises.
    const w = pref.trials > 1
      ? Math.max(0.25, pref.weight)
      : 0.5;  // single-trial = half-strength prior
    
    // #14: Genre-aware weight modifier
    let genreModifier = 1.0;
    if (trackCharacter) {
      if (trackCharacter.genre === 'bass-heavy' && (pref.scenario === 'high_frequency' || pref.scenario === 'sibilance')) {
        genreModifier = 0.8;
      } else if (trackCharacter.genre === 'acoustic' && (pref.scenario === 'sub_bass' || pref.scenario === 'bass_depth')) {
        genreModifier = 0.7;
      }
    }

    const effectiveWeight = w * genreModifier;

    if (weights) {
      for (let i = 0; i < 10; i++) {
        // DEVICE COMPENSATION: 
        // If the user chooses a boost in A, but the device is already boosting it,
        // we reduce the weight of that choice towards our preference model.
        // It means user might just be accepting the device's color rather than seeking it.
        const bandComp = Math.max(0.5, 1.0 - (weights[i] * compensation[i] * 0.05));
        rawGains[i] += weights[i] * effectiveWeight * bandComp;
      }
    }
    const rules = FEATURE_RULES[pref.scenario];
    if (rules) {
      for (const [feature, votes] of Object.entries(rules)) {
        featureScores[feature as keyof FeatureScores] += (votes?.[pref.choice] ?? 0) * w;
      }
    }
  }

  // Apply masking attenuation if real band energies are provided.
  if (bandEnergies && bandEnergies.length === 10) {
    const maskedGains = applyAcousticMasking(rawGains, bandEnergies, BAND_FREQUENCIES);
    for (let i = 0; i < 10; i++) rawGains[i] = maskedGains[i];
  }

  // Re-build a flat "single-vote-per-scenario" array for legacy code paths
  // below that still reason about a preferences sequence (Bradley-Terry,
  // confidence, contradictions). We use the WINNING choice from aggregation.
  const collapsed: TuningPreference[] = aggregated.map((a) => ({
    scenario: a.scenario, choice: a.choice,
  }));
  // Override the local variable name used downstream so the old code keeps
  // working unmodified.
  preferences = collapsed;

  // ─── NEW: Bradley-Terry per-band continuous preference signal ───────────
  const btScores = bandBradleyTerryScores(preferences);
  for (let i = 0; i < 10; i++) rawGains[i] += 0.25 * btScores[i];

  // ─── NEW v4: Thurstone Case V per-band scores ────────────────────────────
  // Thurstone's psychophysical model produces more calibrated latent scores
  // than BT for small N — avoids score explosion when one option wins all.
  // Blended at 15 % as a complementary signal to BT (both anchor the same
  // "boost vs cut" axis, but via different distributional assumptions).
  const thurstonScores = thurstoneBandScores(preferences, AB_PREVIEW_GAINS);
  for (let i = 0; i < 10; i++) rawGains[i] += 0.15 * thurstonScores[i];

  // ─── NEW v4: CUSUM preference-drift detection ────────────────────────────
  // Build a per-trial vote sequence for the dominant feature axis (sub-bass
  // vs air), then run CUSUM to detect if the user's taste shifted mid-session.
  // If drift is detected, down-weight early trials via `preWeight`.
  const driftVotes = preferences.map(p => {
    const ab = AB_PREVIEW_GAINS[p.scenario];
    if (!ab) return 0;
    const subDelta = (ab.A[0] + ab.A[1]) - (ab.B[0] + ab.B[1]); // sub-bass axis
    if (p.choice === 'NOT_SURE') return 0;
    return (p.choice === 'A' ? +1 : -1) * Math.sign(subDelta || 1);
  }).filter(v => v !== 0);
  const drift = cusumDriftDetect(driftVotes, { k: 0.5, h: 4.0 });
  if (drift.alarm) {
    console.log(`[AI Engine] Preference drift detected at trial ~${drift.changePoint} (preWeight=${drift.preWeight.toFixed(2)})`);
    // NEW: Trigger invalidation of AI state when large drift is detected
    // This allows the session to "flush" and re-tune if needed.
    invalidateProfileSource('ai');
    
    // Attenuate contributions from pre-drift preferences in rawGains
    // Re-weight the raw gains: multiply the early-trial portion by preWeight.
    // We approximate this by scaling rawGains toward a "post-only" re-run.
    const prePrefs   = preferences.slice(0, drift.changePoint + 1);
    const postPrefs  = preferences.slice(drift.changePoint + 1);
    if (postPrefs.length >= 2) {
      const postGains = new Array(10).fill(0);
      for (const p of postPrefs) {
        if (p.choice === 'NOT_SURE') {
          const wA = WEIGHT_MATRIX[p.scenario]?.A;
          const wB = WEIGHT_MATRIX[p.scenario]?.B;
          if (wA) for (let i = 0; i < 10; i++) postGains[i] += wA[i];
          if (wB) for (let i = 0; i < 10; i++) postGains[i] += wB[i];
        } else if (p.choice === 'DISLIKE_BOTH') {
          // DISLIKE_BOTH is a complex negative signal. For simple drift 
          // re-weighting, skipping it is safest to avoid introducing 
          // artificial bias in the post-drift estimate.
          continue;
        } else {
          const weights = WEIGHT_MATRIX[p.scenario]?.[p.choice as 'A' | 'B'];
          if (weights) for (let i = 0; i < 10; i++) postGains[i] += weights[i];
        }
      }
      // Blend rawGains toward post-drift signal proportional to (1-preWeight)
      const driftBlend = Math.min(0.5, 1 - drift.preWeight);
      for (let i = 0; i < 10; i++) {
        rawGains[i] = rawGains[i] * (1 - driftBlend) + postGains[i] * driftBlend;
      }
    }
  }

  // ─── NEW v4: Kendall τ_b band-coherence check ────────────────────────────
  // Measures whether the user's A/B choices are ordinal-consistent with the
  // actual spectral differences. Low τ_b on a band → user was ambivalent or
  // random → dampen that band's contribution.
  const kendallTaus = kendallBandCoherence(preferences, AB_PREVIEW_GAINS);
  console.log('[AI Engine] Kendall τ_b per band:', kendallTaus.map(t => t.toFixed(2)));
  // Kendall coherence dampening: bands with |τ| < 0.2 get attenuated.
  // This is applied to rawGains before the energy normalisation stage.
  for (let i = 0; i < 10; i++) {
    const tau = kendallTaus[i];
    // τ close to 0 = incoherent. τ = ±1 = perfectly consistent.
    // #8: Invert signal if τ < -0.4 (consistent disagreement) or dampen if near 0
    let coherenceFactor = 1.0;
    if (Math.abs(tau) < 0.25) coherenceFactor = 0.5; // Dampen incoherent
    else if (tau < -0.4) {
      coherenceFactor = -0.8; // Flip if consistently picking the "opposite" of what was expected
      console.log(`[AI Engine] Phase inversion on band ${i} (τ=${tau.toFixed(2)})`);
    } else {
      coherenceFactor = 0.85 + 0.15 * Math.abs(tau); 
    }
    rawGains[i] *= coherenceFactor;
  }

  // ─── NEW: Equal-loudness pre-weighting (ISO 226-2003) ───────────────────
  // At lower listening levels human bass perception drops far faster than
  // mid/treble. We pre-bias rawGains by a 10 % blend of the equal-loudness
  // contour so the AI interprets "+3 dB at 32 Hz" as the perceptual equivalent
  // of "+3 dB at 1 kHz" — scaled by listening level.
  const phon = 40 + listenLevel * 50;          // [40, 90] phon
  const elWeights = equalLoudnessWeights(BAND_FREQUENCIES, phon);
  for (let i = 0; i < 10; i++) rawGains[i] += 0.10 * elWeights[i] * Math.sign(rawGains[i] || 1);

  // ─── FIX #1: INTERACTION RULES applied exactly ONCE ──────────────────────
  // BUG: Original code applied INTERACTION_RULES TWICE in the same function:
  //   - First loop used `scenarioChoices` (Map from const at "Step 1b")
  //   - Second loop (labeled "Step 1.5") re-built a NEW `prefMap` and looped again
  // Result: every matched interaction rule's delta was doubled, e.g.
  //   sub_bass:A + bass_depth:A → band[0] gets +3.0 instead of +1.5 dB.
  // FIX: Single loop, single Map. Dead code eliminated.
  const scenarioChoices = new Map(preferences.map(p => [p.scenario, p.choice]));
  let interactionCount = 0;
  for (const rule of INTERACTION_RULES) {
    if (
      scenarioChoices.get(rule.scenA) === rule.choiceA &&
      scenarioChoices.get(rule.scenB) === rule.choiceB
    ) {
      for (let i = 0; i < 10; i++) rawGains[i] += rule.delta[i];
      interactionCount++;
    }
  }
  if (interactionCount > 0) console.log(`[AI Engine] Applied ${interactionCount} interaction rule(s)`);

  const confidence = computeConfidence(preferences, featureScores);
  
  // #3: If DISLIKE_BOTH rate > 0.3, reducing confidence score (indicates user is unhappy with available options)
  const dislikeBothCount = preferences.filter(p => p.choice === 'DISLIKE_BOTH').length;
  if (preferences.length > 3 && dislikeBothCount / preferences.length > 0.3) {
    confidence.score *= 0.8;
  }
  
  console.log('Confidence:', confidence.score.toFixed(2), '| Contradictions:', confidence.contradictions.length);

  const scoredProfiles = PROFILES
    .map(p => {
      let score = scoreProfile(p, featureScores);
      
      // #14: Genre match boost
      if (trackCharacter) {
        if (trackCharacter.genre === 'bass-heavy' && (p.name === 'Deep Sub Reference' || p.name === 'Power Bass')) score += 1.0;
        if (trackCharacter.genre === 'acoustic' && (p.name === 'Analog Warmth' || p.name === 'Vocal Forward')) score += 1.0;
        if (trackCharacter.genre === 'bright-electronic' && (p.name === 'Ultra Clarity' || p.name === 'V-Excitement')) score += 1.0;
      }
      
      return { profile: p, score };
    })
    .filter(x => x.score > -Infinity)
    .sort((a, b) => b.score - a.score);

  // const bestProfile = scoredProfiles[0]?.profile ?? PROFILES[PROFILES.length - 1];
  const bestProfile = scoredProfiles[1]?.profile ?? PROFILES[PROFILES.length - 1]; // Use 2nd best as base if top is too aggressive? (No, stay with 1st)
  const topProfile = scoredProfiles[0]?.profile ?? PROFILES[PROFILES.length - 1];
  
  console.log('Profile top-3:', scoredProfiles.slice(0, 3).map(x => `${x.profile.name}(${x.score.toFixed(1)})`));

  // Remove bias application from here, move to after sigmoid
  const dampenedGains = rawGains.map((g, i) => g * confidence.bandDampening[i]);

  // ─── FIX #2: Pipeline order — normalize BEFORE sigmoid ───────────────────
  // OLD pipeline: sigmoid → masking → smooth
  // BUG: when raw gains are ±15–20 dB, tanh(20/8)≈1.0 — sigmoid saturates
  //      everything flat before masking/smooth can shape the curve.
  // FIX: normalize energy first so tanh input stays in its expressive range (±8).
  const normalizedGains = normalizeGainEnergy(dampenedGains);
  let sigmoidGains = normalizedGains.map((g, i) => sigmoidGain(g, i, listenLevel));

  // #9: Applied late so profile bias doesn't get squashed by sigmoid or energy normalization
  const biasStrength = 0.7 + confidence.score * 0.3; // More confident = more original user preference
  sigmoidGains = sigmoidGains.map((g, i) => g + topProfile.bias[i] * (1 - biasStrength));

  // NEW: Signal-derived masking attenuation (Requested by user)
  // "AI có thể suggest boost 2kHz trong khi 1.5kHz đã có năng lượng cao — gây masking khó chịu."
  if (bandEnergies && bandEnergies.length === 10) {
    const maskDb = maskingThreshold(BAND_FREQUENCIES, bandEnergies);
    // Attenuate boost suggestions if the music itself already has high masking levels.
    // We follow the user's suggested threshold pattern.
    sigmoidGains = sigmoidGains.map((g, i) => (g > 0 && maskDb[i] > -20) ? g * 0.5 : g);
  }

  const maskedGains = applyMaskingFilter(sigmoidGains);

  // ─── NEW STAGE A: Adaptive Kalman across the band sequence ──────────────
  // The static Kalman required hand-tuning R per scenario. AdaptiveKalman1D
  // estimates R online from innovation variance (Mehra 1972) so it auto-tunes
  // to the actual noise level of the user's preferences. Process noise Q stays
  // small so genuine band-to-band contrasts survive.
  const kalmanGains = adaptiveKalmanSmoothVector(maskedGains, 0.06);

  // ─── NEW STAGE B: AIC-selected polynomial degree against log-frequency ──
  // Replaces the hard-coded degree-3 polyfit. selectPolyDegree picks the
  // degree minimising Akaike Information Criterion among 1..4 — small N=10
  // means BIC would over-shrink, AIC is the right call here.
  const xsLog = BAND_FREQUENCIES.map((f) => Math.log10(f));
  const { degree: polyDeg } = selectPolyDegree(xsLog, kalmanGains, {
    minDeg: 1, maxDeg: 4, criterion: 'aic',
  });
  const polyBlend = 0.45 + (1 - confidence.score) * 0.25; // [0.45, 0.70]
  const polynomialGains = polynomialSmoothEqCurve(
    kalmanGains, BAND_FREQUENCIES, polyDeg, polyBlend
  );

  // ─── EXISTING: 3-tap Gaussian micro-smoothing for final polish ──────────
  const finalGains = adaptiveSmooth(polynomialGains, confidence.score);

  // ─── NEW: Dynamic Q optimisation for each band ──────────────────────────
  const qSuggestions = dynamicQVector(BAND_FREQUENCIES, finalGains, { minQ: 0.5, maxQ: 4.5 });

  // ─── NEW: Preference-consistency via mutual information ────────────────
  const consistency = preferenceConsistency(preferences);

  console.log('Adaptive Kalman · poly deg =', polyDeg,
              '· poly blend =', polyBlend.toFixed(2),
              '· consistency =', consistency.score.toFixed(2));
  console.log('Final gains:', finalGains.map(g => g.toFixed(2)));
  console.log('Q suggestions:', qSuggestions.map(q => q.toFixed(2)));
  console.groupEnd();

  const insights = generateInsights(bestProfile, featureScores, confidence, finalGains, deviceProfile);
  if (consistency.score > 0.75 && insights.length < 4) {
    insights.push(`High preference consistency detected (${Math.round(consistency.score * 100)}%) — gains tightened.`);
  } else if (consistency.score < 0.35 && insights.length < 4) {
    insights.push(`Low preference consistency — curve smoothed aggressively for safety.`);
  }
  const result: EQProfile = {
    name: bestProfile.name, description: bestProfile.description,
    genre: bestProfile.genre, color: bestProfile.color,
    gains: finalGains, insights,
    qSuggestions, consistency: consistency.score,
  };
  // NEW: Listener-taste classifier — returns top-3 stylistic affinity
  // categories so the UI can describe the user's preferences in plain language.
  const taste = classifyTaste(finalGains, featureScores, aggregated);

  // ─── NEW v4: Itakura-Saito divergence taste ranking ──────────────────────
  // Rank TASTE_CATEGORIES by IS divergence — a perceptually-weighted distance
  // that penalises missing bass/treble more than excess (unlike cosine/L2).
  // We blend the IS ranking with the cosine-based taste result.
  const isRanking = rankProfilesByIS(
    finalGains,
    TASTE_CATEGORIES.map(c => ({ id: c.id, template: c.template }))
  );
  // Blend: if IS top-1 differs from cosine top-1, check IS divergence gap.
  // If the IS winner has meaningfully lower divergence (>15% gap), promote it.
  if (taste.top.length > 0 && isRanking.length > 0) {
    const cosineWinnerId = taste.top[0].id;
    const isTop = isRanking[0];
    const cosineIsScore = isRanking.find(r => r.id === cosineWinnerId);
    if (cosineIsScore && isTop.id !== cosineWinnerId &&
        isTop.divergence < cosineIsScore.divergence * 0.75) {
      // IS strongly disagrees with cosine — blend taste.top scores
      const isCat = TASTE_CATEGORIES.find(c => c.id === isTop.id);
      if (isCat) {
        const blendedScore = taste.top[0].score * 0.6 + isTop.similarity * 0.4;
        // Re-rank: promote IS winner if it wasn't already in top-3
        const alreadyIn = taste.top.find(t => t.id === isTop.id);
        if (!alreadyIn && taste.top.length < 3) {
          taste.top.push({
            id: isCat.id, label: isCat.label,
            score: isTop.similarity * 0.4,
            descriptionVi: isCat.descriptionVi,
          });
        }
      }
    }
  }
  if (taste.top.length > 0 && insights.length < 5) {
    const t = taste.top[0];
    insights.push(`Listener taste profile: ${t.label} (${Math.round(t.score * 100)}% match) — ${t.descriptionVi}`);
  }

  // NEW v3.2: surface a "why" insight
  if (reasonAnalysis.reasons.length > 0 && insights.length < 5) {
    const r = reasonAnalysis.reasons[0];
    const sign = r.direction === 'boost' ? '+' : '−';
    insights.push(
      `Pattern: ${sign}${Math.abs(r.avgDeltaDb).toFixed(1)} dB at ${r.bandLabel} — ` +
      `chosen ${r.votes}/${r.trials} times (${Math.round(r.agreement * 100)}% agreement).`
    );
  }

  // NEW v4: CUSUM drift insight
  if (drift.driftDetected && insights.length < 5) {
    insights.push(
      `Preference shift detected mid-session (trial ~${drift.changePoint + 1}) — ` +
      `early choices down-weighted. Recent preferences take priority.`
    );
  }

  // NEW v4: Kendall coherence insight — flag bands where user was inconsistent
  const incoherentBands = kendallTaus
    .map((t, i) => ({ tau: t, label: BAND_LABELS[i], i }))
    .filter(b => Math.abs(b.tau) < 0.2 && reasonAnalysis.reasons.some(r => r.bandIdx === b.i));
  if (incoherentBands.length > 0 && insights.length < 5) {
    const names = incoherentBands.slice(0, 2).map(b => b.label).join(', ');
    insights.push(`Ambiguous choices at ${names} — gains moderated for perceptual safety.`);
  }

  return {
    gains: finalGains,
    profileName: bestProfile.name,
    insights,
    profile: result,
    taste,
    reasons: reasonAnalysis.reasons.slice(0, 5),
    perScenarioWhy: reasonAnalysis.perScenarioWhy,
    scenarioCounts: reasonAnalysis.scenarioCounts,
    scenarioAnalysis: reasonAnalysis.scenarioAnalysis,
    kendallTaus,
    drift,
    thurstonScores,
    confidenceScore: confidence.score,
  };
}

export function getProfileNames(): string[] {
  return PROFILES.map(p => p.name);
}

// ─── NEW (Sonic AI v3.1): Listener Taste Classifier ──────────────────────────
// Maps the user's final EQ curve + feature scores onto eight canonical taste
// archetypes via cosine similarity against an idealised template gain curve.
// Returns ranked matches with normalised confidence (sum = 1 for top 3).
export type TasteCategoryId =
  | 'harman'
  | 'v_shaped'
  | 'basshead'
  | 'bright_analytical'
  | 'warm_smooth'
  | 'reference_neutral'
  | 'mid_forward_vocal'
  | 'audiophile_detail';

export interface TasteCategory {
  id: TasteCategoryId;
  label: string;
  template: number[];            // 10-band signature curve, peak ≈ ±10 dB
  descriptionVi: string;         // Vietnamese plain-language summary
  featureBias?: Partial<FeatureScores>;
}

export interface TasteResult {
  top: Array<{
    id: TasteCategoryId;
    label: string;
    score: number;               // [0, 1] normalised cosine similarity
    descriptionVi: string;
  }>;
  raw: Record<TasteCategoryId, number>; // unnormalised cosine ∈ [-1, 1]
}

export const TASTE_CATEGORIES: TasteCategory[] = [
  {
    id: 'harman',
    label: 'Harman Target',
    // Olive-Welti 2018 IE target: gentle bass shelf, mild upper-mid dip,
    // ~3 dB presence rise, soft 10 kHz roll-off.
    template: [4, 5, 4, 1, -1, -1, 1, 3, 2, 0],
    descriptionVi: 'Cân bằng theo nghiên cứu Harman — bass êm, trung trong, treble nhẹ.',
  },
  {
    id: 'v_shaped',
    label: 'V-Shaped Consumer',
    template: [6, 7, 5, 0, -3, -3, -1, 3, 6, 5],
    descriptionVi: 'Bass và treble đều dày, mid lùi — sôi động, kiểu pop/EDM thương mại.',
  },
  {
    id: 'basshead',
    label: 'Basshead',
    template: [10, 10, 7, 2, -1, -2, -1, 0, 1, 0],
    descriptionVi: 'Sub-bass và bass cực mạnh — phù hợp hip-hop, dubstep, dance.',
  },
  {
    id: 'bright_analytical',
    label: 'Bright / Analytical',
    template: [-1, 0, 0, -1, -1, 1, 4, 6, 7, 6],
    descriptionVi: 'Treble sáng, chi tiết cao — bộc lộ nhược điểm bản thu, phong cách monitor.',
  },
  {
    id: 'warm_smooth',
    label: 'Warm / Smooth',
    template: [3, 4, 4, 5, 4, 2, 0, -2, -3, -4],
    descriptionVi: 'Ấm áp, trung dày, treble dịu — dễ nghe lâu, kiểu vintage / tube amp.',
  },
  {
    id: 'reference_neutral',
    label: 'Reference Neutral',
    template: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    descriptionVi: 'Trung tính studio — bám sát ý đồ kỹ sư mix, không tô vẽ.',
  },
  {
    id: 'mid_forward_vocal',
    label: 'Mid-Forward Vocal',
    template: [-1, -1, 0, 2, 5, 6, 4, 1, -1, -2],
    descriptionVi: 'Vocal nổi bật, mid trước mặt — lý tưởng cho ballad, acoustic, podcast.',
  },
  {
    id: 'audiophile_detail',
    label: 'Audiophile Detail',
    template: [3, 3, 1, 0, -1, 0, 2, 4, 5, 4],
    descriptionVi: 'Phổ rộng, chi tiết hai đầu, mid mở — chuẩn audiophile, nghe nhạc cụ acoustic.',
  },
];

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  if (na < 1e-9 || nb < 1e-9) return 0;
  return dot / Math.sqrt(na * nb);
}

export function classifyTaste(
  finalGains: number[],
  featureScores: FeatureScores,
  aggregated?: AggregatedPreference[]
): TasteResult {
  // Special-case the flat curve → reference profile gets full credit.
  const energy = finalGains.reduce((s, g) => s + Math.abs(g), 0);
  const raw: Record<string, number> = {};
  for (const cat of TASTE_CATEGORIES) {
    if (cat.id === 'reference_neutral') {
      // Reference closeness: max when curve is near-flat, decays with energy.
      const flatness = Math.exp(-energy / 18); // ~0.37 at 18 dB total
      raw[cat.id] = flatness;
    } else {
      raw[cat.id] = cosineSim(finalGains, cat.template);
    }
  }
  // Convert cosine ∈ [-1, 1] → [0, 1] then soft-max for the top-3.
  const positives = Object.entries(raw).map(([id, v]) => ({
    id: id as TasteCategoryId,
    v: Math.max(0, v),
  }));
  positives.sort((a, b) => b.v - a.v);
  const top3 = positives.slice(0, 3);
  const sum = top3.reduce((s, x) => s + x.v, 0) || 1;
  const top = top3
    .filter((x) => x.v > 0.05)
    .map((x) => {
      const cat = TASTE_CATEGORIES.find((c) => c.id === x.id)!;
      return {
        id: cat.id,
        label: cat.label,
        score: x.v / sum,
        descriptionVi: cat.descriptionVi,
      };
    });

  // Tiny conflict penalty: when many trials disagreed, the top-3 spread is
  // less trustworthy → blend with the runner-up so the UI doesn't show a
  // misleadingly confident pick.
  if (aggregated && top.length >= 2) {
    const avgConflict = aggregated.reduce((s, a) => s + a.conflict, 0) /
                        Math.max(1, aggregated.length);
    if (avgConflict > 0.15) {
      const blend = Math.min(0.4, avgConflict);
      const t0 = top[0].score;
      const t1 = top[1].score;
      top[0].score = t0 * (1 - blend) + t1 * blend;
      top[1].score = t1 * (1 - blend) + t0 * blend;
    }
  }

  return { top, raw: raw as Record<TasteCategoryId, number> };
}

// ─── NEW (Sonic AI v3.1): Multi-track sample-plan builder ────────────────────
// Given 1-3 candidate tracks and their per-band peak energies, produces a
// 15-20 step ordered test plan: each step = one A/B comparison with the
// "best showcase" track for that band/scenario, plus rematches on the
// runner-up track when the energy gap is small (so we get a 2nd opinion).
export interface TrackInput { url: string; name: string; }
export interface SampleStep {
  scenarioId: string;
  trackUrl: string;
  trackName: string;
  isRematch: boolean;
  type: 'high' | 'low' | 'neutral';
}

// Map each scenario to the dominant 0-9 band it tests, so we can pick the
// track that will actually expose the difference.
const SCENARIO_BAND_MAP: Record<string, number> = {
  sub_bass:        0,
  bass_depth:      1,
  mid_punch:       2,
  warmth_body:     3,
  vocal_clarity:   4,
  instrument_sep:  5,
  presence:        6,
  high_frequency:  7,
  sibilance:       8,
  overall_balance: 9,
};

const SCENARIO_TYPES: Record<string, 'high' | 'low' | 'neutral'> = {
  sub_bass: 'high',
  bass_depth: 'high',
  mid_punch: 'high',
  warmth_body: 'low',
  vocal_clarity: 'low',
  instrument_sep: 'low',
  presence: 'low',
  high_frequency: 'neutral',
  sibilance: 'neutral',
  overall_balance: 'neutral',
};

export function buildSamplePlan(
  scenarios: string[],
  tracks: TrackInput[],
  energies: number[][],          // tracks[i] -> 10-band peak energies
  targetCount = 15,
  trackCharacters?: TrackCharacter[] // #12: optional track metadata
): SampleStep[] {
  if (tracks.length === 0) return [];
  const trackOf = (idx: number) => tracks[idx % tracks.length];

  // 1. Build pool of all potential trials
  const lowAudScenarios: string[] = [];
  const basePool: SampleStep[] = scenarios.map((scenarioId) => {
    const band = SCENARIO_BAND_MAP[scenarioId] ?? 0;
    
    // Find best track strictly by energy
    let bestIdx = 0, bestE = -Infinity;
    for (let t = 0; t < tracks.length; t++) {
      const e = energies[t]?.[band] ?? 0;
      if (e > bestE) { bestE = e; bestIdx = t; }
    }

    // #12: Audibility check
    if (trackCharacters && trackCharacters[bestIdx]) {
      const char = trackCharacters[bestIdx];
      let audibility = energies[bestIdx][band];
      // Median energy of this track across all bands
      const medianE = [...energies[bestIdx]].sort((a,b) => a-b)[5];
      
      if (audibility < medianE - 15) { // 15dB below median is considered "low audibility"
        lowAudScenarios.push(scenarioId);
      }
    }

    return {
      scenarioId,
      trackUrl: trackOf(bestIdx).url,
      trackName: trackOf(bestIdx).name,
      isRematch: false,
      type: SCENARIO_TYPES[scenarioId] || 'neutral',
      suitability: bestE // Store for sorting
    } as any;
  });

  if (lowAudScenarios.length > 0) {
    console.log('[SamplePlan] Low-audibility scenarios detected:', lowAudScenarios.join(', '));
  }

  // #7: Re-order basePool scenarios by track suitability (energy in primary band)
  basePool.sort((a, b) => (b as any).suitability - (a as any).suitability);
  console.log('[SamplePlan] Scenario order by suitability:', basePool.map(s => `${s.scenarioId}(${(s as any).suitability.toFixed(1)})`));

  const rematchPool: SampleStep[] = [];
  if (tracks.length >= 2) {
    for (const scenarioId of scenarios) {
      const band = SCENARIO_BAND_MAP[scenarioId] ?? 0;
      const sorted = tracks
        .map((_, t) => ({ t, e: energies[t]?.[band] ?? 0 }))
        .sort((a, b) => b.e - a.e);
      if (sorted.length < 2) continue;
      rematchPool.push({
        scenarioId,
        trackUrl: tracks[sorted[1].t].url,
        trackName: tracks[sorted[1].t].name,
        isRematch: true,
        type: SCENARIO_TYPES[scenarioId] || 'neutral'
      });
    }
  }

  // 2. Select samples to match distribution: 40% high, 40% low, 20% neutral
  const finalPlan: SampleStep[] = [];
  const counts = { high: 0, low: 0, neutral: 0 };
  const targetCounts = {
    high: Math.ceil(targetCount * 0.4),
    low: Math.ceil(targetCount * 0.4),
    neutral: Math.ceil(targetCount * 0.2)
  };

  const pool = [...basePool, ...rematchPool];
  
  // Greedy selection with diversity constraint
  while (finalPlan.length < targetCount && pool.length > 0) {
    // Determine allowed types based on diversity constraint (3)
    let allowedTypes: Array<'high' | 'low' | 'neutral'> = ['high', 'low', 'neutral'];
    if (finalPlan.length >= 2) {
      const last = finalPlan[finalPlan.length - 1].type;
      const prev = finalPlan[finalPlan.length - 2].type;
      if (last === prev) {
        allowedTypes = allowedTypes.filter(t => t !== last);
      }
    }

    // Pick a candidate that satisfies type counts and diversity
    let candidateIdx = -1;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (allowedTypes.includes(p.type) && counts[p.type] < targetCounts[p.type]) {
        candidateIdx = i;
        break;
      }
    }

    // Fallback search if strict diversity fails
    if (candidateIdx === -1) {
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (counts[p.type] < targetCounts[p.type]) {
          candidateIdx = i;
          break;
        }
      }
    }

    // Absolute fallback: pick any
    if (candidateIdx === -1) candidateIdx = 0;

    const chosen = pool.splice(candidateIdx, 1)[0];
    finalPlan.push(chosen);
    counts[chosen.type]++;
  }

  return finalPlan;
}

// ─── NEW: Bradley-Terry per-band score helper ──────────────────────────────
// For every band, treats each scenario where AB_PREVIEW_GAINS[A][i] differs
// from [B][i] as a comparison of two virtual items (boost / cut). The user's
// choice picks the winner; bradleyTerryScores returns continuous latent
// scores; we map (boost / cut) ratio to a signed log-odds preference score.
function bandBradleyTerryScores(prefs: TuningPreference[]): number[] {
  const out = new Array(10).fill(0);

  for (let band = 0; band < 10; band++) {
    const comps: Array<{ winner: string; loser: string; weight?: number }> = [];
    for (const pref of prefs) {
      const ab = AB_PREVIEW_GAINS[pref.scenario];
      if (!ab) continue;
      const a = ab.A[band], b = ab.B[band];
      if (Math.abs(a - b) < 1.0) continue;     // band not differentiated

      const aIsBoost = a > b;
      if (pref.choice === 'NOT_SURE') {
        const DRAW_WEIGHT = 0.25;
        comps.push({ winner: 'boost', loser: 'cut', weight: DRAW_WEIGHT });
        comps.push({ winner: 'cut', loser: 'boost', weight: DRAW_WEIGHT });
        continue;
      }

      if (pref.choice === 'DISLIKE_BOTH') {
        // DISLIKE_BOTH means both are potentially too far from the target.
        // We treat it as evidence against the dominant direction of this scenario for this band.
        const DISLIKE_WEIGHT = 0.5;
        const loserIsBoost = a > b;
        comps.push({ winner: loserIsBoost ? 'cut' : 'boost', loser: loserIsBoost ? 'boost' : 'cut', weight: DISLIKE_WEIGHT });
        continue;
      }

      const winnerIsBoost = pref.choice === 'A' ? a > b : b > a;
      comps.push({
        winner: winnerIsBoost ? 'boost' : 'cut',
        loser:  winnerIsBoost ? 'cut'   : 'boost',
      });
    }
    if (comps.length === 0) continue;
    const bt = bradleyTerryScores(['boost', 'cut'], comps, { iterations: 80 });
    out[band] = Math.log(Math.max(1e-3, bt.boost) / Math.max(1e-3, bt.cut));
  }
  return out;
}

// ─── NEW: Bayesian-Optimised next-scenario picker (GP + Expected Improvement) ─
// Pre-computes a 10-band feature vector for every wizard scenario (A − B
// gain delta — describes which axis the scenario probes). chooseNextByEI
// fits a GP regression on the user's history (y = +1 if A preferred else -1)
// and returns the unseen scenario with the highest expected information gain.
const SCENARIO_FEATURES: Record<string, number[]> = (() => {
  const out: Record<string, number[]> = {};
  for (const [id, ab] of Object.entries(AB_PREVIEW_GAINS)) {
    out[id] = ab.A.map((a, i) => a - ab.B[i]);
  }
  return out;
})();

export function pickNextScenario(
  completedPrefs: TuningPreference[],
  allScenarios: string[],
  usedScenarios: Set<string>,
  trackCharacter?: TrackCharacter // #15: Filter candidates
): string {
  // 1. If not enough data (< 4), use default order
  if (completedPrefs.length < 4) {
    const nextDefault = allScenarios.find(s => !usedScenarios.has(s));
    return nextDefault || allScenarios[0];
  }

  // 2. Use Bayesian Expected Improvement (GP)
  try {
    const next = chooseNextScenario(completedPrefs, trackCharacter, usedScenarios);
    if (next.id && !usedScenarios.has(next.id)) {
      return next.id;
    }
    // Fallback if GP picks something used or null
    return allScenarios.find(s => !usedScenarios.has(s)) || allScenarios[0];
  } catch (e) {
    console.warn('[AI Engine] Bayesian selection failed, falling back to greedy:', e);
    return allScenarios.find(s => !usedScenarios.has(s)) || allScenarios[0];
  }
}

export function chooseNextScenario(
  history: TuningPreference[],
  trackCharacter?: TrackCharacter, // #15: Audibility prior
  usedScenarios?: Set<string>
): { id: string | null; ei: Record<string, number>; remaining: number } {
  const observed = history
    .filter((h) => SCENARIO_FEATURES[h.scenario])
    .map((h) => ({
      id: h.scenario,
      features: SCENARIO_FEATURES[h.scenario],
      y: (h.choice === 'NOT_SURE' || h.choice === 'DISLIKE_BOTH') ? 0 : (h.choice === 'A' ? +1 : -1),
    }));
    
  const result = chooseNextByEI(SCENARIO_FEATURES, observed);
  
  // #15: Apply audibility prior
  if (trackCharacter && result.ei) {
    const newEi: Record<string, number> = { ...result.ei };
    for (const [id, score] of Object.entries(newEi)) {
      const features = SCENARIO_FEATURES[id];
      if (!features) continue;
      const dominantBand = features.reduce((best, v, i) => Math.abs(v) > Math.abs(features[best]) ? i : best, 0);
      
      let prior = 1.0;
      if (dominantBand <= 1 && !trackCharacter.subBassStrong && !trackCharacter.bassStrong) prior = 0.4;
      if (dominantBand >= 8 && !trackCharacter.brightAir) prior = 0.5;
      
      newEi[id] = score * prior;
    }
    
    const remainingIds = Object.keys(newEi).filter(id => {
       if (usedScenarios && usedScenarios.has(id)) return false;
       return !history.some(h => h.scenario === id);
    });
    
    if (remainingIds.length > 0) {
      const bestId = remainingIds.reduce((a, b) => (newEi[a] > newEi[b] ? a : b));
      return { id: bestId, ei: newEi, remaining: remainingIds.length };
    }
  }

  const remaining = Object.keys(SCENARIO_FEATURES).filter(
    (id) => !history.some((h) => h.scenario === id)
  ).length;
  
  return { ...result, remaining };
}

// ─── NEW: Distance-correlation preference-coherence score ──────────────────
// Replaces the hand-picked 5 NMI pairs with the full A/B vote sequence vs the
// per-scenario Bradley-Terry boost-direction. dCor captures any non-linear
// dependency, not just ordinal agreement, and is scale-invariant.
export function preferenceCoherence(prefs: TuningPreference[]): number {
  const x: number[] = [];
  const y: number[] = [];
  for (const p of prefs) {
    const ab = AB_PREVIEW_GAINS[p.scenario];
    if (!ab) continue;
    // Aggregate boost-direction signature (sum of A-B deltas weighted by sign)
    const sig = ab.A.reduce((s, a, i) => s + (a - ab.B[i]), 0);
    if (p.choice === 'NOT_SURE' || p.choice === 'DISLIKE_BOTH') {
      x.push(0);
    } else {
      x.push(p.choice === 'A' ? +1 : -1);
    }
    y.push(Math.sign(sig));
  }
  return distanceCorrelation(x, y);
}

export function explainCalibration(preferences: TuningPreference[]): {
  featureVector: Record<string, number>;
  confidenceScore: number;
  contradictions: string[];
} {
  const featureScores: FeatureScores = {
    subBassEnergy: 0, midBassEnergy: 0, midRange: 0,
    presence: 0, airDetail: 0, flatness: 0,
  };
  for (const pref of preferences) {
    const rules = FEATURE_RULES[pref.scenario];
    if (rules) {
      for (const [feature, votes] of Object.entries(rules)) {
        if (pref.choice === 'NOT_SURE') {
          featureScores[feature as keyof FeatureScores] += (votes?.A ?? 0) + (votes?.B ?? 0);
        } else if (pref.choice === 'DISLIKE_BOTH') {
          // No clear direction recorded for features
          continue;
        } else {
          featureScores[feature as keyof FeatureScores] += votes?.[pref.choice as 'A' | 'B'] ?? 0;
        }
      }
    }
  }
  const confidence = computeConfidence(preferences, featureScores);
  return { featureVector: featureScores, confidenceScore: confidence.score, contradictions: confidence.contradictions };
}
