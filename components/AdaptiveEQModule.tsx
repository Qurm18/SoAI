'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Activity, Sparkles } from 'lucide-react';

interface AdaptiveEQModuleProps {
  isAdaptiveMode: boolean;
  setIsAdaptiveMode: (val: boolean) => void;
  stability: number;
  sectionType: string;
  setSectionType: (val: 'intro' | 'verse' | 'chorus' | 'drop' | 'outro') => void;
  profileName: string | null;
}

export function AdaptiveEQModule({
  isAdaptiveMode,
  setIsAdaptiveMode,
  stability,
  sectionType,
  setSectionType,
  profileName,
}: AdaptiveEQModuleProps) {
  return (
    <div className="sonic-glass rounded-2xl p-5 border border-white/5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#F27D26]/10 text-[#F27D26]">
            <Sparkles className="w-4 h-4" />
          </div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/90">Neural Engine</h3>
        </div>
        <button
          onClick={() => setIsAdaptiveMode(!isAdaptiveMode)}
          className={`w-8 h-4 rounded-full relative transition-all ${isAdaptiveMode ? 'bg-[#F27D26]' : 'bg-white/10'}`}
        >
          <motion.div
            animate={{ x: isAdaptiveMode ? 16 : 2 }}
            initial={false}
            className="absolute top-1 w-2 h-2 bg-white rounded-full shadow-sm"
          />
        </button>
      </div>

      {isAdaptiveMode ? (
        <div className="flex flex-col gap-4 h-full">
          <div className="p-3 rounded-xl bg-white/5 border border-white/5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-[9px] font-mono text-[#8E9299] uppercase">Adapt Stability</span>
              <span className="text-[9px] font-mono text-[#F27D26]">{(stability * 100).toFixed(0)}%</span>
            </div>
            <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${stability * 100}%` }}
                className="h-full bg-gradient-to-r from-[#F27D26] to-[#FF4444]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/5">
              <div className="text-[8px] font-mono text-[#8E9299] uppercase mb-1">Current Role</div>
              <select
                value={sectionType}
                onChange={(e) => setSectionType(e.target.value as any)}
                className="w-full bg-transparent text-[10px] font-mono text-white outline-none cursor-pointer"
              >
                <option value="intro" className="bg-[#07080a]">Intro</option>
                <option value="verse" className="bg-[#07080a]">Verse</option>
                <option value="chorus" className="bg-[#07080a]">Chorus</option>
                <option value="drop" className="bg-[#07080a]">Drop</option>
                <option value="outro" className="bg-[#07080a]">Outro</option>
              </select>
            </div>
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/5">
              <div className="text-[8px] font-mono text-[#8E9299] uppercase mb-1">Neural Core</div>
              <div className="text-[10px] font-mono text-green-400 flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-green-400 animate-pulse" />
                Active
              </div>
            </div>
          </div>

          <div className="mt-auto p-3 rounded-xl bg-[#F27D26]/10 border border-[#F27D26]/20">
            <p className="text-[9px] text-[#F9B47A] leading-relaxed italic">
              &ldquo;AI is optimizing spectral weight based on {profileName || 'your preferences'}.&rdquo;
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3 opacity-40">
           <Activity className="w-8 h-8 text-[#8E9299]" />
           <div className="text-[10px] font-mono uppercase tracking-widest">Neural Loop Disabled</div>
        </div>
      )}
    </div>
  );
}
