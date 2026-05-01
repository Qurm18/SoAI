'use client'

import React from 'react'
import { motion, AnimatePresence } from 'motion/react'

interface SaveProfileModalProps {
  show: boolean
  onClose: () => void
  saveNameInput: string
  setSaveNameInput: (name: string) => void
  handleSaveProfileLocal: () => void
  profileName: string | null
}

export const SaveProfileModal: React.FC<SaveProfileModalProps> = ({
  show,
  onClose,
  saveNameInput,
  setSaveNameInput,
  handleSaveProfileLocal,
  profileName,
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
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-[#0f1013] border border-white/10 rounded-2xl w-full max-w-sm p-6 shadow-2xl"
          >
            <h3 className="text-base font-bold text-white tracking-tight mb-4">Save Profile</h3>
            <input
              type="text"
              value={saveNameInput}
              onChange={(e) => setSaveNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveProfileLocal();
                if (e.key === 'Escape') onClose();
              }}
              placeholder={profileName || 'Profile name...'}
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:border-[#F27D26]/60 outline-none transition-all mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-mono uppercase tracking-widest text-[#8E9299] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveProfileLocal}
                className="flex-1 py-2.5 bg-[#F27D26] hover:bg-[#F27D26]/90 rounded-xl text-xs font-mono uppercase tracking-widest text-black font-bold transition-all"
              >
                Save
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
