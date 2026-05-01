'use client'

import React from 'react'
import { Sliders, Save } from 'lucide-react'

interface EQSectionHeaderProps {
  profileGenre: string | null
  profileName: string | null
  handleReset: () => void
  setSaveNameInput: (name: string) => void
  setShowSaveDialog: (show: boolean) => void
}

export const EQSectionHeader: React.FC<EQSectionHeaderProps> = ({
  profileGenre,
  profileName,
  handleReset,
  setSaveNameInput,
  setShowSaveDialog,
}) => {
  return (
    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-[#F27D26]/10 text-[#F27D26]">
            <Sliders className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/90">
            Precision PEQ Control
          </h3>
        </div>
        {profileGenre && (
          <span className="hidden md:inline text-[10px] text-[#8E9299] font-mono uppercase bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
            · {profileGenre.split(' · ')[0]}
          </span>
        )}
      </div>
      
      <div className="flex items-center gap-2">
        <button
          onClick={handleReset}
          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-mono uppercase tracking-widest text-[#8E9299] hover:text-white transition-all border border-white/5"
        >
          Reset Engine
        </button>
        <button
          onClick={() => { setSaveNameInput(profileName || ''); setShowSaveDialog(true); }}
          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-mono uppercase tracking-widest text-[#8E9299] hover:text-white transition-all border border-white/5 flex items-center gap-1.5"
        >
          <Save className="w-3.5 h-3.5" />
          Save Session
        </button>
      </div>
    </div>
  )
}
