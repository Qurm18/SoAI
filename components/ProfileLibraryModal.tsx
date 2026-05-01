'use client'

import React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Upload, X, FolderOpen, Download } from 'lucide-react'
import { SavedProfile } from '@/lib/profile-store'

interface ProfileLibraryModalProps {
  show: boolean
  onClose: () => void
  savedProfiles: SavedProfile[]
  handleDeleteProfile: (id: string) => void
  handleLoadProfile: (p: SavedProfile) => void
  exportProfileAsAPO: (p: SavedProfile) => void
  importFileRef: React.RefObject<HTMLInputElement | null>
  importError: string | null
}

export const ProfileLibraryModal: React.FC<ProfileLibraryModalProps> = ({
  show,
  onClose,
  savedProfiles,
  handleDeleteProfile,
  handleLoadProfile,
  exportProfileAsAPO,
  importFileRef,
  importError,
}) => {
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
            className="bg-[#0f1013] border border-white/10 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">Profile Library</h2>
                  <p className="text-[10px] text-[#8E9299] font-mono uppercase tracking-widest mt-0.5">
                    {savedProfiles.length} saved profiles
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { onClose(); importFileRef.current?.click(); }}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-mono uppercase tracking-widest text-[#8E9299] hover:text-white transition-all flex items-center gap-1.5"
                  >
                    <Upload className="w-3 h-3" /> Import
                  </button>
                  <button onClick={onClose} className="p-1.5 text-[#8E9299] hover:text-white transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {importError && (
                <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono">
                  {importError}
                </div>
              )}

              {savedProfiles.length === 0 ? (
                <div className="py-12 text-center">
                  <FolderOpen className="w-10 h-10 text-white/10 mx-auto mb-3" />
                  <p className="text-[#8E9299] text-sm">No saved profiles yet.</p>
                  <p className="text-[#8E9299]/50 text-xs mt-1">Run AI Calibrate or save manually.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {savedProfiles.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 p-3 bg-white/[0.04] hover:bg-white/[0.07] rounded-xl border border-white/5 group transition-all"
                    >
                      <div className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-white/10" style={{ background: p.color ?? '#888' }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white truncate">{p.name}</div>
                        <div className="text-[10px] text-[#8E9299] font-mono">
                          {p.genre ?? p.source} · {new Date(p.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => exportProfileAsAPO(p)}
                          className="p-1.5 text-[#8E9299] hover:text-white rounded-lg hover:bg-white/10 transition-all"
                          title="Quick export APO"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteProfile(p.id)}
                          className="p-1.5 text-[#8E9299] hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-all"
                          title="Delete"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <button
                        onClick={() => handleLoadProfile(p)}
                        className="px-3 py-1.5 bg-[#F27D26]/15 hover:bg-[#F27D26]/25 text-[#F27D26] rounded-lg text-[10px] font-mono uppercase tracking-widest transition-all"
                      >
                        Load
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
