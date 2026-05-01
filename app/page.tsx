'use client';


import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play, Pause, SkipForward, SkipBack,
  Sparkles, Volume2, Music,
  Download, List, Sliders, Activity,
  ArrowRight, Save, FolderOpen, Headphones,
  Undo2, Redo2, Upload, X, Target,
  LayoutDashboard, ChevronDown, RotateCcw, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import { AudioEngine, DEFAULT_BANDS, EQBand, AB_PREVIEW_GAINS, EnhancementParams, DEFAULT_ENHANCEMENT } from '@/lib/audio-engine';
import { AdaptiveEQLearner, LearnerState, Interaction, LearnerAudioContext, AudioFeatures } from '@/lib/adaptive-eq';
import { Visualizer } from '@/components/Visualizer';
import { EQPanel } from '@/components/EQPanel';
import { EQCurve } from '@/components/EQCurve';
import { TuningWizard } from '@/components/TuningWizard';
import { ExportDialog } from '@/components/ExportDialog';
import { DeviceInspector } from '@/components/DeviceInspector';
import { InfoTooltip } from '@/components/InfoTooltip';
import { AudioInitOverlay } from '@/components/AudioInitOverlay';
import { Header } from '@/components/Header';
import { AnalysisSidebar } from '@/components/AnalysisSidebar';
import { PlayerSection } from '@/components/PlayerSection';
import { EnhancementPanel } from '@/components/EnhancementPanel';
import { AdaptiveEQModule } from '@/components/AdaptiveEQModule';
import { AUDIO_ACCEPT_ATTR } from '@/lib/device-inspector';
import { EQProfile, TasteResult, ChoiceReason, ScenarioChoiceAnalysis } from '@/lib/ai-engine';
import { optimalQ } from '@/lib/math';
import {
  SavedProfile,
  saveProfile,
  getAllProfiles,
  deleteProfile,
  persistCurrentState,
  loadCurrentState,
  exportProfileAsAPO,
  parseEqualizerAPO,
  loadLearnerState,
  persistLearnerState,
} from '@/lib/profile-store';
import { TARGET_CURVES } from '@/lib/eq-targets';
import { useEQHistory } from '@/hooks/use-eq-history';
import { RewImport } from '@/components/RewImport';
import { ZeroLatencyVisualizer } from '@/components/ZeroLatencyVisualizer';

import { EQSectionHeader } from '@/components/EQSectionHeader';
import { HearingProtectionIndicator } from '@/components/HearingProtectionIndicator';
import { MainAppFooter } from '@/components/MainAppFooter';
import { ProfileLibraryModal } from '@/components/ProfileLibraryModal';
import { TrackLibraryModal } from '@/components/TrackLibraryModal';
import { SaveProfileModal } from '@/components/SaveProfileModal';

import { useTrackLibrary } from '@/hooks/useTrackLibrary';
import { useAdaptiveEQ } from '@/hooks/useAdaptiveEQ';
import { useTuningAB } from '@/hooks/useTuningAB';

import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useCalibration } from '@/hooks/useCalibration';
import { useProfileManager } from '@/hooks/useProfileManager';
import { earDamageRisk } from '@/lib/math/loudness-adaptive';

interface Track {
  id: string;
  name: string;
  artist?: string;
  genre: string;
  url: string;
  duration?: string;
}

const TRACKS: Track[] = [
  // User tracks can be added here. Example format:
  // { id: 't1', name: 'Song Name', artist: 'Artist', genre: 'Genre', duration: '3:00', url: '/tracks/song1.mp3' },
];

export default function Home() {
  const {
    audioRef: hookAudioRef,
    engineRef: hookEngineRef,
    isPlaying,
    setIsPlaying,
    volume,
    preAmp,
    setPreAmp,
    audioSource,
    setAudioSource,
    currentTrackName,
    setCurrentTrackName,
    errorHeader,
    setErrorHeader,
    analyzer,
    analyzerL,
    analyzerR,
    audioContext,
    isReady,
    enhancement,
    setEnhancement,
    lufsMetrics,
    phaseMode,
    setPhaseMode,
    initAudio,
    togglePlayback,
    handleTrackChange,
    handleVolumeChange,
    handlePreAmpChange,
    handleEnhancementChange,
    handleAudioError,
    applyBandsToEngine: hookApplyBandsToEngine,
    handlePhaseModeChange,
    setExactSampleRate,
    enableWebUSB,
    disableWebUSB,
    pipelineInfo,
  } = useAudioPlayer();

  const {
    showWizard,
    setShowWizard,
    isAICalibrated,
    setIsAICalibrated,
    calibrationConfidence,
    taste,
    reasons,
    scenarioAnalysis,
    aiInsights,
    selectionMode,
    setSelectionMode,
    selectedTrackUrls,
    setSelectedTrackUrls,
    handleCalibrationComplete,
  } = useCalibration();

  const {
    savedProfiles,
    showProfilePanel,
    setShowProfilePanel,
    profileName,
    setProfileName,
    profileColor,
    setProfileColor,
    profileGenre,
    setProfileGenre,
    saveNameInput,
    setSaveNameInput,
    showSaveDialog,
    setShowSaveDialog,
    importError,
    setImportError,
    refreshProfiles,
    handleSaveProfile: saveProfileToStore,
    deleteProfile,
  } = useProfileManager();

  // ─── Track Library Hook ────────────────────────────────────────────────
  const {
    customTracks,
    setCustomTracks,
    allTracks,
    showTrackLibrary,
    setShowTrackLibrary,
    genreFilter,
    setGenreFilter,
    trackSearch,
    setTrackSearch,
    handleNextTrack,
    handlePrevTrack,
    allGenres
  } = useTrackLibrary(TRACKS, audioSource, handleTrackChange);

  // ─── Remaining Page State (UI & UI only) ───────────────────────────────
  const [bands, setBands] = useState<EQBand[]>(DEFAULT_BANDS);
  const [spectralPeaks, setSpectralPeaks] = useState<number[]>([]);
  const [lastSync, setLastSync] = useState<string>('');
  const [urlInput, setUrlInput] = useState('');
  const [showRewImport, setShowRewImport] = useState(false);
  const [baseCorrection, setBaseCorrection] = useState<number[]>(new Array(10).fill(0));
  const [sessionDuration, setSessionDuration] = useState(0);

  // UI state
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [targetCurveId, setTargetCurveId] = useState<string>('none');
  const [showEnhancement, setShowEnhancement] = useState(false);
  const [useZeroLatency, setUseZeroLatency] = useState(false);
  const [showAnalysisSidebar, setShowAnalysisSidebar] = useState(true);
  const [lastManualEditTime, setLastManualEditTime] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const persistTimerRef = useRef<NodeJS.Timeout | null>(null);

  const history = useEQHistory();

  const applyBandsToEngine = useCallback((newBands: EQBand[], newPreAmp: number) => {
    newBands.forEach((b, i) => hookEngineRef.current?.updateBandParams(i, b));
    hookEngineRef.current?.setPreAmp(newPreAmp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  const debouncedPersist = useCallback((newBands: EQBand[], newPreAmp: number) => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => persistCurrentState(newBands, newPreAmp), 500);
  }, []);

  // ─── Adaptive EQ Hook ──────────────────────────────────────────────────
  const {
    learnerState,
    isAdaptiveMode,
    setIsAdaptiveMode,
    sectionType,
    setSectionType,
    handleInteraction,
    leanerRef,
    setLearnerState
  } = useAdaptiveEQ(hookEngineRef, isPlaying, preAmp, applyBandsToEngine);

  // Continuous prediction loop
  // useEffect(() => {
  //   if (!isAdaptiveMode || !isPlaying || !hookEngineRef.current || !leanerRef.current) return;
  // 
  //   const interval = setInterval(() => {
  //     // Pause adaptation if user edited recently (10s cooldown)
  //     if (Date.now() - lastManualEditTime < 10000) return;
  // 
  //     const energies = hookEngineRef.current!.getAdaptiveFeatures();
  //     const fingerprint = hookEngineRef.current!.getTrackFingerprint();
  //     if (!energies) return;
  // 
  //     const char = hookEngineRef.current!.classifyTrackCharacter(
  //       [energies.lowEnergy, energies.midEnergy, energies.highEnergy], 
  //       fingerprint
  //     );
  // 
  //     const contextObj = {
  //       genre: char.genre as any,
  //       tempoCategory: 'moderate' as any,
  //       complexity: char.dynamicWide ? 'orchestral' : 'dense' as any,
  //       vocalPresence: char.genre === 'vocal-mid' ? 'prominent' : 'none' as any,
  //     };
  // 
  //     const suggestion = leanerRef.current!.suggestGainsForContext(contextObj);
  //     const adjustment = suggestion.gains;
  //     const dynamicFreqs = hookEngineRef.current!.computeDynamicEQFrequencies(fingerprint);
  // 
  //     setBands((prev: EQBand[]) => {
  //       const hasSignificantGain = adjustment.some((a: number, i) => Math.abs(a - prev[i].gain) > 0.5);
  //       const hasSignificantFreq = dynamicFreqs.some((f: number, i) => Math.abs(f - prev[i].frequency) > prev[i].frequency * 0.05);
  // 
  //       if (!hasSignificantGain && !hasSignificantFreq) return prev;
  // 
  //       const next = prev.map((b, i) => ({
  //         ...b,
  //         gain: Math.max(-15, Math.min(15, adjustment[i])),
  //         frequency: dynamicFreqs[i] // Shift frequency to match track profile
  //       }));
  //       
  //       applyBandsToEngine(next, preAmp);
  //       
  //       // Push frequencies globally to the engine so underlying nodes shift
  //       if (hasSignificantFreq) {
  //         hookEngineRef.current!.updateFrequencies(dynamicFreqs);
  //       }
  // 
  //       return next;
  //     });
  //   }, 2000); 
  // 
  //   return () => clearInterval(interval);
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [isAdaptiveMode, isPlaying, sectionType, preAmp, applyBandsToEngine, leanerRef]);

  const handleDynamicEqMasterChange = (val: boolean) => {
    handleEnhancementChange({ dynamicEqMaster: val });
  };

  // ─── Mount: last-sync timestamp ────────────────────────────────────────
  useEffect(() => {
    const t = new Date().toLocaleTimeString();
    const id = setTimeout(() => setLastSync(t), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    let timer: any;
    if (isPlaying) {
      timer = setInterval(() => {
        setSessionDuration(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isPlaying]);

  const bandsRef = useRef(bands);
  const preAmpRef = useRef(preAmp);
  useEffect(() => { bandsRef.current = bands; preAmpRef.current = preAmp; }, [bands, preAmp]);

  useEffect(() => {
    if (hookEngineRef.current && isReady) {
      (window as any).__ENGINE__ = hookEngineRef.current;
      (window as any).__AUDIO_SRC__ = audioSource;
      hookApplyBandsToEngine(bandsRef.current, preAmpRef.current);
    }
  }, [isReady, audioSource, hookEngineRef, hookApplyBandsToEngine]);
  
  useEffect(() => {
    if (!audioSource || !hookEngineRef.current) return;
    
    const analyzePeaks = async () => {
      try {
        const peaks = await hookEngineRef.current!.getSpectralPeaks(audioSource);
        setSpectralPeaks(peaks);
      } catch (err) {
        console.warn('Failed to discover resonances:', err);
      }
    };
    
    analyzePeaks();
  }, [audioSource, hookEngineRef]);

  // ─── Band manipulation (with live-Q recompute) ─────────────────────────
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
    console.log('setBands called', newBands);
    setBands(newBands);
    setLastManualEditTime(Date.now());

    if (params.gain !== undefined) history.push(newBands, preAmp);

    const maxGain = Math.max(...newBands.map((b) => b.gain));
    const newPreAmp = maxGain > 0 ? -maxGain * 0.5 : 0;
    setPreAmp(newPreAmp);
    hookEngineRef.current?.setPreAmp(newPreAmp);
    debouncedPersist(newBands, newPreAmp);
  }, [bands, history, preAmp, hookEngineRef, setPreAmp, debouncedPersist]);

  // Handlers for volume/preAmp/phase are now in audio hook

  // ─── A/B preview (multi-track aware) ──────────────────────────────────
  const { handlePreviewAB, handleExitAB } = useTuningAB(
    audioSource,
    hookAudioRef,
    hookEngineRef,
    togglePlayback,
    setIsPlaying,
    setAudioSource,
    setCurrentTrackName,
    TRACKS
  );

  // Sync engine on profile/bands change
  useEffect(() => {
    if (hookEngineRef.current) hookApplyBandsToEngine(bands, preAmp);
    refreshProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bands, preAmp, hookApplyBandsToEngine, refreshProfiles]);

  // ─── EQ controls ───────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    history.push(bands, preAmp, 'Before reset');
    console.trace('setBands to DEFAULT_BANDS called');
    console.trace('setBands to DEFAULT_BANDS called');
    setBands(DEFAULT_BANDS);
    DEFAULT_BANDS.forEach((_, i) => hookEngineRef.current?.updateBand(i, 0));
    setIsAICalibrated(false);
    setProfileName(null);
    handlePreAmpChange(0);
    debouncedPersist(DEFAULT_BANDS, 0);
  }, [bands, preAmp, history, debouncedPersist, setIsAICalibrated, setProfileName, hookEngineRef, handlePreAmpChange]);

  const handleUndo = useCallback(() => {
    if (!history.canUndo()) return;
    const s = history.undo();
    if (!s) return;
    setBands(s.bands); setPreAmp(s.preAmp);
    hookApplyBandsToEngine(s.bands, s.preAmp);
    debouncedPersist(s.bands, s.preAmp);
  }, [history, setPreAmp, hookApplyBandsToEngine, debouncedPersist]);

  const handleRedo = useCallback(() => {
    if (!history.canRedo()) return;
    const s = history.redo();
    if (!s) return;
    setBands(s.bands); setPreAmp(s.preAmp);
    hookApplyBandsToEngine(s.bands, s.preAmp);
    debouncedPersist(s.bands, s.preAmp);
  }, [history, setPreAmp, hookApplyBandsToEngine, debouncedPersist]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  const restoreBands = useCallback(() => {
    hookEngineRef.current?.exitABMode();
    bands.forEach((band, i) => hookEngineRef.current?.updateBand(i, band.gain));
    setShowWizard(false);
  }, [bands, hookEngineRef, setShowWizard]);

  // ─── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault(); handleUndo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault(); handleRedo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault(); handleRedo(); return;
      }
      if (e.key === ' ' && !showWizard && !showProfilePanel && !showSaveDialog && !showExportDialog) {
        e.preventDefault(); togglePlayback(); return;
      }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) { handleReset(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        setSaveNameInput(profileName || '');
        setShowSaveDialog(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        setShowExportDialog(true);
        return;
      }
      if (e.key === 'Escape') {
        if (showWizard) { restoreBands(); return; }
        if (showProfilePanel) { setShowProfilePanel(false); return; }
        if (showSaveDialog) { setShowSaveDialog(false); return; }
        if (showExportDialog) { setShowExportDialog(false); return; }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
     
  }, [showWizard, showProfilePanel, showSaveDialog, showExportDialog, profileName, togglePlayback, restoreBands, handleReset, handleUndo, handleRedo, setSaveNameInput, setShowSaveDialog, setShowProfilePanel]);

  // ─── AI tuning complete ────────────────────────────────────────────────
  const handleTuningComplete = (result: any) => {
    handleCalibrationComplete(result);
    
    const qs = result.profile?.qSuggestions;
    const newBands = bands.map((band, i) => ({
      ...band,
      gain: result.gains[i],
      q: qs?.[i] ?? band.q,
    }));
    setBands(newBands);
    setProfileName(result.profileName);
    setProfileColor(result.profile?.color ?? '#F27D26');
    setProfileGenre(result.profile?.genre ?? null);
    hookApplyBandsToEngine(newBands, preAmp);

    const maxGain = Math.max(...result.gains);
    const newPreAmp = maxGain > 0 ? -maxGain : 0;
    handlePreAmpChange(newPreAmp);

    history.push(newBands, newPreAmp, `AI: ${result.profileName}`);
    debouncedPersist(newBands, newPreAmp);

    // Tầng 3: Record session summary
    if (leanerRef.current) {
      const { recordSessionSummary } = require('@/lib/profile-store');
      recordSessionSummary(leanerRef.current.getState());
    }
  };

  const handleSaveProfileLocal = () => {
    const name = saveNameInput.trim() || profileName || 'My Profile';
    const saved = saveProfile(name, bands, preAmp, {
      genre: profileGenre ?? undefined,
      color: profileColor,
      source: isAICalibrated ? 'ai' : 'manual',
      // We can map the new Map contexts to old simple object, or just leave it empty.
      // Profile schema accepts contextPreferences, but we don't strictly need it.
      contextPreferences: {},
    });

    // Record session if it was an AI-driven session
    if (isAICalibrated && leanerRef.current) {
      const { recordSessionSummary } = require('@/lib/profile-store');
      recordSessionSummary(leanerRef.current.getState());
    }

    refreshProfiles();
    setSaveNameInput('');
    setShowSaveDialog(false);
    setProfileName(saved.name);
  };

  const handleLoadProfile = (profile: SavedProfile) => {
    history.push(bands, preAmp, 'Before load profile');
    setBands(profile.bands);
    setPreAmp(profile.preAmp);
    setProfileName(profile.name);
    setProfileColor(profile.color ?? '#F27D26');
    setProfileGenre(profile.genre ?? null);
    setIsAICalibrated(profile.source === 'ai' || profile.source === 'import');
    hookApplyBandsToEngine(profile.bands, profile.preAmp);
    debouncedPersist(profile.bands, profile.preAmp);
    
    setShowProfilePanel(false);
  };

  const handleDeleteProfile = (id: string) => {
    deleteProfile(id);
  };

  // ─── Import (.json / .txt) ─────────────────────────────────────────────
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    const text = await file.text();

    if (file.name.endsWith('.json')) {
      try {
        const parsed = JSON.parse(text);
        // Support both legacy SavedProfile and new SonicAIExport shape
        const isNew = parsed?.format === 'sonic-ai-eq';
        const bandsRaw = isNew ? parsed.bands : parsed.bands;
        const preAmpRaw = isNew ? parsed.preAmp : (parsed.preAmp ?? 0);
        const nameRaw = isNew ? parsed.profile?.name : parsed.name;
        if (!Array.isArray(bandsRaw)) throw new Error('Invalid profile JSON');

        const importedBands: EQBand[] = bandsRaw.map((b: any) => ({
          frequency: b.frequency,
          gain: b.gain,
          q: b.q,
          type: b.type,
        }));

        history.push(bands, preAmp, 'Before import');
        setBands(importedBands);
        setPreAmp(preAmpRaw);
        setProfileName(nameRaw ?? 'Imported');
        setIsAICalibrated(true);
        hookApplyBandsToEngine(importedBands, preAmpRaw);
        const saved = saveProfile(nameRaw ?? 'Imported', importedBands, preAmpRaw, {
          source: 'import',
          color: isNew ? parsed.profile?.color : parsed.color,
          genre: isNew ? parsed.profile?.genre : parsed.genre,
        });
        refreshProfiles();
        setProfileName(saved.name);
        return;
      } catch {
        setImportError('Invalid JSON profile file.');
        return;
      }
    }

    const result = parseEqualizerAPO(text);
    if (result.errors.length > 0 && result.bands.length === 0) {
      setImportError(result.errors.join(' '));
      return;
    }

    const newBands = DEFAULT_BANDS.map((defaultBand) => {
      const closest = result.bands.reduce((best, b) =>
        Math.abs(b.frequency - defaultBand.frequency) < Math.abs(best.frequency - defaultBand.frequency) ? b : best
      );
      const dist = Math.abs(closest.frequency - defaultBand.frequency);
      if (dist > defaultBand.frequency * 0.5) return defaultBand;
      return { ...defaultBand, gain: closest.gain, q: closest.q, type: closest.type };
    });

    history.push(bands, preAmp, 'Before APO import');
    setBands(newBands);
    setPreAmp(result.preAmp);
    setIsAICalibrated(true);
    hookApplyBandsToEngine(newBands, result.preAmp);
    const importName = file.name.replace(/\.[^.]+$/, '');
    const saved = saveProfile(importName, newBands, result.preAmp, { source: 'import' });
    refreshProfiles();
    setProfileName(saved.name);
    debouncedPersist(newBands, result.preAmp);
    if (importFileRef.current) importFileRef.current.value = '';
  };

  const handleFolderImport = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  const handleFolderInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setErrorHeader(null);
    const tracks: Track[] = files
      .filter(file => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        return ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus'].includes(ext || '');
      })
      .map(file => {
        const url = URL.createObjectURL(file);
        // Try to get folder name from webkitRelativePath
        const folderName = file.webkitRelativePath.split('/')[0] || 'Imported Folder';
        return {
          id: `local-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name.replace(/\.[^/.]+$/, ""),
          artist: folderName,
          genre: folderName,
          url,
          duration: '--:--',
        };
      });

    if (tracks.length === 0) {
      setErrorHeader('No supported audio files found in the selected folder.');
      return;
    }

    setCustomTracks(prev => [...prev, ...tracks]);
    
    if (tracks.length > 0 && !audioSource && !isPlaying) {
      handleTrackChange(tracks[0].url, tracks[0].name);
    }
  }, [audioSource, isPlaying, handleTrackChange, setErrorHeader, setCustomTracks]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const newTracks: Track[] = files.map(file => {
      const url = URL.createObjectURL(file);
      return {
        id: `local-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name.replace(/\.[^/.]+$/, ""),
        artist: 'Local File',
        genre: 'Local',
        url,
        duration: '--:--',
      };
    });

    setCustomTracks(prev => [...prev, ...newTracks]);

    // Load the first one of the pack
    if (newTracks.length > 0) {
      handleTrackChange(newTracks[0].url, newTracks[0].name);
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    if (urlInput.includes('youtube.com') || urlInput.includes('youtu.be') || urlInput.includes('spotify.com')) {
      setErrorHeader('YouTube/Spotify links are not directly supported. Paste a direct MP3/OGG/WAV/FLAC URL.');
      return;
    }
    handleTrackChange(urlInput.trim(), 'Stream: ' + (urlInput.split('/').pop()?.split('?')[0] || 'Custom'));
    setUrlInput('');
  };

  let interactionCount = 0;
  let stability = 0;
  if (learnerState && learnerState.totalInteractions !== undefined) {
    interactionCount = learnerState.totalInteractions;
    
    let sumConf = 0;
    let numContexts = 0;
    const contextsIter = learnerState.contexts instanceof Map ? Array.from(learnerState.contexts.values()) : Object.values(learnerState.contexts || {});
    for (const ctx of contextsIter) {
      if (!ctx || !(ctx as any).bands) continue;
      let bandConf = 0;
      for (const b of (ctx as any).bands) {
        bandConf += Math.min(1, (b.alpha + b.beta) / 10);
      }
      sumConf += bandConf / 10;
      numContexts++;
    }
    stability = numContexts > 0 ? sumConf / numContexts : 0;
  }

  const risk = useMemo(() => {
    return earDamageRisk(
      bands.map(b => b.gain),
      bands.map(b => b.frequency),
      'moderate',
      sessionDuration
    );
  }, [bands, sessionDuration]);

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#07080a] text-white relative overflow-x-hidden">
      {/* Ambient aurora */}
      <div className="sonic-aurora" aria-hidden />

      {/* Activation overlay */}
      <AudioInitOverlay isReady={isReady} onInit={initAudio} />

      {/* App shell */}
      <div className="relative z-10 mx-auto w-full max-w-[1400px] px-3 md:px-6 lg:px-8 py-4 md:py-6">
        {/* Header (sticky-ish glass) */}
        <Header
          profileName={profileName}
          calibrationConfidence={calibrationConfidence}
          interactionCount={interactionCount}
          stability={stability}
          isAICalibrated={isAICalibrated}
          profileColor={profileColor}
          canUndo={history.canUndo()}
          canRedo={history.canRedo()}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onShowProfilePanel={() => setShowProfilePanel(true)}
          onShowSaveDialog={() => { setSaveNameInput(profileName || ''); setShowSaveDialog(true); }}
          onShowExportDialog={() => setShowExportDialog(true)}
          onImportClick={() => importFileRef.current?.click()}
          onAICalibrate={() => {
            setSelectionMode(true);
            setSelectedTrackUrls([audioSource]);
            setShowTrackLibrary(true);
          }}
          onQuickCalibrate={() => setShowWizard(true)}
          showAnalysisSidebar={showAnalysisSidebar}
          setShowAnalysisSidebar={setShowAnalysisSidebar}
          savedProfilesCount={savedProfiles.length}
        />
        <input
          ref={importFileRef}
          type="file"
          accept=".json,.txt"
          className="hidden"
          onChange={handleImportFile}
        />

        {/* Top: Curve + Visualizer (stacked) | Player + Insights */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-5 items-start">
          {/* LEFT: Curve, Visualizer, Player */}
          <div className={`${showAnalysisSidebar ? 'lg:col-span-8' : 'lg:col-span-12'} space-y-4 md:space-y-5 transition-all duration-300`}>
            {/* EQ Curve with target overlay control */}
            <div className="relative">
              <EQCurve 
                bands={bands} 
                baseCorrection={baseCorrection}
                target={targetCurveId} 
                spectralPeaks={spectralPeaks}
              />
              {/* Target curve picker */}
              <div className="absolute top-3 right-3 flex items-center gap-1 z-20">
                <Target className="w-3 h-3 text-white/40" />
                <select
                  value={targetCurveId}
                  onChange={(e) => setTargetCurveId(e.target.value)}
                  className="bg-black/50 border border-white/10 rounded-md text-[9px] font-mono uppercase tracking-widest text-white/70 px-1.5 py-0.5 outline-none cursor-pointer hover:border-white/20"
                  title="Reference target curve"
                >
                  <option value="none">No Target</option>
                  {TARGET_CURVES.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Visualizer */}
            <div className="relative">
              {useZeroLatency ? (
                 <ZeroLatencyVisualizer pipelineInfo={pipelineInfo} />
              ) : (
                 <Visualizer 
                   analyzer={analyzer} 
                   analyzerL={analyzerL} 
                   analyzerR={analyzerR} 
                   metrics={lufsMetrics} 
                 />
              )}
              <div className="absolute top-2 right-2 z-10 flex gap-2">
                 {useZeroLatency && (
                    <button 
                       onClick={() => {
                          const rates = [44100, 48000, 96000, 192000];
                          const idx = rates.indexOf(pipelineInfo?.targetSampleRate || 44100);
                          const nextIdx = (idx + 1) % rates.length;
                          setExactSampleRate(rates[nextIdx]);
                       }}
                      className="px-2 py-1 text-[9px] uppercase font-mono rounded bg-white/10 hover:bg-white/20 text-white"
                    >
                      Rate: {pipelineInfo?.targetSampleRate ? (pipelineInfo.targetSampleRate/1000).toFixed(1) : 44.1}k
                    </button>
                 )}
                 <button 
                    onClick={() => setUseZeroLatency(false)}
                   className={`px-2 py-1 text-[9px] uppercase font-mono rounded ${!useZeroLatency ? 'bg-[#F27D26] text-black font-bold' : 'bg-black/50 text-white/50 border border-white/10'}`}
                 >
                   Standard
                 </button>
                 <button 
                    onClick={() => setUseZeroLatency(true)}
                   className={`px-2 py-1 text-[9px] uppercase font-mono rounded ${useZeroLatency ? 'bg-[#F27D26] text-black font-bold' : 'bg-black/50 text-white/50 border border-white/10'}`}
                 >
                   Offscreen
                 </button>
              </div>
            </div>

            {/* UI-01 / UI-02: Empty state — guide first-time users */}
            {!audioSource && (
              <div className="flex flex-col items-center justify-center gap-4 py-8 px-6 rounded-2xl border border-dashed border-white/10 bg-black/20 backdrop-blur-sm text-center">
                <div className="w-14 h-14 rounded-full bg-[#F27D26]/10 border border-[#F27D26]/20 flex items-center justify-center">
                  <Music className="w-6 h-6 text-[#F27D26]" />
                </div>
                <div>
                  <p className="text-white font-semibold text-base mb-1">Load a track to begin</p>
                  <p className="text-[#8E9299] text-xs max-w-xs">
                    Upload your own audio file, paste a URL, or open the track library to get started with AI-powered EQ calibration.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-[#F27D26] hover:bg-[#F27D26]/90 text-black font-semibold text-xs rounded-xl transition-all"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload Audio
                  </button>
                  <button
                    onClick={() => setShowTrackLibrary(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-xs rounded-xl transition-all"
                  >
                    <List className="w-3.5 h-3.5" />
                    Browse Library
                  </button>
                </div>
              </div>
            )}

            {/* Player */}
            <PlayerSection
              currentTrackName={currentTrackName}
              isPlaying={isPlaying}
              onBrowseLibrary={() => setShowTrackLibrary(true)}
              onRewImport={() => setShowRewImport(true)}
              onFileUploadClick={() => fileInputRef.current?.click()}
              fileInputRef={fileInputRef}
              handleFileUpload={handleFileUpload}
              onPrevTrack={handlePrevTrack}
              onTogglePlayback={togglePlayback}
              onNextTrack={handleNextTrack}
              volume={volume}
              onVolumeChange={(val) => handleVolumeChange(val)}
            />
          </div>

          <AnalysisSidebar
            showAnalysisSidebar={showAnalysisSidebar}
            urlInput={urlInput}
            setUrlInput={setUrlInput}
            onUrlSubmit={handleUrlSubmit}
            onShowTrackLibrary={() => setShowTrackLibrary(true)}
            tracksCount={TRACKS.length}
            taste={taste}
            scenarioAnalysis={scenarioAnalysis}
            reasons={reasons}
            aiInsights={aiInsights}
            onShowExportDialog={() => setShowExportDialog(true)}
          />
        </div>
        {/* EQ controls section */}
        <section className="mt-6 md:mt-8 space-y-6">
          <EQSectionHeader
            profileGenre={profileGenre}
            profileName={profileName}
            handleReset={handleReset}
            setSaveNameInput={setSaveNameInput}
            setShowSaveDialog={setShowSaveDialog}
          />

          {/* MAIN EQ PANEL - Top Priority */}
          <div className="relative z-20">
            <EQPanel
              bands={bands}
              onBandChange={handleBandChange}
              preAmp={preAmp}
              onPreAmpChange={handlePreAmpChange}
              phaseMode={phaseMode}
              onPhaseModeChange={handlePhaseModeChange}
              dynamicEqMaster={enhancement.dynamicEqMaster}
              onDynamicEqMasterChange={handleDynamicEqMasterChange}
              spectralPeaks={spectralPeaks}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* ─── Sound Enhancement Panel ─── */}
            <EnhancementPanel
              showEnhancement={showEnhancement}
              setShowEnhancement={setShowEnhancement}
              enhancement={enhancement}
              setEnhancement={setEnhancement}
              onEnhancementChange={handleEnhancementChange}
            />

            {/* ─── Adaptive EQ Module ─── */}
            <AdaptiveEQModule
              isAdaptiveMode={isAdaptiveMode}
              setIsAdaptiveMode={setIsAdaptiveMode}
              stability={stability}
              sectionType={sectionType}
              setSectionType={setSectionType}
              profileName={profileName}
            />

            {/* Hearing Protection Indicator */}
            <HearingProtectionIndicator risk={risk} />
          </div>
        </section>

        {/* Footer */}
        <MainAppFooter errorHeader={errorHeader} lastSync={lastSync} />
      </div>

      {/* Hidden audio */}
      <audio
        key={(audioContext as any)?.id || 'initial'}
        ref={hookAudioRef}
        src={audioSource || undefined}
        onEnded={() => setIsPlaying(false)}
        onError={handleAudioError}
        preload="auto"
        crossOrigin={audioSource.startsWith('blob:') ? undefined : 'anonymous'}
      />

      <input
        type="file"
        ref={folderInputRef}
        onChange={handleFolderInputChange}
        {...({ webkitdirectory: "", directory: "" } as any)}
        className="hidden"
      />

      {/* Modals */}
      <AnimatePresence>
        {showRewImport && (
          <RewImport 
            onClose={() => setShowRewImport(false)}
            onApply={(gains) => {
              const newBands = bands.map((b, i) => ({ ...b, gain: gains[i] }));
              setBands(newBands);
              applyBandsToEngine(newBands, preAmp);
              history.push(newBands, preAmp, 'REW Measurement Apply');
              debouncedPersist(newBands, preAmp);
            }}
          />
        )}
        {showWizard && (
          <TuningWizard
            learnerState={learnerState}
            onComplete={handleTuningComplete}
            onClose={restoreBands}
            onPreviewAB={handlePreviewAB}
            onExitAB={handleExitAB}
            onChoice={handleInteraction}
            tracks={
              selectedTrackUrls.length > 0
                ? selectedTrackUrls.map((u) => {
                    const t = allTracks.find((x) => x.url === u);
                    return { url: u, name: t?.name ?? 'Selected Track' };
                  })
                : [{ url: audioSource, name: currentTrackName }]
            }
            targetSamples={Math.min(40, 15 + 10 * Math.max(1, selectedTrackUrls.length))}
          />
        )}
      </AnimatePresence>

      {/* Export dialog */}
      <ExportDialog
        open={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        bands={bands}
        preAmp={preAmp}
        defaultName={profileName || 'Sonic AI Live EQ'}
        defaultGenre={profileGenre ?? undefined}
        defaultColor={profileColor}
      />

      <ProfileLibraryModal
        show={showProfilePanel}
        onClose={() => setShowProfilePanel(false)}
        savedProfiles={savedProfiles}
        handleDeleteProfile={handleDeleteProfile}
        handleLoadProfile={handleLoadProfile}
        exportProfileAsAPO={exportProfileAsAPO}
        importFileRef={importFileRef}
        importError={importError}
      />

      <TrackLibraryModal
        show={showTrackLibrary}
        onClose={() => setShowTrackLibrary(false)}
        selectionMode={selectionMode}
        setSelectionMode={setSelectionMode}
        selectedTrackUrls={selectedTrackUrls}
        setSelectedTrackUrls={setSelectedTrackUrls}
        allTracks={allTracks}
        trackSearch={trackSearch}
        setTrackSearch={setTrackSearch}
        genreFilter={genreFilter}
        setGenreFilter={setGenreFilter}
        allGenres={allGenres}
        handleFolderImport={handleFolderImport}
        fileInputRef={fileInputRef}
        audioSource={audioSource}
        currentTrackName={currentTrackName}
        urlInput={urlInput}
        setUrlInput={setUrlInput}
        handleUrlSubmit={handleUrlSubmit}
        isPlaying={isPlaying}
        onConfirmCalibration={() => {
          setShowTrackLibrary(false);
          setShowWizard(true);
        }}
        onTrackSelect={(track) => {
          if (selectionMode) {
            setSelectedTrackUrls((prev) => {
              if (prev.includes(track.url)) return prev.filter((u) => u !== track.url);
              if (prev.length >= 3) return [...prev.slice(1), track.url];
              return [...prev, track.url];
            });
          } else {
            handleTrackChange(track.url, track.name);
            setShowTrackLibrary(false);
          }
        }}
      />

      <SaveProfileModal
        show={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        saveNameInput={saveNameInput}
        setSaveNameInput={setSaveNameInput}
        handleSaveProfileLocal={handleSaveProfileLocal}
        profileName={profileName}
      />
    </main>
  );
}
