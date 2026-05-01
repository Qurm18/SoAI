'use client'

import React from 'react'
import { motion } from 'motion/react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'

interface HearingProtectionIndicatorProps {
  risk: {
    warning: string | null
    riskScore: number
  }
}

export const HearingProtectionIndicator: React.FC<HearingProtectionIndicatorProps> = ({ risk }) => {
  if (!risk.warning) {
    return (
      <div className="p-5 rounded-2xl border border-green-500/20 bg-green-500/5 text-green-400/70 flex flex-col items-center justify-center gap-2">
         <ShieldCheck className="w-6 h-6" />
         <span className="text-[9px] font-mono uppercase tracking-widest font-bold">Secure Signal Levels</span>
      </div>
    )
  }

  return (
    <div className={`p-5 rounded-2xl border flex flex-col gap-3 justify-center ${
      risk.riskScore >= 100 
        ? 'bg-red-500/10 border-red-500/30 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.1)]' 
        : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
    }`}>
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 flex-shrink-0" />
        <span className="font-bold text-[11px] uppercase tracking-widest">Health Monitor</span>
      </div>
      <div className="space-y-1">
        <div className="text-[10px] leading-relaxed font-medium">Aural Strain: {risk.riskScore.toFixed(0)}%</div>
        <p className="text-[9px] leading-relaxed opacity-80 italic">&ldquo;{risk.warning}&rdquo;</p>
      </div>
      <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
         <motion.div 
           animate={{ width: `${Math.min(100, risk.riskScore)}%` }}
           className={`h-full ${risk.riskScore >= 100 ? 'bg-red-500' : 'bg-yellow-500'}`}
         />
      </div>
    </div>
  )
}
