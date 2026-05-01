'use client';


import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Headphones, Volume2, Cpu, X, RefreshCw, Sparkles,
  AlertTriangle, CheckCircle2, Bluetooth, Cable, Speaker, Tv2,
} from 'lucide-react';
import {
  OutputDevice,
  SourceMetadata,
  BitPerfectStatus,
  listOutputDevices,
  requestPermissionForLabels,
  fetchSourceMetadata,
  setOutputSink,
  isSetSinkIdSupported,
  checkBitPerfect,
  formatRate,
  formatBytes,
  CATEGORY_LABELS,
  DeviceCategory,
  probePermissionState,
  saveLabelCache,
  startDeviceChangeObserver,
} from '@/lib/device-inspector';
import { getDeviceProfiles, getActiveDevice, setActiveDevice, deleteDeviceProfile } from '@/lib/profile-store';
import { DeviceProfile } from '@/lib/ai-engine';
import { Target } from 'lucide-react';

interface DeviceInspectorProps {
  audioContext: AudioContext | null;
  sourceUrl: string;
  /** Called after user picks an output. The host page may need to react (no-op for setSinkId). */
  onOutputChange?: (deviceId: string) => void;
  /** Optional: show as compact strip (default) or as the full panel. */
  variant?: 'strip' | 'panel';
  onSetExactSampleRate?: (rate: number) => void;
  onToggleWebUSB?: (enable: boolean) => Promise<void>;
}

const CATEGORY_ICON_MAP: Record<DeviceCategory, React.ReactNode> = {
  'usb-dac':    <Cpu className="w-3.5 h-3.5" />,
  'usb-audio':  <Cable className="w-3.5 h-3.5" />,
  'bluetooth':  <Bluetooth className="w-3.5 h-3.5" />,
  'hdmi':       <Tv2 className="w-3.5 h-3.5" />,
  'optical':    <Cable className="w-3.5 h-3.5" />,
  'headphone':  <Headphones className="w-3.5 h-3.5" />,
  'speaker':    <Speaker className="w-3.5 h-3.5" />,
  'builtin':    <Volume2 className="w-3.5 h-3.5" />,
  'unknown':    <Volume2 className="w-3.5 h-3.5" />,
};

const CATEGORY_COLORS: Record<DeviceCategory, string> = {
  'usb-dac':    '#a78bfa',
  'usb-audio':  '#60a5fa',
  'bluetooth':  '#22d3ee',
  'hdmi':       '#34d399',
  'optical':    '#fb923c',
  'headphone':  '#facc15',
  'speaker':    '#f472b6',
  'builtin':    '#94a3b8',
  'unknown':    '#94a3b8',
};

export const DeviceInspector: React.FC<DeviceInspectorProps> = ({
  audioContext, sourceUrl, onOutputChange, onSetExactSampleRate, onToggleWebUSB,
}) => {
  const [open, setOpen] = useState(false);
  const [isWebUSBEnabled, setIsWebUSBEnabled] = useState(false);
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string>('default');
  const [labelsBlocked, setLabelsBlocked] = useState(false);
  const [meta, setMeta] = useState<SourceMetadata | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deviceProfiles, setDeviceProfiles] = useState<DeviceProfile[]>([]);
  const [activeDeviceProfile, setActiveDeviceProfile] = useState<DeviceProfile | undefined>(undefined);
  const [permState, setPermState] = useState<'granted' | 'prompt' | 'denied' | 'unknown'>('unknown');
  const [editingDevice, setEditingDevice] = useState<string | null>(null);
  const [editLabelValue, setEditLabelValue] = useState('');

  const refreshDevices = useCallback(async () => {
    setRefreshing(true);
    const pState = await probePermissionState();
    setPermState(pState);
    const list = await listOutputDevices();
    setDevices(list);
    setLabelsBlocked(list.length > 0 && list.every((d) => !d.label || d.label === 'Unknown output device' || d.label === 'Unknown device'));
    setRefreshing(false);
    
    // Refresh device profiles too
    setDeviceProfiles(getDeviceProfiles());
    setActiveDeviceProfile(getActiveDevice());
  }, []);

  useEffect(() => {
    // Wrap in timeout or RAF to avoid synchronous setState in effect warning
    const raf = requestAnimationFrame(() => refreshDevices());
    startDeviceChangeObserver(refreshDevices);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [refreshDevices]);

  // Decode source metadata when URL or context changes
  useEffect(() => {
    if (!sourceUrl) return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      setLoadingMeta(true);
      fetchSourceMetadata(sourceUrl, audioContext)
        .then((m) => { if (!cancelled) setMeta(m); })
        .finally(() => { if (!cancelled) setLoadingMeta(false); });
    });
    return () => { 
      cancelled = true; 
      cancelAnimationFrame(raf);
    };
  }, [sourceUrl, audioContext]);

  const activeDevice = devices.find((d) => d.deviceId === activeDeviceId) ?? devices[0];

  const ctxRate = audioContext?.sampleRate ?? 48000;
  const bitPerfect: BitPerfectStatus = useMemo(
    () => checkBitPerfect(meta?.sampleRate, ctxRate),
    [meta?.sampleRate, ctxRate]
  );

  const handlePickOutput = async (deviceId: string) => {
    setActiveDeviceId(deviceId);
    if (audioContext && isSetSinkIdSupported(audioContext)) {
      await setOutputSink(audioContext, deviceId);
    }
    onOutputChange?.(deviceId);
  };

  const handleToggleCompensation = (id: string) => {
    const nextId = activeDeviceProfile?.id === id ? null : id;
    setActiveDevice(nextId);
    setActiveDeviceProfile(getActiveDevice());
  };

  const handleDeleteProfile = (id: string) => {
    deleteDeviceProfile(id);
    refreshDevices();
  };

  const [permissionError, setPermissionError] = useState<string | null>(null);

  const handleGrantPermission = async () => {
    setPermissionError(null);
    try {
      const ok = await requestPermissionForLabels();
      if (ok) {
        await refreshDevices();
      } else {
        setPermissionError("Permission denied by browser. Please check site settings.");
      }
    } catch (err) {
      setPermissionError("Error requesting permission.");
    }
  };

  const sinkSupported = isSetSinkIdSupported(audioContext);
  const cat = activeDevice?.category ?? 'unknown';
  const accent = CATEGORY_COLORS[cat];

  // ─── Compact strip (always visible) ────────────────────────────────────────
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group flex items-center gap-2 sm:gap-3 px-3 py-2 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-xl transition-all w-full sm:w-auto"
        title="Output device & lossless inspector"
      >
        <div
          className="flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0"
          style={{ background: `${accent}22`, color: accent }}
        >
          {CATEGORY_ICON_MAP[cat]}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-mono uppercase tracking-widest text-[#8E9299]">Output</span>
            {bitPerfect.bitPerfect && (
              <span className="text-[8px] font-bold text-emerald-400 px-1 py-px bg-emerald-500/15 border border-emerald-500/25 rounded">
                BIT-PERFECT
              </span>
            )}
          </div>
          <div className="text-[11px] font-medium text-white truncate max-w-[160px] sm:max-w-[220px]">
            {activeDevice?.label || (labelsBlocked ? 'Grant permission to see name' : 'System Default')}
          </div>
        </div>
        <div className="hidden sm:flex flex-col items-end text-right">
          <span className="text-[10px] font-mono text-white/85 tabular-nums">{formatRate(ctxRate)}</span>
          {meta?.codec && meta.codec !== 'unknown' && (
            <span className={`text-[8px] font-bold uppercase tracking-wider ${meta.isLossless ? 'text-emerald-300' : 'text-amber-300'}`}>
              {meta.isHiRes ? 'HI-RES' : meta.isLossless ? 'LOSSLESS' : 'LOSSY'}
            </span>
          )}
        </div>
      </button>

      {/* ─── Detail modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: 24, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 24, opacity: 0, scale: 0.97 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#0f1013] border border-white/10 rounded-3xl w-full max-w-2xl flex flex-col max-h-[92vh] overflow-hidden shadow-[0_30px_120px_rgba(0,0,0,0.6)]"
            >
              {/* Header */}
              <div className="px-6 pt-5 pb-4 border-b border-white/5 flex items-start justify-between bg-gradient-to-b from-white/[0.03] to-transparent flex-shrink-0">
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                    <Headphones className="w-4 h-4 text-[#F27D26]" />
                    Audio Output & Source Inspector
                  </h2>
                  <p className="text-[10px] text-[#8E9299] font-mono uppercase tracking-widest mt-1">
                    Device routing · sample-rate · bit-perfect verification
                  </p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 text-[#8E9299] hover:text-white hover:bg-white/5 rounded-lg transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="overflow-y-auto sonic-scroll flex-1 p-5 space-y-5">
                {/* Bit-perfect badge */}
                <div
                  className={`p-4 rounded-2xl border ${
                    bitPerfect.bitPerfect
                      ? 'bg-emerald-500/8 border-emerald-500/30'
                      : 'bg-amber-500/8 border-amber-500/25'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {bitPerfect.bitPerfect
                        ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        : <AlertTriangle className="w-5 h-5 text-amber-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold ${bitPerfect.bitPerfect ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {bitPerfect.bitPerfect ? 'Bit-Perfect Path Active' : 'Sample-Rate Conversion Detected'}
                      </p>
                      <p className="text-[11px] text-white/70 leading-relaxed mt-1">
                        {bitPerfect.message}
                      </p>
                      <div className="flex items-center gap-4 mt-3 text-[10px] font-mono uppercase tracking-widest">
                        <span className="text-[#8E9299]">Source <span className="text-white tabular-nums">{formatRate(meta?.sampleRate)}</span></span>
                        <span className="text-white/30">→</span>
                        <span className="text-[#8E9299]">Engine <span className="text-white tabular-nums">{formatRate(ctxRate)}</span></span>
                      </div>
                      
                      {!bitPerfect.bitPerfect && meta?.sampleRate && onSetExactSampleRate && (
                        <button
                          onClick={() => {
                             onSetExactSampleRate(meta.sampleRate!);
                             setOpen(false);
                          }}
                          className="mt-3 px-3 py-1.5 bg-[#F27D26]/20 hover:bg-[#F27D26]/30 border border-[#F27D26]/40 rounded-lg text-xs font-bold text-[#F27D26] transition-all"
                        >
                          Match Source Format ({formatRate(meta.sampleRate)})
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Source metadata */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-mono uppercase tracking-widest text-[#8E9299]">Source File</h3>
                    {loadingMeta && <Sparkles className="w-3 h-3 text-[#F27D26] animate-pulse" />}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Cell label="Codec"        value={meta?.codec ?? '—'} accent={meta?.isLossless ? '#34d399' : '#fbbf24'} />
                    <Cell label="Quality"      value={meta?.isHiRes ? 'Hi-Res' : meta?.isLossless ? 'Lossless' : (meta?.codec === 'unknown' ? '—' : 'Lossy')} />
                    <Cell label="Sample Rate"  value={formatRate(meta?.sampleRate)} mono />
                    <Cell label="Channels"     value={meta?.channels ? (meta.channels === 1 ? 'Mono' : meta.channels === 2 ? 'Stereo' : `${meta.channels}-ch`) : '—'} />
                    <Cell label="Bit Depth*"   value={meta?.inferredBitDepth ? `${meta.inferredBitDepth}-bit` : '—'} mono />
                    <Cell label="Duration"     value={meta?.duration ? `${Math.floor(meta.duration / 60)}:${String(Math.round(meta.duration % 60)).padStart(2, '0')}` : '—'} mono />
                    <Cell label="Size"         value={formatBytes(meta?.bytes)} mono />
                    <Cell label="Status"       value={meta?.decodeError ? 'Decode err' : 'Ready'} accent={meta?.decodeError ? '#f87171' : '#34d399'} />
                  </div>
                  <p className="text-[9px] text-[#8E9299]/60 mt-1.5 italic">
                    * Bit depth inferred from container + sample rate (Web Audio decodes everything to float32 internally).
                  </p>
                </section>

                {/* Output device picker */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-mono uppercase tracking-widest text-[#8E9299]">Output Device</h3>
                    <button
                      onClick={refreshDevices}
                      className="p-1 text-[#8E9299] hover:text-white rounded transition-colors"
                      title="Re-scan devices"
                    >
                      <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {!sinkSupported && (
                    <div className="mb-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[10px] text-amber-300 font-mono leading-relaxed">
                      Your browser does not allow programmatic output routing. Pick the output device in your OS sound settings, or open in Chrome/Edge 110+.
                    </div>
                  )}

                  {labelsBlocked && permState !== 'denied' && (
                    <div className="space-y-2 mb-2">
                      <button
                        onClick={handleGrantPermission}
                        className="w-full px-3 py-2 bg-[#F27D26]/15 hover:bg-[#F27D26]/25 border border-[#F27D26]/30 rounded-lg text-[10.5px] font-mono uppercase tracking-widest text-[#F27D26] transition-all"
                      >
                        Grant mic permission to see device names
                      </button>
                      {permissionError && (
                        <p className="text-[9px] font-mono text-red-500 uppercase px-1">
                          {permissionError}
                        </p>
                      )}
                    </div>
                  )}
                  {permState === 'denied' && labelsBlocked && (
                    <div className="mb-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[10px] text-amber-300 font-mono leading-relaxed">
                      Permission denied permanently. You can manually name devices by clicking them if they say &apos;Unknown&apos;.
                    </div>
                  )}

                  <div className="space-y-1.5 max-h-60 overflow-y-auto sonic-scroll pr-1">
                    {devices.length === 0 ? (
                      <div className="px-3 py-6 text-center text-[11px] text-[#8E9299]/70">
                        No output devices detected.
                      </div>
                    ) : devices.map((d) => {
                      const isActive = d.deviceId === activeDeviceId;
                      const c = CATEGORY_COLORS[d.category];
                      const isEditing = editingDevice === d.deviceId;
                      return (
                        <div key={d.deviceId || d.label} className="flex gap-2">
                          <button
                            onClick={() => {
                              if (!isEditing) handlePickOutput(d.deviceId);
                            }}
                            disabled={!sinkSupported && d.deviceId !== 'default'}
                            className={`flex-1 flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                              isActive
                                ? 'bg-white/[0.07] border-white/20 shadow-[inset_0_0_0_1px_rgba(242,125,38,0.3)]'
                                : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/10'
                            } ${!sinkSupported && d.deviceId !== 'default' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                          >
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ background: `${c}22`, color: c }}
                            >
                              {CATEGORY_ICON_MAP[d.category]}
                            </div>
                            <div className="flex-1 min-w-0">
                              {isEditing ? (
                                <input
                                  autoFocus
                                  type="text"
                                  value={editLabelValue}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setEditLabelValue(e.target.value)}
                                  onKeyDown={async (e) => {
                                    if (e.key === 'Enter') {
                                      await saveLabelCache(d.deviceId, editLabelValue);
                                      setEditingDevice(null);
                                      refreshDevices();
                                    } else if (e.key === 'Escape') {
                                      setEditingDevice(null);
                                    }
                                  }}
                                  className="w-full bg-black/50 border border-white/20 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-[#F27D26]"
                                  placeholder="e.g. FiiO K9 Pro"
                                />
                              ) : (
                                <div className="text-[11px] font-bold text-white truncate">{d.label || 'Unknown device'}</div>
                              )}
                              <div className="text-[9px] font-mono text-[#8E9299] uppercase tracking-widest mt-0.5 flex items-center gap-2">
                                <span>{CATEGORY_LABELS[d.category]}</span>
                                {d.isHiFiCapable && (
                                  <span className="text-emerald-400">· HiFi capable</span>
                                )}
                              </div>
                            </div>
                            {isActive && !isEditing && (
                              <span className="text-[8px] font-bold text-[#F27D26] tracking-widest">ACTIVE</span>
                            )}
                          </button>
                          {permState === 'denied' && (d.label.includes('Unknown') || isEditing) && d.deviceId && d.deviceId !== 'default' && (
                            <button
                              onClick={async () => {
                                if (isEditing) {
                                  await saveLabelCache(d.deviceId, editLabelValue);
                                  setEditingDevice(null);
                                  refreshDevices();
                                } else {
                                  setEditingDevice(d.deviceId);
                                  setEditLabelValue(d.label.startsWith('Unknown') ? '' : d.label);
                                }
                              }}
                              className="px-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-[#8E9299] flex items-center justify-center transition-colors"
                            >
                              {isEditing ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <span className="text-[10px] uppercase tracking-widest font-mono">Edit</span>}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Device compensation profiles */}
                <section className="bg-orange-500/5 rounded-2xl p-4 border border-orange-500/10">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                       <Cpu className="w-3.5 h-3.5 text-orange-400" />
                       <h3 className="text-[10px] font-mono uppercase tracking-widest text-[#8E9299]">Hardware Bypass (WebUSB)</h3>
                    </div>
                  </div>
                  <div className="flex justify-between items-center mb-4">
                    <div className="text-[10px] text-[#8E9299] max-w-[280px]">
                      Send raw 32-bit floats directly to external DAC via USB, bypassing OS mixer entirely.
                    </div>
                    {onToggleWebUSB && (
                      <button
                        onClick={async () => {
                           try {
                             if (!isWebUSBEnabled) {
                               const success = await onToggleWebUSB(true);
                               // onToggleWebUSB might throw or return a boolean if it checks success
                               setIsWebUSBEnabled(true);
                             } else {
                               setIsWebUSBEnabled(false);
                               await onToggleWebUSB(false);
                             }
                           } catch (err: any) {
                             if (err?.message?.includes('No device selected')) {
                               // User cancelled the prompt, do nothing
                               return;
                             }
                             if (err?.message?.includes('policy') || err?.name === 'SecurityError') {
                               alert('WebUSB is currently blocked in this preview iframe. Please click the "Open in New Tab" button (the diagonal arrow icon at the top right of the preview) to use WebUSB.');
                             } else if (err?.message?.includes('protected class')) {
                               alert('Browser Security: Browsers block raw WebUSB access to standard USB Audio devices. WebUSB bypass only works with audiophile DACs that expose a custom Vendor-Specific interface.');
                             } else if (err?.message?.includes('Could not find Audio Streaming')) {
                               alert('No compatible USB audio OUT endpoint found on this device. Ensure it is an audio output device and try again.');
                             } else {
                               alert('WebUSB Configuration Error: ' + String(err?.message || err));
                             }
                           }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                           isWebUSBEnabled ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-[#34d399]/20 text-[#34d399] border border-[#34d399]/30'
                        }`}
                      >
                         {isWebUSBEnabled ? 'Disable WebUSB' : 'Enable Exclusive USB'}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Target className="w-3.5 h-3.5 text-orange-400" />
                      <h3 className="text-[10px] font-mono uppercase tracking-widest text-orange-200">Device AI Compensation</h3>
                    </div>
                    {activeDeviceProfile && (
                      <span className="text-[8px] font-bold text-orange-400 px-1.5 py-0.5 rounded bg-orange-400/10 border border-orange-400/20">
                        ACTIVE
                      </span>
                    )}
                  </div>

                  {deviceProfiles.length === 0 ? (
                    <div className="text-[10.5px] text-[#8E9299] italic leading-relaxed py-1">
                      No compensation profiles found. Import a REW measurement to help the AI understand your device&apos;s unique sound.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {deviceProfiles.map(p => (
                        <div 
                          key={p.id}
                          className={`flex items-center justify-between p-2 rounded-xl transition-all ${
                            activeDeviceProfile?.id === p.id 
                              ? 'bg-orange-500/10 border border-orange-500/20' 
                              : 'bg-black/20 border border-white/5'
                          }`}
                        >
                          <div 
                            className="flex-1 cursor-pointer"
                            onClick={() => handleToggleCompensation(p.id)}
                          >
                            <div className="text-xs font-bold text-white">{p.name}</div>
                            <div className="text-[9px] font-mono text-[#8E9299] mt-0.5">
                              {new Date(p.timestamp).toLocaleDateString()} · 10-band profile
                            </div>
                          </div>
                          <button 
                            onClick={() => handleDeleteProfile(p.id)}
                            className="p-1.5 text-[#8E9299] hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <p className="text-[9px] text-[#8E9299]/70 mt-3 leading-relaxed">
                    Active compensation adjusts the AI Engine&apos;s learning model to differentiate between your sound preference and device coloration.
                  </p>
                </section>

                {/* Helpful note */}
                <p className="text-[10px] text-[#8E9299]/70 leading-relaxed">
                  Web Audio always processes internally at the AudioContext sample rate (here {formatRate(ctxRate)}).
                  For true bit-perfect playback, your OS / DAC mixer must run at the source rate too.
                  {meta?.sampleRate && meta.sampleRate !== ctxRate && (
                    <> Tip: switch the OS sound device to <b className="text-white/85">{formatRate(meta.sampleRate)}</b>, then reload.</>
                  )}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

// ─── Sub-component: little stat cell ─────────────────────────────────────────

function Cell({
  label, value, mono, accent,
}: { label: string; value: React.ReactNode; mono?: boolean; accent?: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-xl px-3 py-2.5">
      <div className="text-[8.5px] font-mono uppercase tracking-widest text-[#8E9299] leading-none mb-1.5">
        {label}
      </div>
      <div
        className={`text-[12px] font-bold truncate ${mono ? 'font-mono tabular-nums' : ''}`}
        style={{ color: accent || '#fff' }}
      >
        {value}
      </div>
    </div>
  );
}
