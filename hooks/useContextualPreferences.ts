import { useState, useCallback, useEffect } from 'react';
import { 
  ContextualBayesianLearner, 
  ContextualPreferenceState, 
  MusicContext,
  serializeContextualState,
  deserializeContextualState
} from '@/lib/ai-engine-v2';

export function useContextualPreferences() {
  const [learner, setLearner] = useState<ContextualBayesianLearner | null>(null);
  const [state, setState] = useState<ContextualPreferenceState | null>(null);

  useEffect(() => {
    let initialLearner: ContextualBayesianLearner;
    const saved = localStorage.getItem('sonic_contextual_prefs');
    if (saved) {
      try {
        const parsed = deserializeContextualState(saved);
        initialLearner = new ContextualBayesianLearner(parsed);
      } catch {
        initialLearner = new ContextualBayesianLearner();
      }
    } else {
      initialLearner = new ContextualBayesianLearner();
    }
    setLearner(initialLearner); // eslint-disable-line react-hooks/set-state-in-effect
    setState(initialLearner.getState()); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const updatePreference = useCallback((
    context: MusicContext,
    choiceA: number[],
    choiceB: number[],
    userChoice: 'A' | 'B' | 'DISLIKE_BOTH' | 'NO_PREFERENCE',
    metadata?: { listenTime?: number; confidence?: number; }
  ) => {
    if (!learner) return;
    learner.updatePreference(context, choiceA, choiceB, userChoice, metadata);
    const newState = learner.getState();
    setState({ ...newState });
    localStorage.setItem('sonic_contextual_prefs', serializeContextualState(newState));
  }, [learner]);

  const suggestGains = useCallback((context: MusicContext, explorationMode = false) => {
    if (!learner) return { gains: new Array(10).fill(0), uncertainties: new Array(10).fill(1) };
    return learner.suggestGainsForContext(context, explorationMode);
  }, [learner]);

  return { state, updatePreference, suggestGains, learner };
}
