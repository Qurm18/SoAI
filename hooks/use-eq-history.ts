'use client';

import { useRef, useCallback } from 'react';
import { EQBand } from '@/lib/audio-engine';

export interface EQSnapshot {
  bands: EQBand[];
  preAmp: number;
  label?: string; // optional description e.g. "AI Calibrate — Power Bass"
  timestamp: number;
}

const MAX_HISTORY = 50;

export function useEQHistory() {
  // Stack grows forward: index 0 = oldest, top = current
  const stackRef = useRef<EQSnapshot[]>([]);
  const cursorRef = useRef<number>(-1); // points to current position

  const push = useCallback((bands: EQBand[], preAmp: number, label?: string) => {
    const snapshot: EQSnapshot = {
      bands: bands.map((b) => ({ ...b })),
      preAmp,
      label,
      timestamp: Date.now(),
    };

    // If we undid some steps and then make a new change, discard the redo branch
    if (cursorRef.current < stackRef.current.length - 1) {
      stackRef.current = stackRef.current.slice(0, cursorRef.current + 1);
    }

    stackRef.current.push(snapshot);

    // Enforce max history size
    if (stackRef.current.length > MAX_HISTORY) {
      stackRef.current.shift();
    }

    cursorRef.current = stackRef.current.length - 1;
  }, []);

  const undo = useCallback((): EQSnapshot | null => {
    if (cursorRef.current <= 0) return null;
    cursorRef.current -= 1;
    return stackRef.current[cursorRef.current];
  }, []);

  const redo = useCallback((): EQSnapshot | null => {
    if (cursorRef.current >= stackRef.current.length - 1) return null;
    cursorRef.current += 1;
    return stackRef.current[cursorRef.current];
  }, []);

  const canUndo = useCallback(() => cursorRef.current > 0, []);
  const canRedo = useCallback(() => cursorRef.current < stackRef.current.length - 1, []);

  const getHistory = useCallback((): EQSnapshot[] => {
    return stackRef.current.slice(0, cursorRef.current + 1);
  }, []);

  const clear = useCallback(() => {
    stackRef.current = [];
    cursorRef.current = -1;
  }, []);

  return { push, undo, redo, canUndo, canRedo, getHistory, clear };
}