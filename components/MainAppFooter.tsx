'use client'

import React from 'react'

interface MainAppFooterProps {
  errorHeader: string | null
  lastSync: string | null
}

export const MainAppFooter: React.FC<MainAppFooterProps> = ({ errorHeader, lastSync }) => {
  return (
    <footer className="mt-6 sonic-glass rounded-2xl px-4 py-3 flex flex-col gap-2">
      {errorHeader && (
        <div className="text-[10px] font-mono text-red-400 uppercase tracking-widest flex items-center gap-2">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          {errorHeader}
        </div>
      )}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1 text-[10px] font-mono text-[#8E9299] uppercase tracking-widest">
        <div>WebAudio 2.0 · Biquad Exact · AI v3 Local</div>
        <div>PEQ Calibration · Last Sync: {lastSync || 'Initializing...'}</div>
      </div>
    </footer>
  )
}
