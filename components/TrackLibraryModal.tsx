'use client'

import React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Upload, X, FolderOpen, Sparkles, Search, Music } from 'lucide-react'
import { Track } from '@/hooks/useTrackLibrary'

interface TrackLibraryModalProps {
  show: boolean
  onClose: () => void
  selectionMode: boolean
  setSelectionMode: (mode: boolean) => void
  selectedTrackUrls: string[]
  setSelectedTrackUrls: (urls: string[]) => void
  allTracks: Track[]
  trackSearch: string
  setTrackSearch: (search: string) => void
  genreFilter: string
  setGenreFilter: (genre: string) => void
  allGenres: string[]
  handleFolderImport: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  audioSource: string
  currentTrackName: string
  currentTrackId?: string
  onTrackSelect: (track: Track) => void
  onConfirmCalibration?: () => void
  urlInput: string
  setUrlInput: (url: string) => void
  handleUrlSubmit: (e: React.FormEvent) => void
  isPlaying: boolean
}

export const TrackLibraryModal: React.FC<TrackLibraryModalProps> = ({
  show,
  onClose,
  selectionMode,
  setSelectionMode,
  selectedTrackUrls,
  setSelectedTrackUrls,
  allTracks,
  trackSearch,
  setTrackSearch,
  genreFilter,
  setGenreFilter,
  allGenres,
  handleFolderImport,
  fileInputRef,
  audioSource,
  currentTrackName,
  onTrackSelect,
  onConfirmCalibration,
  urlInput,
  setUrlInput,
  handleUrlSubmit,
  isPlaying,
}) => {
  const filteredTracks = allTracks.filter(t => 
    (genreFilter === 'All' || t.genre === genreFilter) &&
    (trackSearch === '' || 
      t.name.toLowerCase().includes(trackSearch.toLowerCase()) ||
      t.genre?.toLowerCase().includes(trackSearch.toLowerCase()))
  )

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-[#0f1013] border border-white/10 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
          >
            <div className="p-4 md:p-5 border-b border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
              <div className="min-w-0">
                <h2 className="text-lg md:text-xl font-black text-white tracking-tight">
                  {selectionMode ? 'Calibration Tracks' : 'Track Library'}
                </h2>
                <p className="text-[11px] md:text-xs text-[#8E9299] font-medium mt-1">
                  {selectionMode
                    ? `Select 1-3 songs · ${selectedTrackUrls.length} chosen`
                    : `${allTracks.length} tracks · Local & Streaming`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={handleFolderImport}
                  className="flex-1 sm:flex-none px-3 py-1.5 bg-white/5 hover:bg-white/10 text-[#8E9299] hover:text-white rounded-lg text-[10px] font-mono uppercase tracking-widest border border-white/10 transition-all flex items-center justify-center gap-1.5"
                  title="Import a folder as an album"
                >
                  <FolderOpen className="w-3.5 h-3.5" /> Add Album
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 sm:flex-none px-3 py-1.5 bg-white/5 hover:bg-white/10 text-[#8E9299] hover:text-white rounded-lg text-[10px] font-mono uppercase tracking-widest border border-white/10 transition-all flex items-center justify-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" /> Add Tracks
                </button>
                {!selectionMode && (
                  <button
                    onClick={() => { setSelectionMode(true); setSelectedTrackUrls([audioSource]); }}
                    className="w-full sm:w-auto px-4 py-1.5 bg-[#F27D26]/15 hover:bg-[#F27D26]/25 text-[#F27D26] rounded-lg text-[10px] font-mono font-bold uppercase tracking-widest border border-[#F27D26]/30 transition-all flex items-center justify-center gap-1.5 mt-2 sm:mt-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Calibrate Mode
                  </button>
                )}
                {selectionMode && (
                  <button
                    onClick={() => { setSelectionMode(false); setSelectedTrackUrls([]); }}
                    className="w-full sm:w-auto px-4 py-1.5 bg-white/5 hover:bg-white/10 text-[#8E9299] hover:text-white rounded-lg text-[10px] font-mono uppercase tracking-widest transition-all mt-2 sm:mt-0"
                  >
                    Cancel
                  </button>
                )}
                <button onClick={onClose} className="hidden sm:block p-1.5 text-[#8E9299] hover:text-white ml-2">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 md:p-5 space-y-4 border-b border-white/5 shrink-0 bg-[#07080a]/50">
              <div className="flex items-center justify-between gap-4 mb-2">
                <input
                  type="text"
                  value={trackSearch}
                  onChange={(e) => setTrackSearch(e.target.value)}
                  placeholder="Search tracks by name or genre..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-medium focus:border-[#F27D26]/60 outline-none text-white placeholder-white/30 transition-colors"
                />
                <button onClick={onClose} className="sm:hidden p-2 bg-white/5 rounded-xl text-[#8E9299]">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex gap-2 flex-wrap pb-1 overflow-x-auto sonic-scroll">
                {allGenres.map((g) => (
                  <button
                    key={g}
                    onClick={() => setGenreFilter(g)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase tracking-widest transition-all whitespace-nowrap ${
                      genreFilter === g 
                        ? 'bg-[#F27D26] text-black font-bold shadow-[0_2px_10px_rgba(242,125,38,0.3)]' 
                        : 'bg-white/5 text-[#8E9299] hover:bg-white/10 hover:text-white border border-white/5'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-4 md:px-5 py-4 border-b border-white/5 shrink-0 bg-[#07080a]/50">
              <p className="text-[10px] font-mono text-[#8E9299] uppercase tracking-widest mb-2.5">Direct MP3/OGG/WAV URL</p>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { handleUrlSubmit(e); onClose(); } }}
                  placeholder="https://example.com/track.mp3"
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-medium focus:border-[#F27D26]/60 outline-none text-white placeholder-white/30 transition-colors"
                />
                <button
                  onClick={(e) => { handleUrlSubmit(e); if (urlInput && !urlInput.includes('youtube') && !urlInput.includes('youtu.be')) onClose(); }}
                  className="px-5 py-2.5 bg-white text-black hover:bg-gray-100 rounded-xl text-xs font-bold uppercase tracking-widest transition-transform hover:scale-[1.02] active:scale-95 shadow-[0_4px_12px_rgba(255,255,255,0.1)]"
                >
                  Load
                </button>
              </div>
              {urlInput && (urlInput.includes('youtube') || urlInput.includes('youtu.be')) && (
                <p className="text-[10px] text-red-400 mt-2 font-mono">
                  YouTube links cannot be played directly due to CORS/security restrictions.
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredTracks.map((t) => {
                  const isSelected = selectedTrackUrls.includes(t.url);
                  const isCurrent = t.url === audioSource;
                  
                  return (
                    <button
                      key={t.url}
                      onClick={() => onTrackSelect(t)}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left group ${
                        isSelected 
                          ? 'bg-[#F27D26]/10 border-[#F27D26]/40' 
                          : isCurrent
                            ? 'bg-white/5 border-white/20'
                            : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.08] hover:border-white/20'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-[#F27D26] text-black' : 'bg-white/5 text-[#8E9299]'
                      }`}>
                        {selectionMode && isSelected ? <Sparkles className="w-5 h-5" /> : <Music className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="text-sm font-bold text-white truncate flex items-center gap-1.5">
                          {t.name}
                          {isCurrent && <div className="w-1 h-1 rounded-full bg-[#F27D26] animate-pulse" />}
                        </div>
                        <div className="text-[10px] font-mono text-[#8E9299] uppercase truncate">
                          {t.genre || 'Uncategorized'}
                        </div>
                      </div>
                      {selectionMode && (
                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                          isSelected ? 'bg-[#F27D26] border-[#F27D26]' : 'border-white/20'
                        }`}>
                          {isSelected && <X className="w-3.5 h-3.5 text-black rotate-45" />}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {selectionMode && (
              <div className="p-4 md:p-5 border-t border-white/5 bg-[#F27D26]/5 shrink-0 flex items-center justify-between">
                <div className="text-[11px] font-mono text-[#F9B47A] uppercase font-bold">
                  {selectedTrackUrls.length === 0 
                    ? 'Select at least 1 track' 
                    : `${selectedTrackUrls.length} Track${selectedTrackUrls.length > 1 ? 's' : ''} Staged`}
                </div>
                <button
                  disabled={selectedTrackUrls.length === 0}
                  onClick={() => onConfirmCalibration?.()}
                  className="px-6 py-2 bg-[#F27D26] hover:bg-[#FF6F3C] disabled:opacity-30 disabled:cursor-not-allowed text-black rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shadow-[0_8px_20px_rgba(242,125,38,0.25)]"
                >
                  Confirm Selection
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
