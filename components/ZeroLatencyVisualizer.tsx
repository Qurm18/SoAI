'use client';

import React, { useEffect, useRef, useState } from 'react';

interface ZeroLatencyVisualizerProps {
  pipelineInfo?: {
    actualSampleRate: number;
    targetSampleRate: number;
    isResampled: boolean;
  };
}

export const ZeroLatencyVisualizer: React.FC<ZeroLatencyVisualizerProps> = ({ pipelineInfo }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const attachedRef = useRef(false);

  useEffect(() => {
    if (canvasRef.current && !attachedRef.current) {
        const engine = (window as any).__ENGINE__;
        if (engine) {
            engine.attachVisualizer(canvasRef.current);
            attachedRef.current = true;
        }
    }
  }, []);

  return (
    <div className="w-full bg-[#08080f] rounded-xl border border-white/8 overflow-hidden flex flex-col h-[225px]">
      <div className="flex justify-between items-center px-4 py-2 border-b border-white/5 text-[10px] font-mono text-gray-400">
        <div className="flex gap-4">
           <span className="font-bold text-[#F27D26] uppercase tracking-wider">Zero-Latency Scope</span>
           <span>Offscreen Worker</span>
        </div>
        {pipelineInfo && (
           <div className={`px-2 py-0.5 rounded ${pipelineInfo.isResampled ? 'bg-orange-900/30 text-orange-400' : 'bg-green-900/30 text-green-400'}`}>
             {pipelineInfo.isResampled ? `Resampled: ${pipelineInfo.actualSampleRate}Hz (OS)` : `Bit-Perfect: ${pipelineInfo.actualSampleRate}Hz`}
           </div>
        )}
      </div>

      <canvas ref={canvasRef} width={1200} height={180} className="w-full h-full block bg-black" />
    </div>
  );
};
