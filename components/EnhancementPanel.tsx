'use client';

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { EnhancementParams, DEFAULT_ENHANCEMENT } from '@/lib/audio-engine';

interface EnhancementPanelProps {
  showEnhancement: boolean;
  setShowEnhancement: (val: boolean | ((v: boolean) => boolean)) => void;
  enhancement: EnhancementParams;
  setEnhancement: (val: EnhancementParams) => void;
  onEnhancementChange: (params: Partial<EnhancementParams>) => void;
}

export function EnhancementPanel({
  showEnhancement,
  setShowEnhancement,
  enhancement,
  setEnhancement,
  onEnhancementChange,
}: EnhancementPanelProps) {
  return (
    <div className="lg:col-span-2 sonic-glass rounded-2xl overflow-visible border border-white/5">
      <button
        onClick={() => setShowEnhancement(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-all rounded-t-2xl"
      >
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${enhancement.losslessMode ? 'bg-cyan-400 animate-pulse' : 'bg-[#F27D26] animate-pulse'}`} />
          <span className="text-[10px] font-mono text-[#8E9299] uppercase tracking-widest font-bold">Acoustic Enhancement</span>
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${enhancement.losslessMode ? 'bg-cyan-500/20 text-cyan-400' : 'bg-orange-500/20 text-orange-400'}`}>
            {enhancement.losslessMode ? 'BIT-PERFECT' : 'ENHANCED'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2">
            {enhancement.exciterAmount > 0 && <span className="text-[8px] font-mono text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">Exciter</span>}
            {enhancement.bassEnhance > 0 && <span className="text-[8px] font-mono text-cyan-400/80 bg-cyan-400/10 px-1.5 py-0.5 rounded border border-cyan-400/20">Bass</span>}
          </div>
          <ChevronDown className={`w-4 h-4 text-[#8E9299] transition-transform ${showEnhancement ? 'rotate-180' : ''}`} />
        </div>
      </button>
      
      <AnimatePresence>
        {showEnhancement && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-visible"
            style={{ overflow: 'visible' }}
          >
            <div className="px-5 pb-5 pt-2 space-y-5 border-t border-white/5 bg-white/[0.01]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
                {/* Lossless mode toggle */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-cyan-400/5 border border-cyan-400/10">
                  <div>
                    <div className="text-[10px] font-bold text-cyan-400/90 uppercase tracking-tight">Bit-Perfect Mode</div>
                    <div className="text-[8px] font-mono text-[#8E9299]">Bypass OS limits · 0.0dB Gain Drift</div>
                  </div>
                  <button
                    onClick={() => onEnhancementChange({ losslessMode: !enhancement.losslessMode })}
                    className={`relative w-10 h-5 rounded-full transition-all ${enhancement.losslessMode ? 'bg-cyan-500' : 'bg-white/10'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow-md ${enhancement.losslessMode ? 'left-5.5' : 'left-0.5'}`} />
                  </button>
                </div>

                {/* Soft Clip */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-bold text-white/70 uppercase">Analog Saturation</span>
                    <span className="text-[9px] font-mono text-[#F27D26]">{enhancement.outputCeiling.toFixed(1)} dBFS</span>
                  </div>
                  <input type="range" min="-3" max="-0.1" step="0.1"
                    value={enhancement.outputCeiling}
                    onChange={e => onEnhancementChange({ outputCeiling: parseFloat(e.target.value) })}
                    className="w-full h-1 accent-[#F27D26] cursor-pointer" />
                </div>

                {/* Exciter */}
                <div className="space-y-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-amber-400 uppercase">Harmonic Exciter</span>
                    <span className="text-[9px] font-mono text-amber-400">{(enhancement.exciterAmount * 100).toFixed(0)}%</span>
                  </div>
                  <input type="range" min="0" max="0.6" step="0.01"
                    value={enhancement.exciterAmount}
                    onChange={e => onEnhancementChange({ exciterAmount: parseFloat(e.target.value) })}
                    className="w-full h-1 accent-amber-400 cursor-pointer" />
                  <div className="flex items-center justify-between text-[8px] font-mono text-[#8E9299]">
                    <span>HPF: {enhancement.exciterFreq}Hz</span>
                    <input type="range" min="1500" max="6000" step="100"
                      value={enhancement.exciterFreq}
                      onChange={e => onEnhancementChange({ exciterFreq: parseFloat(e.target.value) })}
                      className="w-24 h-0.5 accent-[#8E9299]" />
                  </div>
                </div>

                {/* Bass */}
                <div className="space-y-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-cyan-400 uppercase">Sub-Bass Synthesizer</span>
                    <span className="text-[9px] font-mono text-cyan-400">{(enhancement.bassEnhance * 100).toFixed(0)}%</span>
                  </div>
                  <input type="range" min="0" max="0.8" step="0.01"
                    value={enhancement.bassEnhance}
                    onChange={e => onEnhancementChange({ bassEnhance: parseFloat(e.target.value) })}
                    className="w-full h-1 accent-cyan-400 cursor-pointer" />
                  <div className="flex items-center justify-between text-[8px] font-mono text-[#8E9299]">
                    <span>Cutoff: {enhancement.bassEnhanceFreq}Hz</span>
                    <input type="range" min="40" max="160" step="5"
                      value={enhancement.bassEnhanceFreq}
                      onChange={e => onEnhancementChange({ bassEnhanceFreq: parseFloat(e.target.value) })}
                      className="w-24 h-0.5 accent-[#8E9299]" />
                  </div>
                </div>
              </div>

              {/* Wide & Crossfeed in full width */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-2">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-bold text-white/70 uppercase">Stereo Width Tool</span>
                    <span className="text-[9px] font-mono text-purple-400">{Math.round(enhancement.stereoWidth * 100)}%</span>
                  </div>
                  <input type="range" min="0" max="2" step="0.05"
                    value={enhancement.stereoWidth}
                    onChange={e => onEnhancementChange({ stereoWidth: parseFloat(e.target.value) })}
                    className="w-full h-1 accent-purple-400 cursor-pointer" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-bold text-white/70 uppercase">Headphone Crossfeed</span>
                    <span className="text-[9px] font-mono text-indigo-400">{Math.round(enhancement.crossFeed * 100)}%</span>
                  </div>
                  <input type="range" min="0" max="1" step="0.01"
                    value={enhancement.crossFeed}
                    onChange={e => onEnhancementChange({ crossFeed: parseFloat(e.target.value) })}
                    className="w-full h-1 accent-indigo-400 cursor-pointer" />
                </div>
              </div>

              {/* Footer Actions */}
              <div className="flex items-center justify-between pt-3 border-t border-white/5">
                <div className="flex items-center gap-4">
                   <div className="flex items-center gap-2">
                      <span className="text-[8px] font-mono text-[#8E9299] uppercase">64-bit Core</span>
                      <div className={`w-1.5 h-1.5 rounded-full ${enhancement.highQualityMode ? 'bg-green-400 shadow-[0_0_8px_#4ade80]' : 'bg-white/10'}`} />
                   </div>
                </div>
                <button
                  onClick={() => setEnhancement({ ...DEFAULT_ENHANCEMENT })}
                  className="text-[9px] font-mono text-[#8E9299] hover:text-white uppercase tracking-widest flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
