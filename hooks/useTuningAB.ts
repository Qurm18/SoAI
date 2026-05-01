import { useCallback } from 'react';
import { AudioEngine } from '@/lib/audio-engine';
import { AB_PREVIEW_GAINS } from '@/lib/audio-engine';

export function useTuningAB(
  audioSource: string,
  hookAudioRef: React.MutableRefObject<HTMLAudioElement | null>,
  hookEngineRef: React.MutableRefObject<AudioEngine | null>,
  togglePlayback: () => void,
  setIsPlaying: (p: boolean) => void,
  setAudioSource: (s: string) => void,
  setCurrentTrackName: (n: string) => void,
  TRACKS: any[]
) {
  const handlePreviewAB = useCallback(async (
    scenarioId: string,
    branch: 'A' | 'B',
    seekTime?: number,
    trackUrl?: string,
    customGains?: number[]
  ) => {
    if (!hookEngineRef.current || !hookAudioRef.current) return;

    if (trackUrl && trackUrl !== audioSource) {
      const matched = TRACKS.find((t) => t.url === trackUrl);
      setAudioSource(trackUrl);
      setCurrentTrackName(matched?.name ?? trackUrl.split('/').pop() ?? 'Calibration Track');
      
      const wasPlaying = !hookAudioRef.current.paused;
      if (wasPlaying) {
        setIsPlaying(true);
        await hookEngineRef.current.crossfade(trackUrl, hookAudioRef.current, seekTime);
      } else {
        hookAudioRef.current.src = trackUrl;
        hookAudioRef.current.crossOrigin = trackUrl.startsWith('blob:') ? null : 'anonymous';
        hookAudioRef.current.load();
        
        await new Promise<void>((resolve) => {
          const el = hookAudioRef.current!;
          const done = () => { el.removeEventListener('canplay', done); resolve(); };
          el.addEventListener('canplay', done, { once: true });
          setTimeout(done, 1500);
        });
        
        if (seekTime !== undefined && isFinite(seekTime)) hookAudioRef.current.currentTime = seekTime;
        togglePlayback();
      }
    } else {
      if (hookAudioRef.current.paused) togglePlayback();

      if (seekTime !== undefined && isFinite(seekTime)) hookAudioRef.current.currentTime = seekTime;
      else if (isFinite(hookAudioRef.current.currentTime) && hookAudioRef.current.currentTime > 120) hookAudioRef.current.currentTime = 30;
    }

    const effectiveUrl = trackUrl ?? audioSource;
    const baseGains = AB_PREVIEW_GAINS[scenarioId];
    const targetGains = customGains || baseGains?.[branch];

    if (targetGains) {
      hookEngineRef.current.loadPreviewGains(targetGains);
      // AI-01: Skip LUFS matching for blob: URLs (user-uploaded files).
      // fetch() cannot load blob: URLs from an OfflineAudioContext cross-origin,
      // and gain-matching on a live blob would require re-reading the file.
      // Pre-normalised reference tracks (https:// / /tracks/) work correctly.
      if (!effectiveUrl.startsWith('blob:')) {
        try {
          const seekRef = seekTime ?? hookAudioRef.current.currentTime;
          if (!customGains) {
            await hookEngineRef.current.gainMatchAB(effectiveUrl, scenarioId, seekRef, 3);
          }
        } catch (err) {
          console.warn('[AI-01] LUFS gain-match failed (non-fatal):', err);
        }
      } else {
        console.debug('[AI-01] Skipping LUFS match for blob: URL — user-uploaded file.');
      }
      hookEngineRef.current.crossfadeTo(branch);
    }
  }, [audioSource, togglePlayback, hookAudioRef, hookEngineRef, setCurrentTrackName, setAudioSource, setIsPlaying, TRACKS]);

  const handleExitAB = useCallback(() => {
    if (hookEngineRef.current) hookEngineRef.current.exitABMode();
    if (hookAudioRef.current && !hookAudioRef.current.paused) {
      hookAudioRef.current.pause();
      setIsPlaying(false);
    }
  }, [hookEngineRef, hookAudioRef, setIsPlaying]);

  return {
    handlePreviewAB,
    handleExitAB
  };
}
