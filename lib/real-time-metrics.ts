/**
 * SONIC AI — Phase 7: Real-Time Measurement & Adaptation
 */

export interface RealTimeMetrics {
  spectralCentroid: number;        // Hz
  spectralSpread: number;          // Hz
  spectralSkewness: number;        // -1 to +1 (\u2212=bass heavy, +=bright)
  zerocrossingRate: number;        // 0\u20130.5, indicates noisiness
  tempoProbability: number[];      // [80, 120, 140] BPM confidence
  onsetStrength: number;           // 0\u20131: transient activity
  harmonicContent: number;         // 0\u20131: vs. noise
}

/**
 * 7.1 Spectral Centroid + Zero Crossing Rate Tracking
 */
export function updateMetricsRealtime(
  timeDomain: Float32Array,
  stftMagnitudes: Float32Array,
  sampleRate: number,
  previousMetrics: RealTimeMetrics
): RealTimeMetrics {
  const decay = 0.97;
  
  // 1. Zero Crossing Rate
  let zcr = 0;
  for (let i = 1; i < timeDomain.length; i++) {
    if ((timeDomain[i] > 0 && timeDomain[i - 1] < 0) || 
        (timeDomain[i] < 0 && timeDomain[i - 1] > 0)) {
      zcr++;
    }
  }
  zcr = zcr / timeDomain.length;

  // 2. Spectral Centroid
  let weightedSum = 0;
  let totalPower = 0;
  for (let i = 0; i < stftMagnitudes.length; i++) {
    const f = (i * sampleRate) / (stftMagnitudes.length * 2);
    weightedSum += f * stftMagnitudes[i];
    totalPower += stftMagnitudes[i];
  }
  const centroid = totalPower > 0 ? weightedSum / totalPower : 2000;

  // EMA Update
  return {
    ...previousMetrics,
    spectralCentroid: previousMetrics.spectralCentroid * decay + centroid * (1 - decay),
    zerocrossingRate: previousMetrics.zerocrossingRate * decay + zcr * (1 - decay),
    onsetStrength: Math.random() * 0.5, // Placeholder
  };
}

/**
 * 7.2 Automatic Profile Recommendation Engine
 */
export function recommendProfileAuto(
  metrics: RealTimeMetrics,
  preferences: Array<{ name: string; contextData?: any }>
): {
  profiles: Array<{ name: string; match: number; }>;
  reasoning: string;
  alternativeCount: number;
} {
  const isVocalForward = metrics.spectralCentroid > 2000 && metrics.spectralCentroid < 4000;
  const isBassHeavy = metrics.spectralCentroid < 1000;

  let rankedProfiles = preferences.map(p => ({
    name: p.name,
    match: Math.random() // Placeholder matching
  }));

  rankedProfiles.sort((a, b) => b.match - a.match);

  let reasoning = "Phân tích tự động...";
  if (isVocalForward) {
    reasoning = "Track này có vẻ tập trung vào Vocal (Âm trung-cao). Hệ thống khuyên dùng profile Vocal Forward.";
  } else if (isBassHeavy) {
    reasoning = "Năng lượng tập trung nhiều ở dải Bass, phù hợp với profile Bass Boost / EDM.";
  }

  return {
    profiles: rankedProfiles.slice(0, 3),
    reasoning,
    alternativeCount: preferences.length - 3
  };
}
