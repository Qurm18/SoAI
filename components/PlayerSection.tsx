'use client';

import React from 'react';
import { Music, SkipBack, Pause, Play, SkipForward, Volume2 } from 'lucide-react';
import { AUDIO_ACCEPT_ATTR } from '@/lib/device-inspector';

interface PlayerSectionProps {
  currentTrackName: string;
  isPlaying: boolean;
  onBrowseLibrary: () => void;
  onRewImport: () => void;
  onFileUploadClick: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPrevTrack: () => void;
  onTogglePlayback: () => void;
  onNextTrack: () => void;
  volume: number;
  onVolumeChange: (val: number) => void;
}

export function PlayerSection({
  currentTrackName,
  isPlaying,
  onBrowseLibrary,
  onRewImport,
  onFileUploadClick,
  fileInputRef,
  handleFileUpload,
  onPrevTrack,
  onTogglePlayback,
  onNextTrack,
  volume,
  onVolumeChange,
}: PlayerSectionProps) {
  return (
    <div className="sonic-glass rounded-2xl p-4 md:p-5 flex flex-col md:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-4 w-full md:w-auto min-w-0">
        <div className="relative w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
          <Music className="w-6 h-6 text-[#8E9299]" />
          {isPlaying && (
            <div className="absolute inset-0 bg-gradient-to-tr from-[#F27D26]/30 to-transparent" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white truncate">{currentTrackName}</div>
          <div className="flex gap-3 mt-1">
            <button
              onClick={onBrowseLibrary}
              className="text-[10px] text-[#F27D26] font-mono uppercase tracking-widest hover:underline"
            >
              + Browse Library
            </button>
            <button
              onClick={onRewImport}
              className="text-[10px] text-orange-400 font-mono uppercase tracking-widest hover:text-orange-300 hover:underline"
            >
              REW Import
            </button>
            <button
              onClick={onFileUploadClick}
              className="text-[10px] text-[#8E9299] font-mono uppercase tracking-widest hover:text-white hover:underline"
            >
              Import File
            </button>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept={AUDIO_ACCEPT_ATTR}
            multiple
            className="hidden"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 md:gap-6 justify-center w-full md:w-auto">
        <div className="flex items-center gap-3">
          <button onClick={onPrevTrack} className="text-[#8E9299] hover:text-white transition-colors p-2">
            <SkipBack className="w-5 h-5" />
          </button>
          <button
            onClick={onTogglePlayback}
            className="relative w-12 h-12 md:w-14 md:h-14 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-[0_8px_24px_rgba(255,255,255,0.18)]"
          >
            {isPlaying && (
              <span className="absolute inset-0 rounded-full sonic-pulse bg-[#F27D26]/40" />
            )}
            {isPlaying ? <Pause className="w-5 h-5 md:w-6 md:h-6 relative" /> : <Play className="w-5 h-5 md:w-6 md:h-6 ml-1 relative" />}
          </button>
          <button onClick={onNextTrack} className="text-[#8E9299] hover:text-white transition-colors p-2">
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-3 border-l border-white/10 pl-4 md:pl-6">
          <Volume2 className="w-4 h-4 text-[#8E9299]" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="w-24 sonic-range cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}
