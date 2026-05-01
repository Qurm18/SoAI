'use client';


import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { EQBand } from '@/lib/audio-engine';
import { Settings, Plus, Minus, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';
import { bandZoneLabel, qToBandwidthOct } from '@/lib/profile-store';
import { InfoTooltip } from './InfoTooltip';

interface EQPanelProps {
  bands: EQBand[];
  onBandChange: (index: number, params: Partial<EQBand>) => void;
  preAmp: number;
  onPreAmpChange: (val: number) => void;
  phaseMode: 'iir' | 'fir' | 'hybrid';
  onPhaseModeChange: (mode: 'iir' | 'fir' | 'hybrid') => void;
  dynamicEqMaster: boolean;
  onDynamicEqMasterChange: (val: boolean) => void;
  spectralPeaks?: number[];
}

const BAND_ZONE_COLORS: Record<string, string> = {
  'Sub-Bass':  '#7c3aed',
  'Bass':      '#6366f1',
  'Low-Mid':   '#0ea5e9',
  'Mid':       '#10b981',
  'High-Mid':  '#facc15',
  'Presence':  '#fb923c',
  'Air':       '#f43f5e',
};

export const EQPanel: React.FC<EQPanelProps> = React.memo(({ 
  bands, 
  onBandChange, 
  preAmp, 
  onPreAmpChange,
  phaseMode,
  onPhaseModeChange,
  dynamicEqMaster,
  onDynamicEqMasterChange,
  spectralPeaks
}) => {
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

  // UI-05: initialise snapshot from sessionStorage so it survives tab navigation
  const [snapshotGains, setSnapshotGains] = React.useState<number[] | null>(() => {
    try {
      const stored = sessionStorage.getItem('eq_snapshot_a');
      return stored ? (JSON.parse(stored) as number[]) : null;
    } catch { return null; }
  });
  const [isComparingSnapshot, setIsComparingSnapshot] = React.useState(false);
  const [snapshotB, setSnapshotB] = React.useState<number[] | null>(null);

  const handleSaveA = () => {
    const gains = bands.map(b => b.gain);
    setSnapshotGains(gains);
    setIsComparingSnapshot(false);
    // UI-05: persist across navigation
    try { sessionStorage.setItem('eq_snapshot_a', JSON.stringify(gains)); } catch {}
  };
  
  const handleCompareA = () => {
    if (!snapshotGains) return;
    if (isComparingSnapshot) {
      // Revert to B
      if (snapshotB) {
        snapshotB.forEach((g, i) => onBandChange(i, { gain: g }));
      }
      setIsComparingSnapshot(false);
    } else {
      // Save current as B, apply A
      setSnapshotB(bands.map(b => b.gain));
      snapshotGains.forEach((g, i) => onBandChange(i, { gain: g }));
      setIsComparingSnapshot(true);
    }
  };

  const activeCount = bands.filter((b) => Math.abs(b.gain) > 0.05).length;

  return (
    <div className="space-y-2">
      {/* Pre-Amp + status row */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2 p-3 bg-black/30 rounded-2xl border border-white/5 backdrop-blur-sm relative z-20">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="flex flex-col min-w-[100px]">
            <span className="text-[9px] font-mono text-[#8E9299] uppercase tracking-widest leading-none mb-1">Pre-Amplification</span>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white tabular-nums">
                {preAmp > 0 ? `+${preAmp.toFixed(1)}` : preAmp.toFixed(1)} dB
              </span>
              {/* UI-04: badge shown when auto-compensation is active (preAmp < 0 set by band gain) */}
              {preAmp < -0.1 && (
                <span
                  className="text-[8px] font-mono px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 leading-none"
                  title={`Auto-compensated ${preAmp.toFixed(1)} dB to prevent clipping from boosted bands. Toggle off in settings to disable.`}
                >
                  AUTO {preAmp.toFixed(1)} dB
                </span>
              )}
            </div>
          </div>
          <input
            type="range"
            min="-20"
            max="20"
            step="0.5"
            value={preAmp}
            onChange={(e) => onPreAmpChange(parseFloat(e.target.value))}
            className="flex-1 md:w-56 sonic-range cursor-pointer"
          />
          <button
            onClick={() => onPreAmpChange(0)}
            className="p-1.5 text-[#8E9299] hover:text-white hover:bg-white/5 rounded-md transition-all"
            title="Reset pre-amp"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveA}
            className="px-2 py-1 text-[10px] font-mono text-[#8E9299] hover:text-white border border-white/10 rounded-md transition-all"
            title="Save current EQ as A snapshot"
          >
            Save A
          </button>
          <button
            disabled={!snapshotGains}
            onClick={handleCompareA}
            className={`px-2 py-1 text-[10px] font-mono rounded-md transition-all ${
              !snapshotGains 
                ? 'opacity-50 cursor-not-allowed text-[#8E9299] border border-transparent'
                : isComparingSnapshot
                ? 'bg-[#F27D26]/20 text-[#F27D26] border border-[#F27D26]/40'
                : 'text-[#8E9299] hover:text-white border border-white/10'
            }`}
          >
            {isComparingSnapshot ? 'Show B' : 'Compare A'}
          </button>
        </div>

        <div className="flex items-center gap-4 text-[10px] font-mono text-[#8E9299] uppercase tracking-widest relative z-30">
          <button
            onClick={() => onDynamicEqMasterChange(!dynamicEqMaster)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full transition-all group ${
              dynamicEqMaster 
                ? 'bg-orange-500/10 border border-orange-500/30 text-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.1)]' 
                : 'hover:bg-white/5 border border-transparent text-[#8E9299]'
            }`}
            title="Enable AI-Powered Dynamic EQ (Reactive Gain)"
          >
            <span className={`w-1.5 h-1.5 rounded-full transition-all ${
              dynamicEqMaster ? 'bg-orange-500 shadow-[0_0_6px_#f97316]' : 'bg-[#8E9299]'
            }`} />
            Dynamic EQ
          </button>
          <InfoTooltip side="bottom" align="center" content="Tự động điều chỉnh gain dựa trên mức độ tín hiệu tại băng tần đó, giúp kiểm soát tốt hơn các đỉnh âm thanh mà không làm bẹt toàn bộ track." />

          <button
            onClick={() => {
              if (phaseMode === 'iir') onPhaseModeChange('fir');
              else if (phaseMode === 'fir') onPhaseModeChange('hybrid');
              else onPhaseModeChange('iir');
            }}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full transition-all group ${
              phaseMode !== 'iir' 
                ? 'bg-blue-400/10 border border-blue-400/30 text-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.1)]' 
                : 'hover:bg-white/5 border border-transparent text-[#8E9299]'
            }`}
            title="Cycle Phase Modes: IIR (Low latency) -> FIR (Linear Phase) -> Hybrid (FIR Bass / IIR Mid-High)"
          >
            <span className={`w-1.5 h-1.5 rounded-full transition-all ${
              phaseMode !== 'iir' ? 'bg-blue-400 shadow-[0_0_6px_#60a5fa]' : 'bg-[#8E9299]'
            }`} />
            {phaseMode === 'fir' ? 'Linear Phase (FIR)' : phaseMode === 'hybrid' ? 'Mixed (FIR/IIR)' : 'Normal Phase (IIR)'}
          </button>
          <InfoTooltip side="bottom" align="center" content="IIR: 0ms delay. FIR: Perfect phase, higher delay. Mixed: FIR for tight Bass, IIR for crispy Highs - best of both worlds." />

          {/* VĐ-UI-07 — FIR latency warning */}
          {phaseMode !== 'iir' && (
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[9px] font-mono"
              title={phaseMode === 'fir' ? 'Linear-phase FIR adds ~46 ms group delay. Avoid with live mic monitoring.' : 'Hybrid mode adds ~23 ms latency on bass bands. Fine for music playback.'}
            >
              ⚠ {phaseMode === 'fir' ? '~46 ms latency' : '~23 ms latency'}
            </span>
          )}
        </div>
      </div>

      {/* Slider grid */}
      <div className="bg-gradient-to-b from-[#161719] to-[#0f1012] rounded-3xl border border-white/10 p-4 md:p-5 shadow-inner relative">
        {/* Background grid lines */}
        <div className="absolute inset-x-5 top-10 bottom-16 pointer-events-none">
          {[0.25, 0.5, 0.75].map((p) => (
            <div
              key={p}
              className="absolute left-0 right-0 border-t border-white/[0.04]"
              style={{ top: `${p * 100}%` }}
            />
          ))}
          <div className="absolute left-0 right-0 border-t border-white/15 border-dashed top-1/2" />
        </div>

        <div className="flex flex-row sm:grid sm:grid-cols-10 gap-1.5 sm:gap-1 relative overflow-x-auto pb-2 sm:pb-0 sonic-scroll">
          {bands.map((band, index) => {
            const zone = bandZoneLabel(band.frequency);
            const accent = BAND_ZONE_COLORS[zone] ?? '#F27D26';
            const isEditing = editingIndex === index;
            const isHover = hoverIndex === index;
            const gainPct = ((band.gain + 12) / 24) * 100;

            return (
              <div
                key={index}
                className="flex flex-col items-center gap-2 group relative min-w-[50px] xs:min-w-[54px] sm:min-w-0 flex-1"
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex(null)}
              >
                {/* Zone label */}
                <div className="text-[7px] font-bold uppercase tracking-[0.12em] opacity-50" style={{ color: accent }}>
                  {zone}
                </div>

                {/* Q badge */}
                <button
                  onClick={() => setEditingIndex(isEditing ? null : index)}
                  className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter transition-all ${
                    isEditing
                      ? 'bg-white text-black shadow-md'
                      : isHover
                      ? 'bg-white/10 text-white'
                      : 'bg-black/50 text-[#8E9299]'
                  }`}
                >
                  Q {band.q.toFixed(1)}
                </button>

                {/* Slider column */}
                <div className="relative h-40 sm:h-48 w-full flex justify-center items-center py-1">
                  {/* Center scale ticks */}
                  <div className="absolute inset-y-1 left-1/2 -translate-x-1/2 w-[1px] bg-white/[0.06] flex flex-col justify-between pointer-events-none">
                    {Array.from({ length: 7 }).map((_, i) => {
                      const isCenter = i === 3;
                      return (
                        <div
                          key={i}
                          style={{
                            width: isCenter ? 18 : 10,
                            marginLeft: isCenter ? -9 : -5,
                            height: 1,
                            background: isCenter ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.10)',
                          }}
                        />
                      );
                    })}
                  </div>

                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="0.5"
                    value={band.gain}
                    onChange={(e) => onBandChange(index, { gain: parseFloat(e.target.value) })}
                    onDoubleClick={() => onBandChange(index, { gain: 0 })}
                    className="vertical-slider appearance-none h-full w-12 bg-transparent cursor-pointer z-10"
                    style={{ writingMode: 'vertical-lr' as any, direction: 'rtl' as any }}
                  />

                  {/* Animated thumb */}
                  <motion.div
                    initial={false}
                    animate={{ bottom: `${gainPct}%` }}
                    transition={{ type: 'spring', damping: 22, stiffness: 360 }}
                    className="absolute w-9 sm:w-10 h-3.5 rounded-md pointer-events-none z-0"
                    style={{
                      transform: 'translateY(50%)',
                      background: `linear-gradient(to bottom, #ffffff 0%, ${accent} 100%)`,
                      boxShadow: `0 4px 18px ${accent}55, 0 0 0 1px rgba(255,255,255,0.35)`,
                    }}
                  >
                    <div className="w-full h-[1px] bg-white/55 mt-1.5" />
                  </motion.div>

                  {/* Gain bar gradient (visual fill from 0 dB) */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 w-[3px] rounded-full pointer-events-none transition-all"
                    style={{
                      background: band.gain >= 0
                        ? `linear-gradient(to top, ${accent}55, ${accent}aa)`
                        : `linear-gradient(to bottom, #60a5fa55, #60a5faaa)`,
                      bottom: band.gain >= 0 ? '50%' : `${gainPct}%`,
                      top: band.gain >= 0 ? `${100 - gainPct}%` : '50%',
                    }}
                  />
                </div>

                {/* Frequency + gain display */}
                <div className="flex flex-col items-center gap-0.5 w-full">
                  <button
                    onClick={() => setEditingIndex(isEditing ? null : index)}
                    className="text-[10px] font-bold font-mono text-white/85 hover:text-white transition-colors"
                  >
                    {formatFreq(band.frequency)}
                  </button>
                  <div
                    className="text-[11px] font-black font-mono tabular-nums"
                    style={{ color: band.gain === 0 ? 'rgba(255,255,255,0.25)' : accent }}
                  >
                    {band.gain > 0 ? `+${band.gain.toFixed(1)}` : band.gain.toFixed(1)}
                  </div>
                </div>

                {/* Advanced popover (edge-clamped: left bands → align left, right → align right, else centred) */}
                <AnimatePresence>
                  {isEditing && (() => {
                    const isLeftEdge  = index < 2;
                    const isRightEdge = index >= bands.length - 2;
                    const align = isLeftEdge
                      ? 'left-0'
                      : isRightEdge
                      ? 'right-0'
                      : 'left-1/2 -translate-x-1/2';
                    return (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.92, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.92, y: 8 }}
                      transition={{ type: 'spring', damping: 26, stiffness: 360 }}
                      className={`absolute bottom-full mb-3 z-50 bg-[#1a1c20]/95 backdrop-blur-md border border-white/15 rounded-2xl shadow-2xl p-4 w-52 ${align}`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: accent }}>
                            Band {index + 1} · {zone}
                          </span>
                          <button
                            onClick={() => setEditingIndex(null)}
                            className="text-white/40 hover:text-white"
                          >
                            <Settings className="w-3 h-3" />
                          </button>
                        </div>

                        <div>
                          <span className="text-[9px] text-[#8E9299] block mb-1">Frequency (Hz)</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onBandChange(index, { frequency: Math.max(20, Math.round(band.frequency * 0.95)) })}
                              className="p-1 bg-white/5 hover:bg-white/10 rounded transition-colors"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              value={Math.round(band.frequency)}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10);
                                if (!isNaN(v)) onBandChange(index, { frequency: Math.max(20, Math.min(20000, v)) });
                              }}
                              className="flex-1 bg-black/30 border border-white/10 rounded text-center font-mono text-xs text-white py-0.5 outline-none focus:border-white/30"
                            />
                            <button
                              onClick={() => onBandChange(index, { frequency: Math.min(20000, Math.round(band.frequency * 1.05)) })}
                              className="p-1 bg-white/5 hover:bg-white/10 rounded transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[9px] text-[#8E9299]">Q · Bandwidth</span>
                            <span className="text-[8px] font-mono text-white/40">
                              {qToBandwidthOct(band.q).toFixed(2)} oct
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => onBandChange(index, { q: Math.max(0.1, parseFloat((band.q - 0.1).toFixed(2))) })}
                              className="p-1 bg-white/5 hover:bg-white/10 rounded transition-colors"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                            <span className="flex-1 text-center font-mono text-xs tabular-nums">{band.q.toFixed(2)}</span>
                            <button
                              onClick={() => onBandChange(index, { q: Math.min(10, parseFloat((band.q + 0.1).toFixed(2))) })}
                              className="p-1 bg-white/5 hover:bg-white/10 rounded transition-colors"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <div>
                          <span className="text-[9px] text-[#8E9299] block mb-1">Gain</span>
                          <input
                            type="number"
                            step="0.5"
                            value={band.gain}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v)) onBandChange(index, { gain: Math.max(-12, Math.min(12, v)) });
                            }}
                            className="w-full bg-black/30 border border-white/10 rounded text-center font-mono text-xs text-white py-0.5 outline-none focus:border-white/30"
                          />
                        </div>

                        <div>
                          <span className="text-[9px] text-[#8E9299] block mb-1">Filter Type</span>
                          <select
                            value={band.type}
                            onChange={(e) => onBandChange(index, { type: e.target.value as BiquadFilterType })}
                            className="w-full bg-white/5 border border-white/10 rounded-lg text-[10px] p-1.5 text-white outline-none cursor-pointer focus:border-white/30"
                          >
                            <option value="peaking">Peaking</option>
                            <option value="lowshelf">Low Shelf</option>
                            <option value="highshelf">High Shelf</option>
                            <option value="notch">Notch</option>
                            <option value="bandpass">Band-Pass</option>
                          </select>
                        </div>

                        {/* Dynamic EQ Sub-section */}
                        <div className="pt-2 border-t border-white/5 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-orange-400">Dynamic EQ</span>
                            <button
                              onClick={() => onBandChange(index, { dynEnabled: !band.dynEnabled })}
                              className={`w-8 h-4 rounded-full relative transition-all ${
                                band.dynEnabled ? 'bg-orange-500' : 'bg-white/10'
                              }`}
                            >
                              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                                band.dynEnabled ? 'left-4.5' : 'left-0.5'
                              }`} />
                            </button>
                          </div>
                          
                          {band.dynEnabled && (
                            <motion.div 
                              initial={{ height: 0, opacity: 0 }} 
                              animate={{ height: 'auto', opacity: 1 }} 
                              className="space-y-2 overflow-hidden"
                            >
                              <div className="flex justify-between text-[8px] text-[#8E9299]">
                                <span>Thresh: {band.threshold}dB</span>
                                <span>Ratio: {band.ratio}:1</span>
                              </div>
                              <input 
                                type="range" min="-60" max="0" step="1" 
                                value={band.threshold} 
                                onChange={(e) => onBandChange(index, { threshold: parseFloat(e.target.value) })}
                                className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-orange-500"
                              />
                              <div className="flex justify-between text-[8px] text-[#8E9299]">
                                <span>Range: {band.range}dB</span>
                                <span>Rel: {band.release}ms</span>
                              </div>
                              <input 
                                type="range" min="0" max="18" step="0.5" 
                                value={band.range} 
                                onChange={(e) => onBandChange(index, { range: parseFloat(e.target.value) })}
                                className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-orange-500"
                              />
                            </motion.div>
                          )}
                        </div>

                        <button
                          onClick={() => onBandChange(index, { gain: 0 })}
                          className="w-full py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[9px] font-mono uppercase tracking-widest text-[#8E9299] hover:text-white transition-all"
                        >
                          Flatten band
                        </button>
                      </div>
                    </motion.div>
                    );
                  })()}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        .vertical-slider {
          -webkit-appearance: none;
          background: transparent;
        }
        .vertical-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 0;
          width: 0;
        }
        .vertical-slider::-moz-range-thumb {
          height: 0;
          width: 0;
          background: transparent;
          border: none;
        }
      `}</style>
    </div>
  );
});

EQPanel.displayName = 'EQPanel';

function formatFreq(freq: number): string {
  if (freq >= 1000) return `${freq / 1000}k`;
  return `${freq}`;
}
