import { useState, useRef, useEffect, useCallback } from 'react';
import { EQBand } from '@/lib/audio-engine';
import { loadLearnerState, persistLearnerState } from '@/lib/profile-store';
import { AudioEngine } from '@/lib/audio-engine';
import { ContextualBayesianLearner, ContextualPreferenceState, deserializeContextualState, serializeContextualState } from '@/lib/ai-engine-v2';

export function useAdaptiveEQ(
  hookEngineRef: React.MutableRefObject<AudioEngine | null>,
  isPlaying: boolean,
  preAmp: number,
  hookApplyBandsToEngine: (bands: EQBand[], preAmp: number) => void
) {
  const leanerRef = useRef<ContextualBayesianLearner | null>(null);
  const [learnerState, setLearnerState] = useState<ContextualPreferenceState | null>(null);

  const [isAdaptiveMode, setIsAdaptiveMode] = useState(true);
  const [sectionType, setSectionType] = useState<'intro' | 'verse' | 'chorus' | 'drop' | 'outro'>('verse');

  useEffect(() => {
    let initialState: ContextualPreferenceState | null = null;
    const saved = localStorage.getItem('sonic_contextual_prefs');
    if (saved) {
      try {
        initialState = deserializeContextualState(saved);
      } catch (e) {
        console.warn('Failed to load learner state:', e);
      }
    }

    if (initialState) {
      leanerRef.current = new ContextualBayesianLearner(initialState);
      setLearnerState(initialState); // eslint-disable-line react-hooks/set-state-in-effect
    } else {
      leanerRef.current = new ContextualBayesianLearner();
      setLearnerState(leanerRef.current.getState()); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, []);

  const handleInteraction = useCallback((choice: 'A' | 'B' | 'DISLIKE_BOTH' | 'NO_PREFERENCE', interaction: { 
    eqA: number[], 
    eqB: number[], 
    listenTime: number, 
    confidence?: number 
  }) => {
    if (!hookEngineRef.current || !leanerRef.current) return;

    const fingerprint = hookEngineRef.current.getTrackFingerprint();
    const energies = hookEngineRef.current.getAdaptiveFeatures();
    if (!energies) return;

    // Convert fingerprint to context
    const char = hookEngineRef.current.classifyTrackCharacter(
      [energies.lowEnergy, energies.midEnergy, energies.highEnergy], 
      fingerprint
    );

    const context = {
      genre: char.genre as any,
      tempoCategory: 'moderate' as any,
      complexity: char.dynamicWide ? 'orchestral' : 'dense' as any,
      vocalPresence: char.genre === 'vocal-mid' ? 'prominent' : 'none' as any,
    };

    leanerRef.current.updatePreference(context, interaction.eqA, interaction.eqB, choice, {
      listenTime: interaction.listenTime,
      confidence: interaction.confidence
    });

    const newState = leanerRef.current.getState();
    setLearnerState({ ...newState });
    localStorage.setItem('sonic_contextual_prefs', serializeContextualState(newState));

  }, [hookEngineRef]);

  return {
    learnerState,
    isAdaptiveMode,
    setIsAdaptiveMode,
    sectionType,
    setSectionType,
    handleInteraction,
    leanerRef,
    setLearnerState
  };
}
