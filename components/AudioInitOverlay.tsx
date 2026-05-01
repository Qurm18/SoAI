'use client';

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, ArrowRight, Sliders, Sparkles } from 'lucide-react';

interface AudioInitOverlayProps {
  isReady: boolean;
  onInit: () => void;
}

export function AudioInitOverlay({ isReady, onInit }: AudioInitOverlayProps) {
  return (
    <AnimatePresence>
      {!isReady && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#07080a] p-6"
        >
          <div className="text-center space-y-12 max-w-sm w-full relative">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', damping: 18, stiffness: 200 }}
              className="relative w-24 h-24 mx-auto"
            >
              <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-tr from-[#F27D26] to-[#FF4444] shadow-[0_20px_50px_rgba(242,125,38,0.45)]" />
              <div className="absolute inset-0 rounded-[2rem] sonic-pulse bg-[#F27D26]/40" />
              <div className="relative w-full h-full flex items-center justify-center">
                <Activity className="w-12 h-12 text-white" />
              </div>
            </motion.div>

            <div className="space-y-4">
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="text-3xl font-black text-white uppercase tracking-tighter italic"
              >
                SONIC<span className="text-[#F27D26]">AI</span>
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-[#8E9299] text-sm font-medium leading-relaxed"
              >
                High-fidelity PEQ Engine with Intelligent Calibration.<br />
                Tap to initialize the processing core.
              </motion.p>
            </div>

            <motion.button
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              onClick={onInit}
              className="group relative w-full overflow-hidden rounded-2xl bg-white p-5 font-bold uppercase tracking-widest text-black transition-all hover:scale-[1.02] active:scale-95 shadow-[0_10px_30px_rgba(255,255,255,0.1)]"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                Ignite Engine <ArrowRight className="w-4 h-4" />
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500" />
            </motion.button>

            <div className="pt-8 flex justify-center gap-6 opacity-30">
              <Sliders className="w-5 h-5" />
              <Sparkles className="w-5 h-5" />
              <Activity className="w-5 h-5" />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
