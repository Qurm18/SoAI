'use client';


import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Download, Copy, Check, X, FileText, Code2, FileSpreadsheet, FileType } from 'lucide-react';
import { EQBand } from '@/lib/audio-engine';
import {
  EXPORT_FORMATS,
  ExportFormatId,
  buildLiveProfile,
  downloadProfile,
} from '@/lib/profile-store';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  bands: EQBand[];
  preAmp: number;
  defaultName?: string;
  defaultGenre?: string;
  defaultColor?: string;
}

const FORMAT_ICONS: Record<ExportFormatId, React.ReactNode> = {
  'sonic-json': <Code2 className="w-3.5 h-3.5" />,
  apo:          <FileText className="w-3.5 h-3.5" />,
  autoeq:       <FileText className="w-3.5 h-3.5" />,
  wavelet:      <FileText className="w-3.5 h-3.5" />,
  camilla:      <FileType  className="w-3.5 h-3.5" />,
  csv:          <FileSpreadsheet className="w-3.5 h-3.5" />,
  markdown:     <FileType  className="w-3.5 h-3.5" />,
  rew:          <FileText className="w-3.5 h-3.5" />,
};

export const ExportDialog: React.FC<ExportDialogProps> = ({
  open, onClose, bands, preAmp, defaultName, defaultGenre, defaultColor,
}) => {
  const [activeFormat, setActiveFormat] = useState<ExportFormatId>('sonic-json');
  const [name, setName] = useState(defaultName || 'Sonic AI Live EQ');
  const [copied, setCopied] = useState(false);

  // Build a profile from current state every render (cheap, no state machine).
  const profile = useMemo(
    () => buildLiveProfile(bands, preAmp, { name, genre: defaultGenre, color: defaultColor }),
    [bands, preAmp, name, defaultGenre, defaultColor]
  );

  const formatDef = EXPORT_FORMATS.find((f) => f.id === activeFormat)!;
  const previewText = useMemo(() => formatDef.build(profile), [formatDef, profile]);

  const handleDownload = () => downloadProfile(profile, activeFormat);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(previewText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  // Quick stats for the badge row.
  const stats = useMemo(() => {
    const maxBoost = Math.max(0, ...bands.map((b) => b.gain));
    const maxCut   = Math.min(0, ...bands.map((b) => b.gain));
    const active   = bands.filter((b) => Math.abs(b.gain) > 0.05).length;
    return { maxBoost, maxCut, active };
  }, [bands]);

  return (
    <AnimatePresence>
      {open && (
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
            className="bg-[#0f1013] border border-white/10 rounded-3xl w-full max-w-3xl flex flex-col max-h-[92vh] overflow-hidden shadow-[0_30px_120px_rgba(0,0,0,0.6)]"
          >
            {/* Header */}
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-white/5 bg-gradient-to-b from-white/[0.03] to-transparent flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                  <Download className="w-4 h-4 text-[#F27D26]" />
                  Export EQ Profile
                </h2>
                <p className="text-[10px] text-[#8E9299] font-mono uppercase tracking-widest mt-1">
                  {bands.length} bands · pre-amp {preAmp >= 0 ? '+' : ''}{preAmp.toFixed(2)} dB
                  {stats.active > 0 && <> · {stats.active} active</>}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 text-[#8E9299] hover:text-white hover:bg-white/5 rounded-lg transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto sonic-scroll min-h-0">
            {/* Profile name */}
            <div className="px-6 pt-5">
              <label className="block text-[10px] font-mono text-[#8E9299] uppercase tracking-widest mb-1.5">
                Profile name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Reference EQ"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:border-[#F27D26]/60 outline-none transition-all"
              />
            </div>

            {/* Format chooser */}
            <div className="px-6 pt-5">
              <label className="block text-[10px] font-mono text-[#8E9299] uppercase tracking-widest mb-2">
                Format
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {EXPORT_FORMATS.map((f) => {
                  const isActive = f.id === activeFormat;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setActiveFormat(f.id)}
                      className={`relative text-left p-3 rounded-xl border transition-all overflow-hidden group ${
                        isActive
                          ? 'bg-[#F27D26]/15 border-[#F27D26]/50 shadow-[0_0_0_1px_rgba(242,125,38,0.3)]'
                          : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={isActive ? 'text-[#F27D26]' : 'text-[#8E9299]'}>
                          {FORMAT_ICONS[f.id]}
                        </span>
                        <span className={`text-[11px] font-bold tracking-tight ${isActive ? 'text-white' : 'text-white/85'}`}>
                          {f.label}
                        </span>
                        <span className="ml-auto text-[8px] font-mono text-[#8E9299] uppercase">
                          .{f.extension}
                        </span>
                      </div>
                      <p className="text-[9.5px] text-[#8E9299] leading-snug">{f.description}</p>
                      {isActive && (
                        <motion.div
                          layoutId="export-format-pill"
                          className="absolute inset-0 rounded-xl ring-1 ring-[#F27D26]/40 pointer-events-none"
                          transition={{ type: 'spring', damping: 22, stiffness: 320 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* VĐ-UI-03 — APO / REW context info */}
            {(activeFormat === 'apo' || activeFormat === 'rew') && (
              <div className="mx-6 mt-3 flex items-start gap-2.5 p-3 rounded-xl bg-blue-500/5 border border-blue-400/20 text-[10px] text-[#8E9299] leading-relaxed">
                <span className="text-blue-400 mt-0.5 shrink-0">ℹ</span>
                <div>
                  {activeFormat === 'apo' && (
                    <>
                      <span className="text-white/80 font-semibold">Equalizer APO</span> is a free, parametric EQ for Windows.
                      Paste this file into <code className="text-blue-300 bg-blue-400/10 px-1 rounded">config.txt</code> (usually{" "}
                      <code className="text-blue-300 bg-blue-400/10 px-1 rounded">C:\Program Files\EqualizerAPO\config\</code>).
                      <a
                        href="https://equalizerapo.sourceforge.net/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 text-blue-400 underline underline-offset-2 hover:text-blue-300"
                      >
                        Download EqualizerAPO ↗
                      </a>
                      {" · "}
                      <a
                        href="https://sourceforge.net/projects/peace-equalizer-apo-extension/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
                      >
                        Peace GUI ↗
                      </a>
                    </>
                  )}
                  {activeFormat === 'rew' && (
                    <>
                      <span className="text-white/80 font-semibold">Room EQ Wizard (REW)</span> is a free acoustic analysis tool.
                      Load this file via <em>EQ → Load Filter Settings</em> to apply your curve inside REW or export to your DAW.
                      <a
                        href="https://www.roomeqwizard.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 text-blue-400 underline underline-offset-2 hover:text-blue-300"
                      >
                        Download REW ↗
                      </a>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Preview */}
            <div className="px-6 pt-5 pb-2">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-mono text-[#8E9299] uppercase tracking-widest">
                  Preview
                </label>
                <span className="text-[9px] font-mono text-white/30">
                  {previewText.split('\n').length} lines · {previewText.length.toLocaleString()} chars
                </span>
              </div>
              <pre className="bg-black/60 border border-white/10 rounded-xl p-3 text-[10.5px] font-mono text-[#bfc4cc] leading-relaxed max-h-56 overflow-auto sonic-scroll whitespace-pre">
{previewText}
              </pre>
            </div>
            <div className="h-2" />
            </div>
            {/* End scrollable body */}

            {/* Footer actions (sticky) */}
            <div className="px-6 py-4 border-t border-white/5 bg-black/40 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0">
              <div className="flex-1 hidden sm:flex items-center gap-3 text-[9px] font-mono text-[#8E9299] uppercase tracking-widest">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F27D26]" />
                  Boost {stats.maxBoost > 0 ? `+${stats.maxBoost.toFixed(1)}` : '0'} dB
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  Cut {stats.maxCut < 0 ? stats.maxCut.toFixed(1) : '0'} dB
                </span>
              </div>
              <button
                onClick={handleCopy}
                className={`px-4 py-2.5 rounded-xl text-xs font-mono uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                  copied
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-white/5 hover:bg-white/10 text-[#8E9299] hover:text-white border border-white/10'
                }`}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={handleDownload}
                className="px-5 py-2.5 rounded-xl text-xs font-mono uppercase tracking-widest font-bold transition-all flex items-center justify-center gap-2 bg-[#F27D26] hover:bg-[#F27D26]/90 text-black shadow-[0_8px_24px_rgba(242,125,38,0.35)]"
              >
                <Download className="w-3.5 h-3.5" />
                Download .{formatDef.extension}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
