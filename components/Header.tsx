'use client';

import React from 'react';
import { motion } from 'motion/react';
import {
  Activity, Undo2, Redo2, FolderOpen, Save, Download, Upload, Sparkles, LayoutDashboard, Target,
} from 'lucide-react';
import { InfoTooltip } from './InfoTooltip';
import { Divider, IconBtn } from './Shared';

interface HeaderProps {
  profileName: string | null;
  calibrationConfidence: number;
  interactionCount: number;
  stability: number;
  isAICalibrated: boolean;
  profileColor: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onShowProfilePanel: () => void;
  onShowSaveDialog: () => void;
  onShowExportDialog: () => void;
  onImportClick: () => void;
  onAICalibrate: () => void;
  onQuickCalibrate: () => void;
  showAnalysisSidebar: boolean;
  setShowAnalysisSidebar: (show: boolean) => void;
  savedProfilesCount: number;
}

export function Header({
  profileName,
  calibrationConfidence,
  interactionCount,
  stability,
  isAICalibrated,
  profileColor,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onShowProfilePanel,
  onShowSaveDialog,
  onShowExportDialog,
  onImportClick,
  onAICalibrate,
  onQuickCalibrate,
  showAnalysisSidebar,
  setShowAnalysisSidebar,
  savedProfilesCount,
}: HeaderProps) {
  return (
    <header className="sticky top-2 md:top-4 z-30 sonic-glass rounded-2xl px-3 md:px-5 py-2 md:py-3 flex flex-wrap items-center justify-between gap-y-2 gap-x-2 mb-4 md:mb-5 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        <div className="relative w-8 h-8 md:w-9 md:h-9 rounded-xl bg-gradient-to-tr from-[#F27D26] to-[#FF4444] flex items-center justify-center shadow-[0_6px_18px_rgba(242,125,38,0.45)] flex-shrink-0">
          <Activity className="w-4 h-4 md:w-5 md:h-5 text-black" />
        </div>
        <div className="min-w-0">
          <div className="text-[9px] md:text-[10px] font-mono text-[#8E9299] uppercase tracking-widest leading-none">
            SONIC AI <span className="text-white/60">v1.1</span>
          </div>
          <div className="text-xs md:text-sm font-bold tracking-tight text-white truncate flex items-center gap-2">
            {profileName || 'Untitled Session'}
            
            {calibrationConfidence > 0 && (
              <div className="flex items-center gap-2 md:gap-3 ml-1 md:ml-2 border-l border-white/10 pl-2 md:pl-3">
                <div className="flex flex-col gap-0.5 md:gap-1">
                  <div className="flex items-center gap-1 md:gap-1.5">
                    <Sparkles className="w-2 md:w-2.5 h-2 md:h-2.5 text-[#F27D26]" />
                    <span className="text-[8px] md:text-[9px] font-bold text-white/50 uppercase tracking-widest hidden sm:inline">
                      Confidence
                    </span>
                    <span className="text-[9px] md:text-[10px] font-black text-[#F27D26]">
                      {Math.round(calibrationConfidence * 100)}%
                    </span>
                  </div>
                  <div className="w-16 md:w-28 h-1 bg-white/10 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${calibrationConfidence * 100}%` }}
                      className="h-full bg-gradient-to-r from-[#F27D26] to-[#FF4444]"
                    />
                  </div>
                </div>
              </div>
            )}

            {interactionCount > 0 && (
              <div className="flex items-center gap-3 ml-2 border-l border-white/10 pl-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <Target className="w-2.5 h-2.5 text-blue-400" />
                    <span className="text-[9px] font-bold text-white/50 uppercase tracking-widest hidden xs:inline">
                      Tracking
                    </span>
                    <span className={`text-[10px] font-black ${
                      stability < 0.4 ? 'text-red-400' : 
                      stability < 0.7 ? 'text-yellow-400' : 'text-green-400'
                    }`}>
                      {Math.round(stability * 100)}%
                    </span>
                    <InfoTooltip 
                      side="bottom" 
                      align="center" 
                      content={
                        stability < 0.4 ? 'Cần thêm dữ liệu nghe thực tế để cá nhân hoá chuyên sâu.' :
                        stability < 0.7 ? 'AI đang bắt đầu hiểu EQ lý tưởng của bạn.' :
                        'Profile đã đạt độ ổn định cao dựa trên thói quen nghe của bạn.'
                      } 
                    />
                  </div>
                  <div className="w-20 md:w-28 h-1 bg-white/10 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${stability * 100}%` }}
                      className={`h-full ${
                        stability < 0.4 ? 'bg-red-500' : 
                        stability < 0.7 ? 'bg-yellow-500' : 'bg-green-400'
                      }`}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        {isAICalibrated && (
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-full border ml-1"
            style={{ background: profileColor + '15', borderColor: profileColor + '40' }}
          >
            <Sparkles className="w-2.5 h-2.5" style={{ color: profileColor }} />
            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: profileColor }}>
              AI Tuned
            </span>
          </motion.div>
        )}
      </div>

      <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
        <IconBtn onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <Undo2 className="w-4 h-4" />
        </IconBtn>
        <IconBtn onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          <Redo2 className="w-4 h-4" />
        </IconBtn>

        <Divider />

        <IconBtn onClick={onShowProfilePanel} title="Profile Library" badge={savedProfilesCount > 0}>
          <FolderOpen className="w-4 h-4" />
        </IconBtn>
        <IconBtn
          onClick={onShowSaveDialog}
          title="Save profile (Ctrl+S)"
          hideOnMobile
        >
          <Save className="w-4 h-4" />
        </IconBtn>
        <IconBtn
          onClick={onShowExportDialog}
          title="Export EQ (Ctrl+E)"
        >
          <Download className="w-4 h-4" />
        </IconBtn>
        <IconBtn
          onClick={onImportClick}
          title="Import EqualizerAPO / JSON"
          hideOnMobile
        >
          <Upload className="w-4 h-4" />
        </IconBtn>

        <Divider />

        <button
          onClick={onAICalibrate}
          className="px-3 md:px-4 py-1.5 md:py-2 bg-[#F27D26]/15 hover:bg-[#F27D26]/25 text-[#F27D26] rounded-full text-[10px] md:text-xs font-mono uppercase tracking-widest border border-[#F27D26]/30 transition-all flex items-center gap-1.5 md:gap-2"
          title="Pick 1-3 tracks for the AI test, then start"
        >
          <Sparkles className="w-3 h-3" />
          <span className="hidden sm:inline">AI Calibrate</span>
          <span className="sm:hidden">AI</span>
        </button>
        <button
          onClick={onQuickCalibrate}
          className="hidden md:inline-flex px-2 py-2 bg-white/5 hover:bg-white/10 text-[#8E9299] hover:text-white rounded-full text-[10px] font-mono uppercase tracking-widest border border-white/5 transition-all items-center"
          title="Quick calibrate with the current track only"
        >
          Quick
        </button>

        <IconBtn
          onClick={() => setShowAnalysisSidebar(!showAnalysisSidebar)}
          title={showAnalysisSidebar ? "Hide Analysis" : "Show Analysis"}
          className={`${showAnalysisSidebar ? 'bg-[#F27D26]/20 text-[#F27D26]' : ''}`}
        >
          <LayoutDashboard className="w-4 h-4" />
        </IconBtn>
      </div>
    </header>
  );
}

