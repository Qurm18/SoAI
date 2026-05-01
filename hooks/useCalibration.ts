import { useState, useCallback } from 'react';
import { TasteResult, ChoiceReason, ScenarioChoiceAnalysis } from '@/lib/ai-engine';

export function useCalibration() {
  const [showWizard, setShowWizard] = useState(false);
  const [isAICalibrated, setIsAICalibrated] = useState(false);
  const [calibrationConfidence, setCalibrationConfidence] = useState<number>(0);
  const [taste, setTaste] = useState<TasteResult | null>(null);
  const [reasons, setReasons] = useState<ChoiceReason[]>([]);
  const [scenarioCounts, setScenarioCounts] = useState<Record<string, { A: number; B: number; dislikeBoth: number }>>({});
  const [scenarioAnalysis, setScenarioAnalysis] = useState<ScenarioChoiceAnalysis[]>([]);
  const [aiInsights, setAiInsights] = useState<string[]>([]);
  
  // Selection mode for picking tracks before calibration
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTrackUrls, setSelectedTrackUrls] = useState<string[]>([]);

  const handleCalibrationComplete = useCallback((result: {
    taste?: TasteResult;
    reasons?: ChoiceReason[];
    scenarioCounts?: Record<string, { A: number; B: number; dislikeBoth: number }>;
    scenarioAnalysis?: ScenarioChoiceAnalysis[];
    confidenceScore: number;
    insights?: string[];
  }) => {
    setTaste(result.taste ?? null);
    setCalibrationConfidence(result.confidenceScore);
    setReasons(result.reasons ?? []);
    setScenarioCounts(result.scenarioCounts ?? {});
    setScenarioAnalysis(result.scenarioAnalysis ?? []);
    setAiInsights(result.insights ?? []);
    setIsAICalibrated(true);
    setShowWizard(false);
  }, []);

  return {
    showWizard,
    setShowWizard,
    isAICalibrated,
    setIsAICalibrated,
    calibrationConfidence,
    setCalibrationConfidence,
    taste,
    setTaste,
    reasons,
    setReasons,
    scenarioCounts,
    setScenarioCounts,
    scenarioAnalysis,
    setScenarioAnalysis,
    aiInsights,
    setAiInsights,
    selectionMode,
    setSelectionMode,
    selectedTrackUrls,
    setSelectedTrackUrls,
    handleCalibrationComplete,
  };
}
