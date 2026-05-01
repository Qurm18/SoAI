'use client';

import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, ArrowRight, RotateCcw, Disc3, Repeat, X, Target } from "lucide-react";
import {
  analyzePreferences,
  TuningPreference,
  buildSamplePlan,
  pickNextScenario,
  SampleStep,
  TrackInput,
  BAND_LABELS,
  DeviceProfile,
} from "@/lib/ai-engine";
import { thompsonSampleNextScenario, ContextualPreferenceState } from "@/lib/ai-engine-v2";
import { getActiveDevice } from "@/lib/profile-store";
import { AB_PREVIEW_GAINS, TrackCharacter } from "@/lib/audio-engine";

interface TuningWizardProps {
  learnerState?: ContextualPreferenceState | null;
  onComplete: (result: {
    gains: number[];
    profileName: string;
    insights: string[];
    profile?: import("@/lib/ai-engine").EQProfile;
    taste?: import("@/lib/ai-engine").TasteResult;
    reasons?: import("@/lib/ai-engine").ChoiceReason[];
    scenarioCounts?: Record<string, { A: number; B: number }>;
    scenarioAnalysis?: import("@/lib/ai-engine").ScenarioChoiceAnalysis[];
    confidenceScore: number;
  }) => void;
  onClose: () => void;
  /** Called when user presses A or B preview button. Now includes the trackUrl
      for the active sample so the host can swap audio source if needed. */
  onPreviewAB: (
    scenarioId: string,
    branch: "A" | "B",
    seekTime: number | undefined,
    trackUrl: string,
    customGains?: number[],
  ) => void;
  /** Called when user leaves a step — engine should exit A/B mode */
  onExitAB: () => void;
  onChoice?: (
    choice: "A" | "B" | "DISLIKE_BOTH", 
    interaction: { eqA: number[]; eqB: number[]; listenTime: number; confidence: number }
  ) => { earlyStop?: boolean; reason?: string } | void;
  /** 1-3 calibration tracks chosen by the user. The wizard will build a
      15-20 step sample plan across them. */
  tracks: TrackInput[];
  /** Target test length in samples (15-20). Defaults to 15. */
  targetSamples?: number;
}

const SCENARIOS = [
  {
    id: "bass_depth",
    title: "Round 1: The Foundation",
    description: "Focus on the kick drum punch.",
    soundA: "Thunderous & Deep Bass",
    soundB: "Punchy & Responsive Mid-Bass",
  },
  {
    id: "vocal_clarity",
    title: "Round 2: The Melody",
    description: "Focus on the singer's intimacy.",
    soundA: "Warm & Silky Vocals",
    soundB: "Crisp & Airy Presence",
  },
  {
    id: "sub_bass",
    title: "Round 3: Sub-Atomic",
    description: "Physical pressure and rumble of the lowest octaves.",
    soundA: "Heavy Floor Vibration",
    soundB: "Clean & Controlled Lows",
  },
  {
    id: "instrument_sep",
    title: "Round 4: The Arrangement",
    description: "Focus on guitar and instrument layering.",
    soundA: "Wide Soundstage (Open)",
    soundB: "Tight & Focused (Direct)",
  },
  {
    id: "mid_punch",
    title: "Round 5: Heart of the Drum",
    description: 'The "thump" of snare and low guitar strings.',
    soundA: "Rich & Chest-Hitting",
    soundB: "Lean & Athletic Punch",
  },
  {
    id: "high_frequency",
    title: "Round 6: The Detail",
    description: "Focus on high-end sparkle and air.",
    soundA: "Smooth & Natural Roll-off",
    soundB: "Ultra-HD Brilliant Sparkle",
  },
  {
    id: "presence",
    title: "Round 7: Leading Edge",
    description: '"Bite" of lead instruments and vocal definition.',
    soundA: "Soft & Forgiving",
    soundB: "Defined & Forward",
  },
  {
    id: "warmth_body",
    title: "Round 8: Harmonic Body",
    description: 'Fullness and "thickness" of the overall sound.',
    soundA: "Thick & Soulful",
    soundB: "Transparent & Neutral",
  },
  {
    id: "sibilance",
    title: "Round 9: Sibilance Control",
    description: '"S" and "T" sounds and high-hat sharpness.',
    soundA: "Compressed & Safe",
    soundB: "Extended & Detailed",
  },
  {
    id: "overall_balance",
    title: "Final Round: The Master Mix",
    description: "Full anthem — is it balanced correctly?",
    soundA: "V-Shaped (Fun & Aggressive)",
    soundB: "Flat/Reference (Purest Form)",
  },
] as const;
type ScenarioId = (typeof SCENARIOS)[number]["id"];
const SCENARIO_BY_ID: Record<string, (typeof SCENARIOS)[number]> =
  Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

const ANALYSIS_MESSAGES = [
  "Scanning audio frequency spectrum...",
  "Locating transient peaks...",
  "Mapping harmonic saturation...",
  "Extracting scene metadata...",
  "Finalizing neural calibration...",
];

export const TuningWizard: React.FC<TuningWizardProps> = React.memo(({
  onComplete,
  onClose,
  learnerState,
  onPreviewAB,
  onExitAB,
  onChoice,
  tracks,
  targetSamples = 15,
}) => {
  const [step, setStep] = useState(0);
  const [preferences, setPreferences] = useState<TuningPreference[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activePreview, setActivePreview] = useState<"A" | "B" | null>(null);
  const [analysisStep, setAnalysisStep] = useState(0);
  const [stoppingReason, setStoppingReason] = useState<string | null>(null);
  // Per-track scene segments: { trackUrl: { scenarioId: { time: number; type: string } } }
  const [segmentsByTrack, setSegmentsByTrack] = useState<
    Record<string, Record<string, { time: number; type: string }>>
  >({});
  // Per-track band-energy peaks for sample-plan ranking.
  const [energiesByTrack, setEnergiesByTrack] = useState<
    Record<string, number[]>
  >({});
  const [trackCharacters, setTrackCharacters] = useState<
    Record<string, TrackCharacter>
  >({});
  const [isSceneAnalyzing, setIsSceneAnalyzing] = useState(true);
  const [samplePlan, setSamplePlan] = useState<SampleStep[]>([]);
  // ─── NEW v3.2: blind A/B randomization ───────────────────────────────────
  // For each step, decide once whether to swap which underlying branch is
  // shown as the user-facing "Sample 1 / Sample 2". Defeats the natural
  // bias toward the left-hand option (the wizard always rendered actual
  // gain set A on the left, so users learned to expect it).
  // True  = swap (UI "1" → actual B, UI "2" → actual A)
  // False = no swap (UI "1" → actual A, UI "2" → actual B)
  const [abSwap, setAbSwap] = useState<boolean[]>([]);
  const [modifiedGains, setModifiedGains] = useState<Record<string, { A: number[]; B: number[] }>>({});
  const [isAdjustingEQ, setIsAdjustingEQ] = useState(false);
  const [totalStepListenTime, setTotalStepListenTime] = useState(0);
  const [seekCount, setSeekCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [pauseStartTime, setPauseStartTime] = useState<number | null>(null);
  const [totalPauseDuration, setTotalPauseDuration] = useState(0);

  // New behavior tracking states
  const [timeOnA, setTimeOnA] = useState(0);
  const [timeOnB, setTimeOnB] = useState(0);
  const [switchCount, setSwitchCount] = useState(0);
  const [lastSwitchTime, setLastSwitchTime] = useState<number | null>(null);
  const [quickRejection, setQuickRejection] = useState<'A' | 'B' | null>(null);

  // Track listen time when a preview is active
  useEffect(() => {
    if (!activePreview || isPaused) return;
    const interval = setInterval(() => {
      setTotalStepListenTime(prev => prev + 1);
      if (activePreview === 'A') setTimeOnA(prev => prev + 1);
      else setTimeOnB(prev => prev + 1);
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [activePreview, step, isPaused]);

  // ─── Multi-track scene analysis on mount ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const engine = (window as any).__ENGINE__;
      if (!engine || tracks.length === 0) {
        setIsSceneAnalyzing(false);
        return;
      }

      const segs: Record<string, Record<string, { time: number; type: string }>> = {};
      const eners: Record<string, number[]> = {};
      const chars: Record<string, TrackCharacter> = {};
      const energiesArr: number[][] = [];
      const trackCharsArr: TrackCharacter[] = [];

      // Parallelize analysis for all tracks to fix the "long loading" issue
      const analysisTasks = tracks.map(async (t) => {
        try {
          const [seg, ener, fingerprint] = await Promise.all([
            engine.findCalibrationSegments(t.url),
            engine.bandPeakEnergies(t.url),
            engine.getTrackFingerprintOffline(t.url),
          ]);
          return { url: t.url, name: t.name, seg, ener, fingerprint };
        } catch (e) {
          console.warn("Scene analysis failed for", t.name, e);
          return { 
            url: t.url, 
            name: t.name,
            seg: {}, 
            ener: new Array(10).fill(0), 
            fingerprint: new Array(8).fill(0.5) 
          };
        }
      });

      const results = await Promise.all(analysisTasks);
      
      results.forEach((r, i) => {
        if (i % 5 === 0) setAnalysisStep(Math.min(ANALYSIS_MESSAGES.length - 1, Math.floor(i / (results.length / ANALYSIS_MESSAGES.length))));
        segs[r.url] = r.seg ?? {};
        eners[r.url] = r.ener ?? new Array(10).fill(0);
        energiesArr.push(eners[r.url]);
        
        const char = engine.classifyTrackCharacter(eners[r.url], r.fingerprint || new Array(8).fill(0.5));
        chars[r.url] = char;
        trackCharsArr.push(char);
      });

      if (cancelled) return;

      // Build the sample plan.
      const scaledTarget = Math.max(SCENARIOS.length, Math.min(60, Math.floor(targetSamples * (1 + (tracks.length - 1) * 0.6))));
      
      const plan = buildSamplePlan(
        SCENARIOS.map((s) => s.id),
        tracks,
        energiesArr,
        scaledTarget,
        trackCharsArr
      );
      
      // #13: Adaptive Preset Scaling
      const customGains: Record<string, { A: number[]; B: number[] }> = {};
      plan.forEach(step => {
        const char = chars[step.trackUrl];
        if (!char) return;
        
        let scale = 1.0;
        const dynamicBoost = char.dynamicWide ? 1.25 : 1.0;
        const compressionReduce = !char.dynamicWide && char.genre === 'bass-heavy' ? 0.8 : 1.0;
        const bandMatch = (step.scenarioId === 'sub_bass' || step.scenarioId === 'bass_depth') && !char.bassStrong
          ? 0.6 : 1.0;
        scale = dynamicBoost * compressionReduce * bandMatch;

        const base = AB_PREVIEW_GAINS[step.scenarioId];
        if (base) {
          customGains[step.scenarioId] = {
            A: base.A.map(g => g * scale),
            B: base.B.map(g => g * scale),
          };
        }
      });
      setModifiedGains(customGains);

      const baseSteps = plan.filter((s) => !s.isRematch);
      const rematchSteps = plan.filter((s) => s.isRematch);
      for (let i = baseSteps.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [baseSteps[i], baseSteps[j]] = [baseSteps[j], baseSteps[i]];
      }
      const shuffledPlan = [...baseSteps, ...rematchSteps];
      // Per-step random A↔B label flip (50/50 coin per step).
      const swap = shuffledPlan.map(() => Math.random() < 0.5);
      setSegmentsByTrack(segs);
      setEnergiesByTrack(eners);
      setTrackCharacters(chars);
      setSamplePlan(shuffledPlan);
      setAbSwap(swap);

      // Final loading flicker.
      for (let i = 0; i < ANALYSIS_MESSAGES.length; i++) {
        if (cancelled) return;
        setAnalysisStep(i);
        await new Promise((r) => setTimeout(r, 280));
      }
      setIsSceneAnalyzing(false);
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Current sample (or fall back to legacy single-track flow).
  const currentSample: SampleStep | null = useMemo(() => {
    if (samplePlan.length === 0) return null;
    return samplePlan[Math.min(step, samplePlan.length - 1)];
  }, [samplePlan, step]);

  const currentScenario = currentSample
    ? SCENARIO_BY_ID[currentSample.scenarioId]
    : SCENARIOS[step % SCENARIOS.length];

  // ─── NEW v3.2: decode UI label → underlying branch via per-step swap ────
  // The wizard shows "Sample 1" / "Sample 2" to the user but the underlying
  // gain-set is still 'A' or 'B'. abSwap[step] flips the mapping so the
  // user can never learn which side will be the bassier / brighter one.
  const decodeBranch = React.useCallback((uiSide: "A" | "B"): "A" | "B" => {
    const swap = abSwap[step] ?? false;
    if (!swap) return uiSide;
    return uiSide === "A" ? "B" : "A";
  }, [abSwap, step]);

  // ─── Perceptual Difference Jitter ─────────────────────────────────────
  // Ensure Sample 1 and 2 differ enough for the user to hear.
  useEffect(() => {
    if (!currentSample) return;
    const sid = currentSample.scenarioId;
    if (modifiedGains[sid]) return;
    
    const base = AB_PREVIEW_GAINS[sid];
    if (!base) return;

    const diff = base.A.reduce((sum, val, i) => sum + Math.abs(val - base.B[i]), 0);
    if (diff < 6.0) {
      const jittered = JSON.parse(JSON.stringify(base));
      const sensitiveBands = [0, 1, 2, 4, 5, 6, 7];
      const bandIdx = sensitiveBands[Math.floor(Math.random() * sensitiveBands.length)];
      const dir = Math.random() < 0.5 ? -1 : 1;
      jittered.A[bandIdx] = Math.max(-15, Math.min(15, jittered.A[bandIdx] + dir * 1.5));
      jittered.B[bandIdx] = Math.max(-15, Math.min(15, jittered.B[bandIdx] - dir * 1.5));
      
      setTimeout(() => {
        setModifiedGains(prev => {
          if (prev[sid]) return prev;
          return { ...prev, [sid]: jittered };
        });
      }, 0);
    }
  }, [currentSample, modifiedGains]);

  // ─── Preview Sample 1 or Sample 2 via real crossfade ───────────────────
  const togglePreview = React.useCallback((uiSide: "A" | "B") => {
    if (activePreview === uiSide) {
      const now = Date.now();
      // If already active, toggle play/pause
      if (isPaused) {
        setIsPaused(false);
        if (pauseStartTime) setTotalPauseDuration(prev => prev + (now - pauseStartTime));
      } else {
        setIsPaused(true);
        setPauseStartTime(now);
      }
      return;
    }
    
    if (!currentSample) return;

    // Switch tracking
    const now = Date.now();
    if (activePreview !== null && activePreview !== uiSide) {
      setSwitchCount(prev => prev + 1);
      if (lastSwitchTime !== null) {
        const timeSinceSwitch = now - lastSwitchTime;
        // If switched back and forth rapidly (e.g., < 2.5 seconds), treat as quick rejection of the previous one
        if (timeSinceSwitch < 2500) {
          setQuickRejection(decodeBranch(activePreview)); // Store the underlying branch that was rejected
        }
      }
    }
    setLastSwitchTime(now);

    setActivePreview(uiSide);
    setIsPaused(false);
    setSeekCount(prev => prev + 1); // Switching branches is like seeking

    const actual = decodeBranch(uiSide);
    const segment =
      segmentsByTrack[currentSample.trackUrl]?.[currentSample.scenarioId];
    const seekTime = segment?.time;
    
    const scenarioGains = modifiedGains[currentSample.scenarioId] || AB_PREVIEW_GAINS[currentSample.scenarioId];
    
    onPreviewAB(
      currentSample.scenarioId,
      actual,
      seekTime,
      currentSample.trackUrl,
      scenarioGains?.[actual]
    );
  }, [activePreview, isPaused, pauseStartTime, currentSample, modifiedGains, onPreviewAB, segmentsByTrack, decodeBranch, lastSwitchTime]);

  const replayCurrentBranch = () => {
    if (!activePreview || !currentSample) return;
    setSeekCount(prev => prev + 1);
    setIsPaused(false);
    
    const actual = decodeBranch(activePreview);
    const segment =
      segmentsByTrack[currentSample.trackUrl]?.[currentSample.scenarioId];
    const seekTime = segment?.time;
    const scenarioGains = modifiedGains[currentSample.scenarioId] || AB_PREVIEW_GAINS[currentSample.scenarioId];

    onPreviewAB(
      currentSample.scenarioId,
      actual,
      seekTime,
      currentSample.trackUrl,
      scenarioGains?.[actual]
    );
  };

  // ─── Commit choice, advance step ────────────────────────────────────────
  const handleChoice = (uiSide: "A" | "B" | "NOT_SURE" | "DISLIKE_BOTH") => {
    onExitAB();
    setActivePreview(null);
    setIsAdjustingEQ(false);
    setIsPaused(false);

    // Record the UNDERLYING branch (decoded from the swap), not the UI label.
    const choice = (uiSide === "NOT_SURE" || uiSide === "DISLIKE_BOTH") 
      ? uiSide 
      : (decodeBranch(uiSide as "A" | "B") as "A" | "B");
    
    const scenarioId =
      currentSample?.scenarioId ?? SCENARIOS[step % SCENARIOS.length].id;

    // Determine close contender if high hesitation (many switches)
    let closeContenderId: 'A' | 'B' | undefined = undefined;
    if (switchCount >= 4 && (choice === 'A' || choice === 'B')) {
       closeContenderId = choice === 'A' ? 'B' : 'A';
    }

    const prefObj: TuningPreference = { 
      choice, 
      scenario: scenarioId,
      behavior: {
        switchCount,
        timeOnA,
        timeOnB,
        quickRejectionFlag: quickRejection ?? undefined,
        hesitationLevel: switchCount,
        closeContender: closeContenderId
      }
    };

    const newPrefs = [...preferences, prefObj];

    // Reset behavior tracking stats
    setTotalStepListenTime(0);
    setTimeOnA(0);
    setTimeOnB(0);
    setSwitchCount(0);
    setLastSwitchTime(null);
    setQuickRejection(null);
    setSeekCount(0);
    setTotalPauseDuration(0);

    if (choice !== "NOT_SURE" && onChoice) {
      const g = modifiedGains[scenarioId] || AB_PREVIEW_GAINS[scenarioId];
      if (g) {
        // Tầng 2: Calculate implicit confidence
        // Expect ~15-20s per step.
        const completionRatio = Math.min(1.0, totalStepListenTime / 15);
        const pausePenalty = Math.min(0.5, totalPauseDuration / 60000); // Max 0.5 penalty for 1m pause
        const implicitConfidence = completionRatio * (1 + 0.3 * Math.min(5, seekCount)) * (1 - pausePenalty);

        const stopResult = onChoice(choice as any, { 
          eqA: g.A, 
          eqB: g.B, 
          listenTime: totalStepListenTime,
          confidence: implicitConfidence
        } as any);

        if (stopResult && typeof stopResult === 'object' && stopResult.earlyStop) {
          // Note: Early stop is now disabled in core, but we keep the structure 
          // to allow future user-triggered "I'm done" signals.
          processResult(newPrefs);
          return;
        }
      }
    }

    setTotalStepListenTime(0); // Reset for next step
    setSeekCount(0);
    setTotalPauseDuration(0);
    setPauseStartTime(null);

    if (step < samplePlan.length - 1) {
      setPreferences(newPrefs);
      
      // #5: Adaptive Next Scenario Picker (AI-assisted)
      // We look at the remaining plan and swap the next step with a more important scenario if AI suggests one.
      const remainingPlan = samplePlan.slice(step + 1);
      const allScenarios = SCENARIOS.map(s => s.id);
      const usedScenarios = new Set(newPrefs.map(p => p.scenario));
      
      try {
        const char = currentSample ? trackCharacters[currentSample.trackUrl] : undefined;
        
        let nextScenarioId: string;
        if (learnerState) {
          const avail: Record<string, { A: number[]; B: number[] }> = {};
          SCENARIOS.forEach(s => {
            if (!usedScenarios.has(s.id) && AB_PREVIEW_GAINS[s.id as keyof typeof AB_PREVIEW_GAINS]) {
              avail[s.id] = AB_PREVIEW_GAINS[s.id as keyof typeof AB_PREVIEW_GAINS];
            }
          });
          
          if (Object.keys(avail).length > 0) {
            const h = newPrefs.map(p => ({
              choice: p.choice === 'A' || p.choice === 'B' || p.choice === 'NOT_SURE' ? p.choice as any : 'NOT_SURE',
              scenario: p.scenario
            }));
            const sampled = thompsonSampleNextScenario(
              learnerState, 
              h as any, 
              avail, 
              { exploration: 0.5, significance: 0.95 }
            );
            nextScenarioId = sampled.scenario;
          } else {
            nextScenarioId = '';
          }
        } else {
          nextScenarioId = pickNextScenario(newPrefs, allScenarios, usedScenarios, char);
        }
        
        if (nextScenarioId && nextScenarioId !== samplePlan[step + 1].scenarioId) {
          // Find if this scenario exists in the remaining plan
          const swapIdx = remainingPlan.findIndex(s => s.scenarioId === nextScenarioId);
          if (swapIdx !== -1) {
            const newPlan = [...samplePlan];
            const nextIdx = step + 1;
            const targetIdx = nextIdx + swapIdx;
            
            // Swap
            [newPlan[nextIdx], newPlan[targetIdx]] = [newPlan[targetIdx], newPlan[nextIdx]];
            
            console.log(`[TuningWizard] Adapting plan: Next scenario swapped from ${samplePlan[nextIdx].scenarioId} to ${nextScenarioId}`);
            setSamplePlan(newPlan);
          }
        }
      } catch (e) {
        console.error('[TuningWizard] Adaptive selection error:', e);
      }

      setStep(step + 1);
    } else {
      processResult(newPrefs);
    }
  };

  const [isMutating, setIsMutating] = useState(false);

  const mutateScenarioGains = (scenarioId: string) => {
    setIsMutating(true);
    const base = modifiedGains[scenarioId] || JSON.parse(JSON.stringify(AB_PREVIEW_GAINS[scenarioId]));
    
    // Define which bands to jitter based on scenario
    const focusBands: Record<string, number[]> = {
      bass_depth: [0, 1, 2],
      vocal_clarity: [3, 4, 5],
      sub_bass: [0, 1],
      instrument_sep: [4, 5, 6, 7],
      mid_punch: [2, 3, 4],
      high_frequency: [7, 8, 9],
      presence: [5, 6, 7],
      warmth_body: [2, 3, 4, 5],
      sibilance: [7, 8],
      overall_balance: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    };

    const bandsToJitter = focusBands[scenarioId] || [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    
    const jitter = (current: number[]) => {
      return current.map((g, i) => {
        if (bandsToJitter.includes(i)) {
          // If the user "don't like", we try to push a bit harder in a different direction
          const dir = Math.random() < 0.5 ? -1 : 1;
          const shift = dir * (2 + Math.random() * 3); // 2-5dB jitter
          return Math.max(-15, Math.min(15, g + shift));
        }
        return g;
      });
    };

    const nextGains = {
      A: jitter(base.A),
      B: jitter(base.B)
    };

    setModifiedGains(prev => ({
      ...prev,
      [scenarioId]: nextGains
    }));

    // If we have an active preview, refresh it with new gains
    if (activePreview && currentSample) {
      const actual = decodeBranch(activePreview);
      onPreviewAB(
        scenarioId,
        actual,
        undefined, // don't seek again
        currentSample.trackUrl,
        nextGains[actual]
      );
    }
    
    setTimeout(() => setIsMutating(false), 800);
  };

  const handleNone = () => {
    if (!currentSample) return;
    
    // User explicitly dislikes both directions.
    // We record this as a strong signal (DISLIKE_BOTH) and advance.
    handleChoice("DISLIKE_BOTH");
  };

  const updateBandGain = (bandIdx: number, delta: number) => {
    if (!currentSample || !activePreview) return;
    const actual = decodeBranch(activePreview);
    const scenarioId = currentSample.scenarioId;
    
    setModifiedGains(prev => {
      const current = prev[scenarioId] || JSON.parse(JSON.stringify(AB_PREVIEW_GAINS[scenarioId]));
      const newGains = [...current[actual]];
      newGains[bandIdx] = Math.max(-15, Math.min(15, newGains[bandIdx] + delta));
      
      const updated = {
        ...prev,
        [scenarioId]: {
          ...current,
          [actual]: newGains
        }
      };

      // Push update to engine immediately
      onPreviewAB(
        scenarioId,
        actual,
        undefined, // don't seek again
        currentSample.trackUrl,
        newGains
      );

      return updated;
    });
  };

  const handleBack = () => {
    if (step === 0) return;
    onExitAB();
    setActivePreview(null);
    setPreferences(preferences.slice(0, -1));
    setStep(step - 1);
  };

  const processResult = async (finalPrefs: TuningPreference[]) => {
    setIsAnalyzing(true);
    setAnalysisStep(0);
    for (let i = 0; i < ANALYSIS_MESSAGES.length; i++) {
      setAnalysisStep(i);
      await new Promise((r) => setTimeout(r, 600));
    }

    // Compute average band energies from all tracks used in calibration
    const trackUrls = Object.keys(energiesByTrack);
    const avgEnergies = new Array(10).fill(0);
    if (trackUrls.length > 0) {
      for (let i = 0; i < 10; i++) {
        let sum = 0;
        for (const url of trackUrls) {
          sum += energiesByTrack[url][i];
        }
        avgEnergies[i] = sum / trackUrls.length;
      }
    }

    const activeDevice = getActiveDevice();
    const char = currentSample ? trackCharacters[currentSample.trackUrl] : undefined;
    const result = await analyzePreferences(finalPrefs, 0.5, avgEnergies, activeDevice, char);
    onComplete(result);
    setIsAnalyzing(false);
  };

  const totalSteps = samplePlan.length || SCENARIOS.length;
  const progress = (step / totalSteps) * 100;
  const trackCount = tracks.length;
  const activeDevice = getActiveDevice();

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4">
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-[#151619] border border-white/10 rounded-3xl w-full max-w-xl max-h-[95vh] overflow-y-auto shadow-[0_30px_60px_rgba(0,0,0,0.5)] custom-scrollbar"
      >
        {/* Progress bar */}
        <div className="sticky top-0 z-50 h-0.5 bg-white/5">
          <motion.div
            className="h-full bg-gradient-to-r from-[#F27D26] to-[#FF4444]"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>

        <div className="p-4 sm:p-6 md:p-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-[#F27D26] to-[#FF4444] flex items-center justify-center shadow-lg shadow-[#F27D26]/20">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                >
                  <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                </motion.div>
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg md:text-xl font-bold tracking-tight text-white uppercase truncate">
                  Neural Calibration
                </h2>
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5 sm:mt-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#F27D26] animate-pulse" />
                  <span className="text-[8px] sm:text-[10px] font-mono text-[#8E9299] uppercase tracking-widest whitespace-nowrap">
                    A.I. Engine v4.0 · {trackCount} track{trackCount === 1 ? "" : "s"}
                  </span>
                  {activeDevice && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded text-[7px] text-blue-400 font-bold uppercase tracking-widest"
                    >
                      <Target className="w-2 h-2" />
                      {activeDevice.name} Comp active
                    </motion.div>
                  )}
                </div>
              </div>
            </div>
            <div className="text-right flex-shrink-0 ml-2">
              <span className="block text-[8px] sm:text-[10px] font-mono text-[#8E9299] uppercase tracking-widest leading-none mb-0.5 sm:mb-1">
                Sample
              </span>
              <div className="text-lg sm:text-xl font-black text-white">
                {Math.min(step + 1, totalSteps)}
                <span className="text-[#8E9299] text-xs sm:text-sm">/{totalSteps}</span>
              </div>
            </div>
          </div>

          {/* Track strip */}
          {!isSceneAnalyzing && currentSample && (
            <div className="mb-4 md:mb-6 px-2.5 py-1.5 bg-black/40 border border-white/5 rounded-xl flex items-center gap-2 overflow-hidden">
              <Disc3 className="w-3 h-3 text-[#F27D26] flex-shrink-0" />
              <span className="text-[9px] font-mono text-[#8E9299] uppercase tracking-widest flex-shrink-0 hidden xs:inline">
                Now testing on:
              </span>
              <span className="text-[10px] md:text-[11px] font-bold text-white truncate flex-1">
                {currentSample.trackName}
              </span>
              {currentSample.isRematch && (
                <span className="flex items-center gap-1 px-1 py-0.5 bg-[#F27D26]/15 text-[#F27D26] rounded text-[7px] font-mono uppercase tracking-widest flex-shrink-0">
                  <Repeat className="w-2 h-2" /> Rematch
                </span>
              )}
            </div>
          )}

          <AnimatePresence mode="wait">
            {/* Scene loading */}
            {isSceneAnalyzing ? (
              <motion.div
                key="scene-loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-20 gap-8"
              >
                <div className="flex gap-1 items-end h-12">
                  {[...Array(8)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ height: [10, 40, 20, 35, 15] }}
                      transition={{
                        duration: 1.5,
                        repeat: Infinity,
                        delay: i * 0.1,
                      }}
                      className="w-1.5 bg-[#F27D26] rounded-full"
                    />
                  ))}
                </div>
                <div className="text-center space-y-2">
                  <p className="text-white font-bold uppercase tracking-widest">
                    {ANALYSIS_MESSAGES[analysisStep]}
                  </p>
                  <p className="text-[#8E9299] text-[10px] font-mono lowercase">
                    Analyzing {tracks.length} track
                    {tracks.length === 1 ? "" : "s"} for optimal test
                    segments...
                  </p>
                </div>
              </motion.div>
            ) : isAnalyzing ? (
              <motion.div
                key="analyzing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-20 gap-6"
              >
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-[#F27D26]/20 rounded-full" />
                  <div className="absolute inset-0 w-16 h-16 border-4 border-[#F27D26] border-t-transparent rounded-full animate-spin" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-white font-bold uppercase tracking-widest">
                    {ANALYSIS_MESSAGES[analysisStep]}
                  </p>
                  <p className="text-[#8E9299] text-xs font-mono lowercase">
                    Step {analysisStep + 1} of {ANALYSIS_MESSAGES.length} — Aggregating {preferences.length} preferences
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={`step-${step}`}
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -20, opacity: 0 }}
                className="space-y-6"
              >
                {/* Step title */}
                <div className="text-center space-y-2">
                  <h3 className="text-white text-2xl font-black italic uppercase tracking-tighter">
                    {currentScenario.title}
                  </h3>
                  <p className="text-[#8E9299] text-sm font-medium leading-relaxed max-w-sm mx-auto">
                    {currentScenario.description}
                  </p>
                </div>

                {/* Blind A/B buttons (labels randomized per step) */}
                <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <AnimatePresence>
                    {isMutating && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.05 }}
                        className="absolute inset-x-0 -top-4 z-50 flex justify-center pointer-events-none"
                      >
                        <div className="px-4 py-1.5 bg-[#F27D26] text-black text-[10px] font-black uppercase tracking-widest rounded-full shadow-lg shadow-[#F27D26]/40 flex items-center gap-2">
                          <RotateCcw className="w-3 h-3 animate-spin" />
                          Regenerating EQ...
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {(["A", "B"] as const).map((uiSide) => {
                    const isActive = activePreview === uiSide;
                    // Show neutral "Sample 1 / Sample 2" labels so the descriptions
                    // (soundA / soundB) cannot give away which underlying branch
                    // is being previewed. The actual gain set is decoded via abSwap
                    // before being forwarded to the audio engine.
                    const sampleNumber = uiSide === "A" ? "1" : "2";
                    const activeStyle =
                      uiSide === "A"
                        ? "bg-[#F27D26]/20 border-[#F27D26] shadow-[0_15px_30px_rgba(242,125,38,0.2)]"
                        : "bg-white/10 border-white shadow-[0_15px_30px_rgba(255,255,255,0.1)]";
                    const labelColor =
                      uiSide === "A"
                        ? isActive
                          ? "text-[#F27D26]"
                          : "text-[#8E9299]"
                        : isActive
                          ? "text-white"
                          : "text-[#8E9299]";

                    return (
                      <div key={uiSide} className="space-y-3">
                        {/* Listen button */}
                        <button
                          onClick={() => togglePreview(uiSide)}
                          className={`relative w-full h-24 rounded-3xl border-2 transition-all overflow-hidden flex items-center justify-center ${
                            isActive
                              ? activeStyle
                              : "bg-[#1a1c20] border-white/5 hover:border-white/20"
                          }`}
                        >
                          <div className="text-center relative z-10">
                            <span
                              className={`block text-[10px] font-mono uppercase tracking-widest mb-1.5 transition-colors ${labelColor}`}
                            >
                              Blind Sample
                            </span>
                            <span className="text-2xl font-black text-white italic">
                              #{sampleNumber}
                            </span>
                          </div>
                          {isActive && (
                            <motion.div
                              layoutId="ab-glow"
                              className={`absolute inset-0 ${uiSide === "A" ? "bg-gradient-to-tr from-[#F27D26]/20" : "bg-gradient-to-tr from-white/10"} to-transparent`}
                            />
                          )}
                          {isActive && (
                            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-0.5">
                              {[...Array(4)].map((_, i) => (
                                <motion.div
                                  key={i}
                                  animate={{ scaleY: [1, 2, 1] }}
                                  transition={{
                                    duration: 0.6,
                                    repeat: Infinity,
                                    delay: i * 0.15,
                                  }}
                                  className={`w-0.5 h-2 rounded-full ${uiSide === "A" ? "bg-[#F27D26]" : "bg-white"}`}
                                />
                              ))}
                            </div>
                          )}
                        </button>

                        {/* Commit button */}
                        <button
                          onClick={() => handleChoice(uiSide)}
                          disabled={!activePreview}
                          className={`w-full py-3 rounded-2xl font-black uppercase text-xs tracking-[0.2em] transition-all ${
                            !activePreview
                              ? "opacity-25 cursor-not-allowed bg-white/5 text-white"
                              : uiSide === "A"
                                ? "bg-[#F27D26] text-black hover:scale-[1.02] active:scale-95 shadow-lg shadow-[#F27D26]/20"
                                : "bg-white text-black hover:scale-[1.02] active:scale-95 shadow-lg shadow-white/10"
                          }`}
                        >
                          Pick #{sampleNumber}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Optional logic buttons (None / Not Sure) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={handleNone}
                    className="py-3 rounded-2xl bg-white/5 border border-white/5 hover:border-red-500/20 text-[#8E9299] hover:text-red-400 text-[10px] uppercase font-mono tracking-widest transition-all flex items-center justify-center gap-2"
                  >
                    <X className="w-3 h-3" />
                    I don&apos;t like either
                  </button>
                  <button
                    onClick={() => handleChoice("NOT_SURE")}
                    disabled={!activePreview}
                    className="py-3 rounded-2xl bg-white/5 border border-white/5 hover:border-white/20 text-[#8E9299] hover:text-white text-[10px] uppercase font-mono tracking-widest transition-all"
                  >
                    Skip / Not Sure
                  </button>
                </div>

                {/* EQ Adjustment Panel */}
                {isAdjustingEQ && activePreview && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    className="p-4 bg-black/40 border border-[#F27D26]/30 rounded-2xl space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-[#F27D26] uppercase tracking-widest">
                        Fine-tuning {activePreview === "A" ? "Sample 1" : "Sample 2"}
                      </span>
                      <button 
                        onClick={() => setIsAdjustingEQ(false)}
                        className="text-[9px] font-mono text-[#8E9299] hover:text-white uppercase"
                      >
                        Close
                      </button>
                    </div>
                    <div className="grid grid-cols-10 gap-1 h-32">
                      {Array.from({ length: 10 }).map((_, i) => {
                        const actual = decodeBranch(activePreview);
                        const scenId = currentSample?.scenarioId;
                        const gains = (scenId && modifiedGains[scenId]) ? modifiedGains[scenId][actual] : (scenId ? AB_PREVIEW_GAINS[scenId][actual] : new Array(10).fill(0));
                        const val = gains[i];
                        
                        return (
                          <div key={i} className="flex flex-col items-center gap-1 group/band">
                            <div className="flex-1 w-full bg-white/5 rounded-full relative overflow-hidden flex flex-col justify-end">
                              <div 
                                className="w-full bg-[#F27D26]/40 transition-all" 
                                style={{ height: `${((val + 15) / 30) * 100}%` }}
                              />
                            </div>
                            <div className="flex flex-col gap-0.5 mt-1">
                              <button 
                                onClick={() => updateBandGain(i, 1.5)}
                                className="w-full h-4 bg-white/5 hover:bg-white/10 rounded flex items-center justify-center text-[8px] text-white"
                              >
                                +
                              </button>
                              <button 
                                onClick={() => updateBandGain(i, -1.5)}
                                className="w-full h-4 bg-white/5 hover:bg-white/10 rounded flex items-center justify-center text-[8px] text-white"
                              >
                                -
                              </button>
                            </div>
                            <span className="text-[7px] font-mono text-[#8E9299] truncate w-full text-center">
                              {BAND_LABELS[i].replace("Hz", "").replace("kHz", "k")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[9px] font-mono text-[#8E9299]/60 italic text-center">
                      Adjusting current version live. Pick when satisfied.
                    </p>
                  </motion.div>
                )}

                {/* Controls row */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex gap-2">
                    <button
                      onClick={handleBack}
                      disabled={step === 0}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-20 rounded-lg text-[10px] font-mono text-white transition-all"
                    >
                      ← Back
                    </button>
                    {activePreview && (
                      <button
                        onClick={replayCurrentBranch}
                        className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-mono text-white transition-all flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" /> Replay
                      </button>
                    )}
                  </div>

                  {/* Step dots — show ≤ 20 cleanly */}
                  <div className="flex gap-1 max-w-[150px] sm:max-w-[200px] flex-wrap justify-center overflow-hidden h-6 items-center">
                    {Array.from({ length: totalSteps }).map((_, i) => {
                      const isRem = samplePlan[i]?.isRematch;
                      return (
                        <div
                          key={i}
                          className={`h-0.5 sm:h-1 rounded-full transition-all duration-300 ${
                            i < step
                              ? isRem
                                ? "w-2 sm:w-3 bg-[#F27D26]/60"
                                : "w-2 sm:w-3 bg-[#F27D26]"
                              : i === step
                                ? "w-4 sm:w-6 bg-white"
                                : isRem
                                  ? "w-2 sm:w-3 bg-white/5"
                                  : "w-2 sm:w-3 bg-white/10"
                          }`}
                          title={isRem ? "Rematch trial" : "Base trial"}
                        />
                      );
                    })}
                  </div>

                  <button
                    onClick={onClose}
                    className="group flex items-center gap-1.5 text-[#8E9299] text-[10px] uppercase font-bold tracking-widest hover:text-white transition-colors"
                  >
                    Abort{" "}
                    <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>

                {/* Hint */}
                <div className="px-4 py-2.5 bg-black/40 rounded-xl border border-white/5 text-center">
                  <p className="text-[10px] font-mono text-[#8E9299] uppercase tracking-widest">
                    Listen carefully · Switch{" "}
                    <span className="text-white">A ↔ B</span> in real-time ·
                    Then commit
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
});

TuningWizard.displayName = 'TuningWizard';
