export interface HearingProfile {
  age: number;
  hearingLossDb: number[];  // 10 audiometric frequencies, dB HL
  tinnitus: boolean;
  frequencyOfMaxSensitivity: number; // Hz where user is most sensitive
}

/**
 * ISO 226:2003 Equal Loudness Contours (Approximation)
 * Returns the required SPL (dB) at a given frequency to sound as loud as a 1kHz tone at 'targetLufs' (phon).
 * Simplified representation for DSP weighting.
 */
function iso226Approximation(frequency: number, targetPhon: number): number {
  const f = frequency / 1000; // normalized to 1kHz
  
  // Very simplified approximation of ISO 226 curves
  // To make lower and very high frequencies sound equally loud at lower volumes, 
  // they need more energy (boost).
  
  // Base threshold of hearing (approx)
  const threshold = 3.64 * Math.pow(f, -0.8) - 6.5 * Math.exp(-0.6 * Math.pow(f - 3.3, 2)) + Math.pow(10, -3) * Math.pow(f, 4);
  
  // Compression factor based on volume (phon)
  // Higher volume = flatter curve
  const volumeFactor = Math.max(0, (100 - targetPhon) / 100);
  
  return targetPhon + threshold * volumeFactor;
}

export function adaptiveEqualloudnessWeights(
  frequencies: number[],
  targetLufs: number,        // current loudness (approx phon)
  hearingProfile: HearingProfile,
  listeningDuration: number  // seconds — fatigue factor
): number[] {
  // 1. Target ISO 226 offset (we want to normalize around 1kHz)
  const ref1kHz = iso226Approximation(1000, targetLufs);
  
  return frequencies.map((freq, i) => {
    // Basic ISO 226 EQ curve to flattened perception
    const isoRequiredSPL = iso226Approximation(freq, targetLufs);
    let weight = isoRequiredSPL - ref1kHz;
    
    // 2. Personalized hearing loss correction (inverse of audiometric curve)
    // If user has 20dB loss at 4kHz, we might add 10-15dB back (not full 20 to avoid distortion)
    const hlCorrection = (hearingProfile.hearingLossDb[i] || 0) * 0.6;
    weight += hlCorrection;

    // 3. Fatigue penalty: dB reduction over time (after 1hr, reduce aggressive boosts)
    // More fatigue = less tolerance for high frequencies
    if (listeningDuration > 3600 && freq > 2000) {
      const hours = listeningDuration / 3600;
      weight -= Math.min(6, (hours - 1) * 2 * Math.log2(freq / 2000));
    }

    // 4. Tinnitus notch: if present, reduce gain around 5–10 kHz
    if (hearingProfile.tinnitus && freq >= 4000 && freq <= 8000) {
      weight -= 3.0; // Gentle notch to avoid triggering tinnitus ring
    }

    return weight;
  });
}

export function earDamageRisk(
  eqGains: number[],
  frequencies: number[],
  listeningLevel: 'soft' | 'moderate' | 'loud' | 'extreme',
  sessionDuration: number  // seconds
): { riskScore: number; warning: string | null } {
  // Estimate baseline SPL
  let baseSpl = 60;
  switch (listeningLevel) {
    case 'soft': baseSpl = 50; break;
    case 'moderate': baseSpl = 70; break;
    case 'loud': baseSpl = 85; break;
    case 'extreme': baseSpl = 100; break;
  }

  // Calculate peak SPL considering EQ boosts
  // ISO 3386 headphone coupler response - high frequencies are more damaging
  let maxSpl = baseSpl;
  for (let i = 0; i < frequencies.length; i++) {
    const freqWeight = frequencies[i] > 2000 && frequencies[i] < 6000 ? 5 : 0; // ear canal resonance
    const bandSpl = baseSpl + eqGains[i] + freqWeight;
    if (bandSpl > maxSpl) maxSpl = bandSpl;
  }

  // NIOSH standard: 85 dBA for 8 hours. 3dB exchange rate (88 dBA for 4 hours, etc.)
  // Dose %
  const allowedHours = 8 / Math.pow(2, (maxSpl - 85) / 3);
  const dose = (sessionDuration / 3600) / allowedHours;
  
  let riskScore = Math.min(100, Math.max(0, dose * 100));
  let warning = null;

  if (maxSpl >= 110) {
    warning = "Cảnh báo: Âm lượng tối đa đạt mức nguy hiểm. Hư hại thính giác có thể xảy ra ngay lập tức.";
    riskScore = 100;
  } else if (dose > 1.0) {
    warning = `Cảnh báo: Bạn đã vượt quá liều lượng âm thanh an toàn (${Math.round(dose*100)}%). Hãy nghỉ ngơi.`;
  } else if (dose > 0.8) {
    warning = "Lưu ý: Sắp đạt ngưỡng âm thanh an toàn tối đa trong ngày.";
  }

  return { riskScore, warning };
}
