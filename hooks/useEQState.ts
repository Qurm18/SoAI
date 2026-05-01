import { useState, useCallback, useRef, useEffect } from 'react';
import { EQBand, DEFAULT_BANDS } from '@/lib/audio-engine';
import { optimalQ } from '@/lib/math';
import { useEQHistory } from '@/hooks/use-eq-history';
import { persistCurrentState } from '@/lib/profile-store';
import { loadCurrentState } from '@/lib/profile-store';

export function useEQState(
  hookEngineRef: any,
  setPreAmp: (p: number) => void,
  setIsAICalibrated: (v: boolean) => void,
  setProfileName: (n: string | null) => void,
  handlePreAmpChange: (v: number) => void
) {
  const [bands, setBands] = useState<EQBand[]>(DEFAULT_BANDS);
  const [lastSync, setLastSync] = useState<string>('');
  const [preAmpControl, setPreAmpControl] = useState(0); // internal state if needed
  const history = useEQHistory();
  const persistTimerRef = useRef<NodeJS.Timeout | null>(null);

  const applyBandsToEngine = useCallback((newBands: EQBand[], newPreAmp: number) => {
    newBands.forEach((b, i) => hookEngineRef.current?.updateBandParams(i, b));
    hookEngineRef.current?.setPreAmp(newPreAmp);
  }, [hookEngineRef]);

  const debouncedPersist = useCallback((newBands: EQBand[], newPreAmp: number) => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => persistCurrentState(newBands, newPreAmp), 500);
  }, []);

  const handleBandChange = useCallback((index: number, params: Partial<EQBand>) => {
    const newBands = [...bands];
    newBands[index] = { ...newBands[index], ...params };

    if (params.gain !== undefined && params.q === undefined) {
      const me = newBands[index];
      const left = newBands[index - 1];
      const right = newBands[index + 1];
      const neighbourFreq = left && right
        ? (Math.abs(left.frequency - me.frequency) < Math.abs(right.frequency - me.frequency)
            ? left.frequency : right.frequency)
        : (left ?? right)?.frequency ?? me.frequency * 2;
      const newQ = optimalQ(me.frequency, neighbourFreq, me.gain, { minQ: 0.5, maxQ: 4 });
      newBands[index] = { ...me, q: newQ };
      hookEngineRef.current?.updateBandParams(index, { ...params, q: newQ });
    } else {
      hookEngineRef.current?.updateBandParams(index, params);
    }
    setBands(newBands);

    if (params.gain !== undefined) history.push(newBands, preAmpControl);

    const maxGain = Math.max(...newBands.map((b) => b.gain));
    const newPreAmp = maxGain > 0 ? -maxGain * 0.5 : 0;
    setPreAmp(newPreAmp);
    setPreAmpControl(newPreAmp);
    hookEngineRef.current?.setPreAmp(newPreAmp);
    debouncedPersist(newBands, newPreAmp);
  }, [bands, history, preAmpControl, hookEngineRef, setPreAmp, debouncedPersist]);

  const handleReset = useCallback(() => {
    history.push(bands, preAmpControl, 'Before reset');
    setBands(DEFAULT_BANDS);
    DEFAULT_BANDS.forEach((_, i) => hookEngineRef.current?.updateBand(i, 0));
    setIsAICalibrated(false);
    setProfileName(null);
    handlePreAmpChange(0);
    setPreAmpControl(0);
    debouncedPersist(DEFAULT_BANDS, 0);
  }, [bands, preAmpControl, history, debouncedPersist, setIsAICalibrated, setProfileName, hookEngineRef, handlePreAmpChange]);

  const handleUndo = useCallback(() => {
    if (!history.canUndo()) return;
    const s = history.undo();
    if (!s) return;
    setBands(s.bands); 
    setPreAmp(s.preAmp);
    setPreAmpControl(s.preAmp);
    applyBandsToEngine(s.bands, s.preAmp);
    debouncedPersist(s.bands, s.preAmp);
  }, [history, setPreAmp, applyBandsToEngine, debouncedPersist]);

  const handleRedo = useCallback(() => {
    if (!history.canRedo()) return;
    const s = history.redo();
    if (!s) return;
    setBands(s.bands); 
    setPreAmp(s.preAmp);
    setPreAmpControl(s.preAmp);
    applyBandsToEngine(s.bands, s.preAmp);
    debouncedPersist(s.bands, s.preAmp);
  }, [history, setPreAmp, applyBandsToEngine, debouncedPersist]);

  return {
    bands,
    setBands,
    handleBandChange,
    applyBandsToEngine,
    debouncedPersist,
    handleReset,
    handleUndo,
    handleRedo,
    history,
    lastSync,
    setLastSync
  };
}
