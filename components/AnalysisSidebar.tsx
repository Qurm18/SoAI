'use client';

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, ArrowRight, List, Sparkles, Download } from 'lucide-react';
import { ScenarioChoiceAnalysis, TasteResult, ChoiceReason } from '@/lib/ai-engine';

interface AnalysisSidebarProps {
  showAnalysisSidebar: boolean;
  urlInput: string;
  setUrlInput: (val: string) => void;
  onUrlSubmit: (e: React.FormEvent) => void;
  onShowTrackLibrary: () => void;
  tracksCount: number;
  taste: TasteResult | null;
  scenarioAnalysis: ScenarioChoiceAnalysis[];
  reasons: ChoiceReason[];
  aiInsights: string[];
  onShowExportDialog: () => void;
}

export function AnalysisSidebar({
  showAnalysisSidebar,
  urlInput,
  setUrlInput,
  onUrlSubmit,
  onShowTrackLibrary,
  tracksCount,
  taste,
  scenarioAnalysis,
  reasons,
  aiInsights,
  onShowExportDialog,
}: AnalysisSidebarProps) {
  return (
    <AnimatePresence>
      {showAnalysisSidebar && (
        <motion.aside
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          className="lg:col-span-4 flex flex-col gap-4 md:gap-5 h-full"
        >
          <div className="sonic-glass rounded-2xl p-5 flex flex-col gap-5 h-full">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono text-[#8E9299] uppercase tracking-widest">Stream Source</span>
                <Activity className="w-4 h-4 text-[#F27D26]" />
              </div>
              <form onSubmit={onUrlSubmit} className="space-y-2">
                <div className="relative">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="Paste direct FLAC / WAV / MP3 / OGG URL..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-xs font-mono focus:border-[#F27D26]/60 outline-none transition-all pr-10 text-white placeholder-white/25"
                  />
                  <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#F27D26] hover:scale-110 transition-transform">
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </form>
              <button
                onClick={onShowTrackLibrary}
                className="mt-3 w-full py-2 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-mono uppercase tracking-widest text-[#8E9299] hover:text-white transition-all flex items-center justify-center gap-2"
              >
                <List className="w-3 h-3" />
                Browse Track Library ({tracksCount} tracks)
              </button>
            </div>

            {/* Listener Taste + Why panel (v3.2 — compact) */}
            {taste && taste.top.length > 0 && (
              <div className="border-t border-white/5 pt-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-mono text-[#8E9299] uppercase tracking-widest">Listener Taste</span>
                  <span className="text-[9px] font-mono text-[#F27D26]">v3.2</span>
                </div>

                {/* Top match — full card with bar + Vietnamese description */}
                <motion.div
                  key={taste.top[0].id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white/5 border border-[#F27D26]/40 rounded-lg px-3 py-2 mb-2"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold tracking-tight text-[#F27D26]">
                      {taste.top[0].label}
                    </span>
                    <span className="text-[10px] font-mono text-[#8E9299]">
                      {Math.round(taste.top[0].score * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-1 bg-black/40 rounded-full overflow-hidden mb-1.5">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${taste.top[0].score * 100}%` }}
                      transition={{ delay: 0.15, duration: 0.6 }}
                      className="h-full bg-gradient-to-r from-[#F27D26] to-[#FF6F3C]"
                    />
                  </div>
                  <p className="text-[10px] text-[#8E9299] italic leading-snug">
                    {taste.top[0].descriptionVi}
                  </p>
                </motion.div>

                {/* Runners-up — inline pills (compact) */}
                {taste.top.length > 1 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {taste.top.slice(1).map((t) => (
                      <span
                        key={t.id}
                        title={t.descriptionVi}
                        className="text-[9px] font-mono uppercase tracking-wider bg-white/5 border border-white/10 rounded-full px-2 py-0.5 text-[#bfc4cc]"
                      >
                        {t.label} · {Math.round(t.score * 100)}%
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ─── A/B Decision Analysis panel (v4 — per-scenario deep reasoning) ─── */}
            {scenarioAnalysis.length > 0 && (
              <div className="border-t border-white/5 pt-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-mono text-[#8E9299] uppercase tracking-widest">
                    Tại sao bạn chọn A hay B?
                  </span>
                  <span className="text-[9px] font-mono text-[#F27D26]">v4 · per-scenario</span>
                </div>
                <div className="space-y-2">
                  {scenarioAnalysis.slice(0, 6).map((sa, idx) => {
                    const totalTrials = sa.choiceA + sa.choiceB;
                    const winColor = sa.winner === 'tie'
                      ? 'text-[#8E9299]'
                      : 'text-[#F27D26]';
                    const barWidthA = totalTrials > 0 ? (sa.choiceA / totalTrials) * 100 : 50;
                    const barWidthB = totalTrials > 0 ? (sa.choiceB / totalTrials) * 100 : 50;
                    const confPct = Math.round(sa.winnerConfidence * 100);
                    return (
                      <motion.div
                        key={sa.scenario}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.07 }}
                        className="bg-white/4 border border-white/10 rounded-xl px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between mb-1.5 gap-2">
                          <span className="text-[10px] font-bold text-white/90 leading-tight">
                            {sa.scenarioLabel}
                          </span>
                          <span className={`text-[9px] font-mono uppercase tracking-wider shrink-0 ${winColor}`}>
                            {sa.winner === 'tie' ? 'Tie' : `${sa.winner} thắng · ${confPct}%`}
                          </span>
                        </div>

                        <div className="flex h-1.5 w-full rounded-full overflow-hidden mb-2 gap-px">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${barWidthA}%` }}
                            transition={{ delay: 0.1 + idx * 0.07, duration: 0.45 }}
                            className="h-full bg-[#F27D26]/80"
                            title={`A: ${sa.choiceA}×`}
                          />
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${barWidthB}%` }}
                            transition={{ delay: 0.1 + idx * 0.07, duration: 0.45 }}
                            className="h-full bg-[#7AC0FF]/70"
                            title={`B: ${sa.choiceB}×`}
                          />
                        </div>
                        <div className="flex justify-between text-[8.5px] font-mono text-[#8E9299] mb-2">
                          <span className="text-[#F27D26]/90">A: {sa.choiceA}×</span>
                          <span className="text-[#8E9299]/60 text-center flex-1 truncate px-1" title={sa.perceptualLabel}>
                            {sa.dominantBandLabel} · {sa.region}
                          </span>
                          <span className="text-[#7AC0FF]/90">B: {sa.choiceB}×</span>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5 mb-2">
                          <div className={`rounded-lg px-2 py-1.5 text-[8.5px] leading-snug border ${sa.winner === 'A' ? 'bg-[#F27D26]/10 border-[#F27D26]/30 text-[#F9B47A]' : 'bg-white/3 border-white/8 text-[#8E9299]'}`}>
                            <div className="font-bold mb-0.5 text-[9px] uppercase tracking-wider opacity-70">A</div>
                            {sa.whyA.split('; ')[0]}
                          </div>
                          <div className={`rounded-lg px-2 py-1.5 text-[8.5px] leading-snug border ${sa.winner === 'B' ? 'bg-[#7AC0FF]/10 border-[#7AC0FF]/30 text-[#A8D8FF]' : 'bg-white/3 border-white/8 text-[#8E9299]'}`}>
                            <div className="font-bold mb-0.5 text-[9px] uppercase tracking-wider opacity-70">B</div>
                            {sa.whyB.split('; ')[0]}
                          </div>
                        </div>

                        <p className="text-[8.5px] text-[#8E9299]/80 italic leading-snug">
                          {sa.conclusion}
                        </p>
                      </motion.div>
                    );
                  })}
                </div>
                {reasons.length > 0 && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    <div className="text-[9px] font-mono text-[#8E9299]/60 uppercase tracking-widest mb-2">Dải tần nổi bật</div>
                    <div className="flex flex-wrap gap-1.5">
                      {reasons.slice(0, 5).map((r) => {
                        const sign = r.direction === 'boost' ? '+' : '−';
                        const col = r.direction === 'boost' ? 'text-[#F27D26] border-[#F27D26]/30 bg-[#F27D26]/8' : 'text-[#7AC0FF] border-[#7AC0FF]/30 bg-[#7AC0FF]/8';
                        return (
                          <span
                            key={r.bandIdx}
                            title={`${r.votes}/${r.trials}× · ${Math.round(r.agreement * 100)}% agreement`}
                            className={`text-[9px] font-mono border rounded-full px-2 py-0.5 ${col}`}
                          >
                            {r.bandLabel} {sign}{Math.abs(r.avgDeltaDb).toFixed(1)}dB
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-white/5 pt-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono text-[#8E9299] uppercase tracking-widest">Neural Insights</span>
                <Sparkles className="w-4 h-4 text-[#F27D26]" />
              </div>
              <div className="space-y-2">
                {aiInsights.length > 0 ? (
                  aiInsights.map((insight, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ x: -10, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: idx * 0.15 }}
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[10.5px] text-[#bfc4cc] italic leading-relaxed"
                    >
                      &ldquo;{insight}&rdquo;
                    </motion.div>
                  ))
                ) : (
                  <p className="text-[10px] text-[#8E9299]/60 italic leading-relaxed">
                    Calibrate the neural core to unlock track-specific tuning insights.
                  </p>
                )}
              </div>
            </div>

            <button
              onClick={onShowExportDialog}
              className="mt-6 w-full py-3 bg-gradient-to-r from-[#F27D26] to-[#FF6F3C] hover:opacity-95 rounded-xl text-xs font-mono uppercase tracking-widest font-bold text-black transition-all flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(242,125,38,0.35)]"
            >
              <Download className="w-4 h-4" />
              Export EQ Profile
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
