'use client';

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, X, Check, AlertCircle, FileText, FileSpreadsheet } from 'lucide-react';
import { parseRewData, parseCsvMeasurement, interpolateRewToBands, MeasurementData } from '@/lib/math';
import { EQBand } from '@/lib/audio-engine';
import { saveDeviceProfile } from '@/lib/profile-store';

interface RewImportProps {
  onApply: (gains: number[]) => void;
  onClose: () => void;
}

export const RewImport: React.FC<RewImportProps> = ({ onApply, onClose }) => {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number[] | null>(null);
  const [measuredData, setMeasuredData] = useState<number[] | null>(null);
  const [isDeviceCompensation, setIsDeviceCompensation] = useState(true);
  const [shouldApplyEq, setShouldApplyEq] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setText(content);
      setError(null);
      
      // Auto-process if it looks like REW or CSV
      if (file.name.endsWith('.csv')) {
        setIsDeviceCompensation(true);
        setShouldApplyEq(false);
        processContent(content, 'csv');
      } else {
        processContent(content, 'txt');
      }
    };
    reader.onerror = () => setError('Failed to read file.');
    reader.readAsText(file);
  };

  const processContent = (input: string, type: 'txt' | 'csv') => {
    try {
      let data: MeasurementData;
      if (type === 'csv') {
        data = parseCsvMeasurement(input);
      } else {
        data = parseRewData(input);
      }

      if (data.frequencies.length < 5) {
        throw new Error('Not enough data points found in the input. Expected frequency/magnitude pairs.');
      }
      
      const targetFreqs = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
      const interpolated = interpolateRewToBands(data.frequencies, data.magnitudes, targetFreqs);
      
      // Normalize measurement so average is around 0dB (or 75dB if REW SPL)
      // Usually SPL is ~75dB, but we want relative deviations.
      const avg = interpolated.reduce((a, b) => a + b, 0) / interpolated.length;
      const deviations = interpolated.map(m => m - avg);
      
      // Calculate correction gains: Target (0dB) - Deviations
      // We limit correction to +6dB to avoid speaker damage
      const correction = deviations.map(dev => Math.max(-12, Math.min(6, 0 - dev)));
      
      setMeasuredData(deviations);
      setPreview(correction);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to parse measurement data.');
      setPreview(null);
      setMeasuredData(null);
    }
  };

  const handleProcess = () => {
    // Try TXT first, then CSV if it fails
    try {
      processContent(text, 'txt');
    } catch (e) {
      processContent(text, 'csv');
    }
  };

  const handleConfirm = () => {
    if (preview) {
      if (isDeviceCompensation && measuredData) {
        saveDeviceProfile(deviceName || 'My Device', measuredData);
      }
      
      if (shouldApplyEq) {
        onApply(preview);
      }
      
      onClose();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="w-full max-w-lg bg-[#161719] rounded-3xl border border-white/10 shadow-2xl overflow-hidden"
      >
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-orange-500/10 text-orange-500">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Measurement Import</h2>
              <p className="text-xs text-[#8E9299]">Paste or upload REW text / CSV data</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors text-[#8E9299] hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <div className="flex gap-2">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-all"
            >
              <FileText className="w-4 h-4 text-orange-400" />
              Upload TXT
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest transition-all"
            >
              <FileSpreadsheet className="w-4 h-4 text-green-400" />
              Upload CSV
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept=".txt,.csv" 
              className="hidden" 
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-mono text-[#8E9299] uppercase tracking-widest px-1">Or paste data here</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Freq(Hz)  SPL(dB)  Phase(deg)&#10;20.00   75.4   0.0&#10;..."
              className="w-full h-32 bg-black/40 border border-white/5 rounded-2xl p-4 text-xs font-mono text-white/80 outline-none focus:border-orange-500/30 transition-all resize-none"
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-red-400 text-xs italic">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {preview && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="p-3 rounded-xl bg-green-500/5 border border-green-500/10">
                <div className="text-[10px] font-mono text-green-400 uppercase mb-2">Target Correction Path</div>
                <div className="flex items-center justify-between h-8 gap-1">
                  {preview.map((g, i) => (
                    <div key={i} className="flex-1 bg-white/5 rounded-full relative overflow-hidden h-full">
                      <div 
                        className={`absolute inset-x-0 bottom-0 rounded-full ${g >= 0 ? 'bg-green-500/40' : 'bg-red-500/40'}`} 
                        style={{ height: `${Math.min(100, Math.abs(g) * 8)}%` }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={isDeviceCompensation}
                      onChange={(e) => setIsDeviceCompensation(e.target.checked)}
                      className="w-4 h-4 rounded border-white/10 bg-black/40 text-orange-500 focus:ring-0"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-white/90">Store as Hardware Baseline</span>
                      <span className="text-[10px] text-[#8E9299]">AI uses this as a weight factor to distinguish gear limits from your taste.</span>
                    </div>
                  </label>
                  
                  {isDeviceCompensation && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="pl-7 overflow-hidden"
                    >
                      <input 
                        type="text"
                        value={deviceName}
                        onChange={(e) => setDeviceName(e.target.value)}
                        placeholder="Enter device name (e.g. Sony XM5)"
                        className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-2 text-xs text-white outline-none focus:border-orange-500/30 transition-all font-mono"
                      />
                    </motion.div>
                  )}
                </div>

                <div className="h-px bg-white/5 w-full" />

                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={shouldApplyEq}
                    onChange={(e) => setShouldApplyEq(e.target.checked)}
                    className="w-4 h-4 rounded border-white/10 bg-black/40 text-green-500 focus:ring-0"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-white/90 italic">Apply Inverse Correction to EQ</span>
                    <span className="text-[10px] text-[#8E9299]">Automatically compensate active bands to flatten response immediately.</span>
                  </div>
                </label>
              </div>
            </motion.div>
          )}
        </div>

        <div className="p-6 bg-black/20 border-t border-white/5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white text-xs font-bold uppercase tracking-widest transition-all"
          >
            Cancel
          </button>
          {!preview ? (
            <button
              onClick={handleProcess}
              disabled={!text.trim()}
              className="flex-[2] py-3 px-4 rounded-2xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:grayscale transition-all text-black font-bold uppercase tracking-widest flex items-center justify-center gap-2"
            >
              Analyze <Check className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              className={`flex-[2] py-3 px-4 rounded-2xl font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                isDeviceCompensation ? 'bg-orange-500 hover:bg-orange-600 text-black' : 'bg-green-500 hover:bg-green-600 text-black'
              }`}
            >
              {isDeviceCompensation ? 'Save Baseline' : 'Apply Correction'} 
              {shouldApplyEq && isDeviceCompensation && ' & Apply'}
              <Check className="w-4 h-4" />
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
