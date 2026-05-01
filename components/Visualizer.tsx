'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { spectralFlatness, crestFactorDb, findPeaksParabolic, binToHz } from '@/lib/math';

interface VisualizerProps {
  analyzer: AnalyserNode | null;
  analyzerL?: AnalyserNode | null;
  analyzerR?: AnalyserNode | null;
  metrics?: {
    momentary: number;
    shortTerm: number;
    peak: number;
    psr: number;
  };
}

type ViewMode = 'spectrum' | 'waterfall' | 'spectrogram' | 'oscilloscope';

// ─── DSP Math Utilities ───────────────────────────────────────────────────────

function linToDb(lin: number, floor = -96): number {
  if (lin <= 0) return floor;
  return Math.max(floor, 20 * Math.log10(lin));
}

function freqToX(freq: number, minFreq: number, maxFreq: number, width: number): number {
  return (Math.log10(freq / minFreq) / Math.log10(maxFreq / minFreq)) * width;
}

function spectralCentroid(data: Uint8Array, sampleRate: number): number {
  const N = data.length;
  let num = 0, den = 0;
  for (let i = 0; i < N; i++) {
    const freq = (i / N) * (sampleRate / 2);
    const mag = data[i] / 255;
    num += freq * mag;
    den += mag;
  }
  return den > 0 ? num / den : 0;
}

function computeRMS(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 255;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

function spectralFlux(prev: Uint8Array, curr: Uint8Array): number {
  let flux = 0;
  const N = Math.min(prev.length, curr.length);
  for (let i = 0; i < N; i++) {
    const diff = (curr[i] - prev[i]) / 255;
    if (diff > 0) flux += diff * diff;
  }
  return Math.sqrt(flux / N);
}

// Stereo correlation using Pearson product-moment coefficient
function pearsonCorrelation(L: Float32Array, R: Float32Array): number {
  const N = Math.min(L.length, R.length);
  let sumL = 0, sumR = 0, sumL2 = 0, sumR2 = 0, sumLR = 0;
  
  for (let i = 0; i < N; i++) {
    const l = L[i];
    const r = R[i];
    sumL += l;
    sumR += r;
    sumL2 += l * l;
    sumR2 += r * r;
    sumLR += l * r;
  }

  const num = N * sumLR - sumL * sumR;
  const den = Math.sqrt((N * sumL2 - sumL * sumL) * (N * sumR2 - sumR * sumR));
  
  if (den === 0) return 1;
  return Math.max(-1, Math.min(1, num / den));
}

class PeakHolder {
  private peaks: Float32Array;
  private holdCounters: Float32Array;
  private readonly holdFrames: number;
  private readonly decayRate: number;

  constructor(size: number, holdFrames = 50, decayRate = 0.994) {
    this.peaks = new Float32Array(size);
    this.holdCounters = new Float32Array(size);
    this.holdFrames = holdFrames;
    this.decayRate = decayRate;
  }

  update(data: Uint8Array): Float32Array {
    for (let i = 0; i < this.peaks.length && i < data.length; i++) {
      const val = data[i] / 255;
      if (val >= this.peaks[i]) {
        this.peaks[i] = val;
        this.holdCounters[i] = this.holdFrames;
      } else if (this.holdCounters[i] > 0) {
        this.holdCounters[i]--;
      } else {
        this.peaks[i] *= this.decayRate;
      }
    }
    return this.peaks;
  }

  reset() { this.peaks.fill(0); this.holdCounters.fill(0); }
}

class WaterfallBuffer {
  private rows: Uint8Array[];
  private head = 0;
  private count = 0;
  readonly maxRows: number;

  constructor(maxRows: number, bins: number) {
    this.maxRows = maxRows;
    this.rows = Array.from({ length: maxRows }, () => new Uint8Array(bins));
  }

  push(data: Uint8Array) {
    this.rows[this.head].set(data);
    this.head = (this.head + 1) % this.maxRows;
    if (this.count < this.maxRows) this.count++;
  }

  getRow(age: number): Uint8Array | null {
    if (age >= this.count) return null;
    return this.rows[(this.head - 1 - age + this.maxRows) % this.maxRows];
  }

  get length() { return this.count; }
}

// Sonic-branded spectral color (orange-fire gradient with proper perceptual mapping)
function amplitudeToRGB(val: number, palette: string): [number, number, number] {
  const v = Math.max(0, Math.min(1, val));
  if (palette === 'fire') {
    // Perceptual: black → dark red → orange → amber → white
    if (v < 0.25) return [Math.round(v * 4 * 120), 0, 0];
    if (v < 0.55) return [120 + Math.round((v - 0.25) * (135 / 0.3)), Math.round((v - 0.25) * (60 / 0.3)), 0];
    if (v < 0.80) return [242, Math.round(60 + (v - 0.55) * (100 / 0.25)), Math.round((v - 0.55) * (40 / 0.25))];
    return [255, Math.round(160 + (v - 0.8) * (95 / 0.2)), Math.round(40 + (v - 0.8) * (215 / 0.2))];
  }
  if (palette === 'plasma') {
    return [
      Math.round(255 * (0.5 + 0.5 * Math.sin(v * Math.PI * 2.2 - 0.5))),
      Math.round(255 * (0.5 + 0.5 * Math.sin(v * Math.PI * 2.2 + 1.1))),
      Math.round(255 * (0.5 + 0.5 * Math.cos(v * Math.PI * 2.2))),
    ];
  }
  // Ice: black → dark teal → cyan → white
  if (v < 0.4) return [0, Math.round(v * 2.5 * 100), Math.round(v * 2.5 * 160)];
  return [Math.round((v - 0.4) * (255 / 0.6)), Math.round(100 + (v - 0.4) * (155 / 0.6)), 255];
}

// ─── Phase Correlation (Goniometer) ─────────────────────────────────────────

function drawGoniometer(
  ctx: CanvasRenderingContext2D,
  timeBuf: Float32Array,
  W: number, H: number,
  correlation: number
) {
  ctx.fillStyle = '#080810';
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2;
  const r = Math.min(cx, cy) * 0.88;

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Center cross
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.setLineDash([2, 4]);
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
  // Diagonal guides
  ctx.beginPath(); ctx.moveTo(cx - r * 0.7, cy - r * 0.7); ctx.lineTo(cx + r * 0.7, cy + r * 0.7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + r * 0.7, cy - r * 0.7); ctx.lineTo(cx - r * 0.7, cy + r * 0.7); ctx.stroke();
  ctx.setLineDash([]);

  // Labels
  ctx.font = '8px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillText('L', cx - r - 10, cy + 3);
  ctx.fillText('R', cx + r + 2, cy + 3);
  ctx.fillText('+', cx - 5, cy - r + 12);
  ctx.fillText('M', cx - 4, cy - r - 2);

  // Plot Lissajous — use circular buffer, treat adjacent samples as L/R
  const N = Math.min(timeBuf.length, 512);
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < N - 1; i += 1) {
    const L = timeBuf[i];
    const R = timeBuf[Math.min(i + 1, N - 1)]; // offset sample as R proxy
    // Goniometer: rotate 45°: X = (L + R) / √2, Y = (L - R) / √2
    const gx = cx + r * (L + R) * 0.5;
    const gy = cy - r * (L - R) * 0.5;
    const alpha = Math.min(0.7, Math.sqrt(L * L + R * R) * 2);
    ctx.strokeStyle = `rgba(242,125,38,${alpha})`;
    if (first) { ctx.moveTo(gx, gy); first = false; }
    else { ctx.lineTo(gx, gy); }
  }
  ctx.lineWidth = 1;
  ctx.stroke();

  // Correlation meter bar at bottom
  const barW = r * 1.6;
  const barH = 6;
  const barX = cx - barW / 2;
  const barY = cy + r + 10;

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(barX, barY, barW, barH);

  // Color based on correlation
  const corr01 = (correlation + 1) / 2; // 0=anti-phase, 1=mono
  const barColor = corr01 > 0.5
    ? `rgb(${Math.round(40 + (1 - corr01) * 200)},${Math.round(160 + (corr01 - 0.5) * 190)},40)`
    : `rgb(${Math.round(200 + corr01 * 55)},${Math.round(corr01 * 140)},40)`;
  ctx.fillStyle = barColor;
  ctx.fillRect(barX + (1 - corr01) * barW * 0.5, barY, corr01 * barW * 0.5, barH);

  ctx.font = '7px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(`CORR ${correlation.toFixed(2)}`, barX, barY + barH + 10);
}

export const Visualizer: React.FC<VisualizerProps> = React.memo(({ analyzer, analyzerL, analyzerR, metrics }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const goniometerRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const peakRef = useRef<PeakHolder | null>(null);
  const wfRef = useRef<WaterfallBuffer | null>(null);
  const prevRef = useRef<Uint8Array | null>(null);
  const spectroImgRef = useRef<ImageData | null>(null);
  const correlationRef = useRef(1);

  const [mode, setMode] = useState<ViewMode>('spectrum');
  const [palette, setPalette] = useState<'fire' | 'plasma' | 'ice'>('fire');
  const [showPeaks, setShowPeaks] = useState(true);
  const [showGoniometer, setShowGoniometer] = useState(true);
  const [stats, setStats] = useState({ rms: 0, centroid: 0, db: -96, crest: 0, lufs: -70, correlation: 1, coherence: new Array(10).fill(1) });

  const timeBufRef = useRef<Float32Array | null>(null);
  const floatTimeBufRef = useRef<Float32Array | null>(null);

  const MIN_FREQ = 20, MAX_FREQ = 22050;
  const DB_FLOOR = -80, DB_CEIL = 0;

  // Use effective stats that merge high-precision metrics if available
  const effectiveStats = useMemo(() => {
    if (!metrics) return stats;
    return {
      ...stats,
      lufs: Math.round(metrics.shortTerm),
      db: Math.round(metrics.peak),
      crest: metrics.psr
    };
  }, [stats, metrics]);

  const drawSpectrum = useCallback((
    ctx: CanvasRenderingContext2D,
    data: Uint8Array,
    peaks: Float32Array,
    W: number, H: number, sr: number
  ) => {
    // Dark background
    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, W, H);

    const drawH = H - 18;

    // dB grid lines
    const dbSteps = [-72, -60, -48, -36, -24, -12, 0];
    ctx.font = '8px monospace';
    for (const db of dbSteps) {
      const y = drawH - ((db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)) * drawH;
      ctx.strokeStyle = db === 0 ? 'rgba(242,125,38,0.20)' : 'rgba(255,255,255,0.035)';
      ctx.setLineDash(db === 0 ? [] : [3, 5]);
      ctx.lineWidth = db === 0 ? 1.5 : 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillText(`${db}`, 3, y - 2);
    }

    // Frequency grid
    const gridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    for (const f of gridFreqs) {
      const x = freqToX(f, MIN_FREQ, MAX_FREQ, W);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, drawH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 1, H - 3);
    }

    // Spectrum fill — two-pass for glow effect
    const bins = data.length;

    // Shadow / glow pass (wider, dimmer)
    ctx.beginPath();
    let started = false;
    for (let i = 1; i < bins; i++) {
      const freq = (i / bins) * sr;
      if (freq < MIN_FREQ || freq > MAX_FREQ) continue;
      const x = freqToX(freq, MIN_FREQ, MAX_FREQ, W);
      const db = linToDb(data[i] / 255, DB_FLOOR);
      const y = drawH - ((db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)) * drawH;
      if (!started) { ctx.moveTo(x, drawH); ctx.lineTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(W, drawH);
    ctx.closePath();
    const glowGrad = ctx.createLinearGradient(0, 0, 0, drawH);
    glowGrad.addColorStop(0, 'rgba(242,125,38,0.12)');
    glowGrad.addColorStop(0.6, 'rgba(242,80,20,0.04)');
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glowGrad;
    // REMOVED ctx.filter = 'blur(3px)' - too expensive for many browsers
    ctx.fill();

    // Main spectrum fill
    ctx.beginPath();
    started = false;
    for (let i = 1; i < bins; i++) {
      const freq = (i / bins) * sr;
      if (freq < MIN_FREQ || freq > MAX_FREQ) continue;
      const x = freqToX(freq, MIN_FREQ, MAX_FREQ, W);
      const db = linToDb(data[i] / 255, DB_FLOOR);
      const y = drawH - ((db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)) * drawH;
      if (!started) { ctx.moveTo(x, drawH); ctx.lineTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(W, drawH);
    ctx.closePath();
    const mainGrad = ctx.createLinearGradient(0, 0, 0, drawH);
    mainGrad.addColorStop(0, 'rgba(255,100,30,0.92)');
    mainGrad.addColorStop(0.3, 'rgba(242,125,38,0.70)');
    mainGrad.addColorStop(0.7, 'rgba(180,60,0,0.30)');
    mainGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mainGrad;
    ctx.fill();

    // Spectrum line (top edge)
    ctx.beginPath();
    started = false;
    for (let i = 1; i < bins; i++) {
      const freq = (i / bins) * sr;
      if (freq < MIN_FREQ || freq > MAX_FREQ) continue;
      const x = freqToX(freq, MIN_FREQ, MAX_FREQ, W);
      const db = linToDb(data[i] / 255, DB_FLOOR);
      const y = drawH - ((db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)) * drawH;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255,150,60,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Peak indicators
    if (showPeaks) {
      for (let i = 1; i < bins; i++) {
        const freq = (i / bins) * sr;
        if (freq < MIN_FREQ || freq > MAX_FREQ || peaks[i] < 0.015) continue;
        const x = freqToX(freq, MIN_FREQ, MAX_FREQ, W);
        const y = drawH - ((linToDb(peaks[i], DB_FLOOR) - DB_FLOOR) / (DB_CEIL - DB_FLOOR)) * drawH;
        ctx.fillStyle = 'rgba(255,220,100,0.65)';
        ctx.fillRect(x - 0.5, y, 1.5, 2);
      }
    }
  }, [showPeaks, DB_FLOOR, DB_CEIL, MIN_FREQ, MAX_FREQ]);

  const drawWaterfall = useCallback((ctx: CanvasRenderingContext2D, buf: WaterfallBuffer, data: Uint8Array, W: number, H: number, sr: number) => {
    buf.push(data);
    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, W, H);
    const drawH = H - 12;
    const rowH = Math.max(1, drawH / buf.maxRows);
    for (let age = 0; age < buf.maxRows; age++) {
      const row = buf.getRow(age);
      if (!row) continue;
      const y = age * rowH;
      for (let i = 1; i < data.length; i++) {
        const freq = (i / data.length) * sr;
        if (freq < MIN_FREQ || freq > MAX_FREQ) continue;
        const x = freqToX(freq, MIN_FREQ, MAX_FREQ, W);
        const [r, g, b] = amplitudeToRGB(row[i] / 255, palette);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, 2, rowH + 0.5);
      }
    }
    // Freq labels
    const gridFreqs = [50, 100, 500, 1000, 5000, 10000];
    ctx.font = '7px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (const f of gridFreqs) {
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, freqToX(f, MIN_FREQ, MAX_FREQ, W) + 1, H - 1);
    }
  }, [palette, MIN_FREQ, MAX_FREQ]);

  const drawSpectrogram = useCallback((ctx: CanvasRenderingContext2D, data: Uint8Array, W: number, H: number) => {
    if (!spectroImgRef.current || spectroImgRef.current.width !== W) spectroImgRef.current = ctx.createImageData(W, H);
    const d = spectroImgRef.current.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W - 1; x++) {
        const dst = (y * W + x) * 4; const src = dst + 4;
        d[dst] = d[src]; d[dst+1] = d[src+1]; d[dst+2] = d[src+2]; d[dst+3] = d[src+3];
      }
    }
    for (let y = 0; y < H; y++) {
      const [r, g, b] = amplitudeToRGB(data[Math.floor((1 - y / H) * data.length)] / 255, palette);
      const idx = (y * W + W - 1) * 4;
      d[idx] = r; d[idx+1] = g; d[idx+2] = b; d[idx+3] = 255;
    }
    ctx.putImageData(spectroImgRef.current, 0, 0);
  }, [palette]);

  const drawOscilloscope = useCallback((
    ctx: CanvasRenderingContext2D,
    timeBuf: Float32Array,
    W: number, H: number
  ) => {
    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, W, H);
    const cy = H / 2;

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 8]);
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
    ctx.setLineDash([]);

    // Amplitude guides
    for (const level of [0.5, -0.5, 0.25, -0.25]) {
      const y = cy - level * cy;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Find zero crossing for stable display (oscilloscope trigger)
    const N = Math.min(timeBuf.length, 1024);
    let start = 0;
    for (let i = 1; i < N * 0.5; i++) {
      if (timeBuf[i - 1] <= 0 && timeBuf[i] > 0) { start = i; break; }
    }
    const displayN = Math.min(N - start, Math.floor(N * 0.75));

    // Glow pass
    ctx.beginPath();
    for (let i = 0; i < displayN; i++) {
      const x = (i / displayN) * W;
      const y = cy - timeBuf[start + i] * cy * 0.9;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(242,125,38,0.18)';
    ctx.lineWidth = 6;
    ctx.filter = 'blur(4px)';
    ctx.stroke();
    ctx.filter = 'none';

    // Main waveform
    ctx.beginPath();
    for (let i = 0; i < displayN; i++) {
      const x = (i / displayN) * W;
      const y = cy - timeBuf[start + i] * cy * 0.9;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // Gradient stroke — not natively supported, use linear gradient fill trick
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(255,100,30,0.3)');
    grad.addColorStop(0.4, 'rgba(242,125,38,0.95)');
    grad.addColorStop(1, 'rgba(255,180,60,0.5)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // RMS envelope shading
    const rms = computeRMS(new Uint8Array(Array.from({ length: N }, (_, i) => Math.round((timeBuf[i] * 0.5 + 0.5) * 255))));
    ctx.fillStyle = `rgba(242,125,38,${rms * 0.04})`;
    ctx.fillRect(0, cy - rms * cy, W, rms * cy * 2);
  }, []);

  useEffect(() => {
    if (!analyzer || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const sr = (analyzer.context as AudioContext).sampleRate;
    const bins = analyzer.frequencyBinCount;
    peakRef.current = new PeakHolder(bins);
    wfRef.current = new WaterfallBuffer(90, bins);
    prevRef.current = new Uint8Array(bins);
    timeBufRef.current = new Float32Array(analyzer.fftSize);
    floatTimeBufRef.current = new Float32Array(analyzer.fftSize);

    const data = new Uint8Array(bins);
    const dataL = new Float32Array(analyzerL?.fftSize || 0);
    const dataR = new Float32Array(analyzerR?.fftSize || 0);
    let frame = 0;

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      
      if (analyzer.context.state !== 'running') return;

      analyzer.getByteFrequencyData(data);
      const peaks = peakRef.current!.update(data);
      const tBuf = timeBufRef.current!;
      analyzer.getFloatTimeDomainData(tBuf as any);

      if (frame % 5 === 0) { // Throttled update for UI stats
        const rms = computeRMS(data);
        const lufs = Math.max(-70, 20 * Math.log10(rms / 255 + 1e-6) - 3);
        
        let corr = correlationRef.current;
        if (analyzerL && analyzerR) {
          analyzerL.getFloatTimeDomainData(dataL);
          analyzerR.getFloatTimeDomainData(dataR);
          corr = pearsonCorrelation(dataL, dataR);
        } else {
          // Fallback
          const N = Math.min(tBuf.length, 256);
          const L = tBuf.subarray(0, N);
          const R = tBuf.subarray(1, N + 1); // 1-sample offset trick (less accurate)
          corr = pearsonCorrelation(L as any, R as any);
        }

        correlationRef.current = corr * 0.15 + correlationRef.current * 0.85; 

        let coherent: number[] = new Array(10).fill(1);
        if ((window as any).__ENGINE__) {
          const raw = (window as any).__ENGINE__.getPhaseCoherenceSpectrum();
          if (raw && raw.length > 0) {
             const bands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
             const sr = (analyzer.context as AudioContext).sampleRate;
             const bins = raw.length;
             coherent = bands.map((f, i) => {
               const bin = Math.min(bins - 1, Math.round((f / (sr / 2)) * bins));
               return raw[bin];
             });
          }
        }

        setStats({
          rms,
          centroid: Math.round(spectralCentroid(data, sr)),
          db: Math.round(linToDb(rms)),
          crest: crestFactorDb(tBuf),
          lufs: Math.round(lufs),
          correlation: Math.round(correlationRef.current * 100) / 100,
          coherence: coherent
        });
        prevRef.current!.set(data);
      }
      frame++;

      const W = canvas.width, H = canvas.height;
      if (mode === 'spectrum') drawSpectrum(ctx, data, peaks, W, H, sr);
      else if (mode === 'waterfall' && frame % 2 === 0) drawWaterfall(ctx, wfRef.current!, data, W, H, sr);
      else if (mode === 'spectrogram' && frame % 2 === 0) drawSpectrogram(ctx, data, W, H);
      else if (mode === 'oscilloscope') drawOscilloscope(ctx, tBuf, W, H);

      // Goniometer - throttled draw
      if (showGoniometer && goniometerRef.current && frame % 3 === 0) {
        const gc = goniometerRef.current.getContext('2d', { alpha: false });
        if (gc) {
          const GW = goniometerRef.current.width;
          const GH = goniometerRef.current.height;
          drawGoniometer(gc, tBuf, GW, GH, correlationRef.current);
        }
      }
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [analyzer, analyzerL, analyzerR, mode, showPeaks, showGoniometer, drawSpectrum, drawWaterfall, drawSpectrogram, drawOscilloscope]);

  // Correlation color
  const corrColor = effectiveStats.correlation > 0.5 ? '#4ade80' : effectiveStats.correlation > 0 ? '#fbbf24' : '#f87171';

  return (
    <div className="w-full bg-[#08080f] rounded-xl border border-white/8 overflow-hidden">
      {/* Controls bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
        <div className="flex gap-1">
          {(['spectrum', 'waterfall', 'spectrogram', 'oscilloscope'] as ViewMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2 py-0.5 rounded text-[9px] uppercase font-mono tracking-wider transition-all ${
                mode === m ? 'bg-[#F27D26] text-black font-bold' : 'text-gray-500 hover:text-gray-300'
              }`}>
              {m === 'oscilloscope' ? 'scope' : m}
            </button>
          ))}
          {mode === 'waterfall' || mode === 'spectrogram' ? (
            <select value={palette} onChange={e => setPalette(e.target.value as any)}
              className="ml-1 px-1 py-0.5 rounded text-[9px] bg-white/5 text-gray-400 border-0 cursor-pointer">
              <option value="fire">Fire</option>
              <option value="plasma">Plasma</option>
              <option value="ice">Ice</option>
            </select>
          ) : null}
        </div>

        {/* Meters */}
        <div className="text-[8px] font-mono flex gap-3 items-center">
          <span className="text-gray-500">LUFS <span className="text-[#F27D26]">{effectiveStats.lufs}</span></span>
          <span className="text-gray-500">CF <span className="text-amber-400">{effectiveStats.crest.toFixed(1)}dB</span></span>
          <span className="text-gray-500">SC <span style={{ color: corrColor }}>{effectiveStats.correlation.toFixed(2)}</span></span>
          <button
            onClick={() => setShowGoniometer(g => !g)}
            className={`px-1.5 py-0.5 rounded text-[8px] uppercase font-mono ${showGoniometer ? 'bg-[#F27D26]/20 text-[#F27D26]' : 'text-gray-600'}`}>
            ⟲ PHASE
          </button>
        </div>
      </div>

      {/* Main canvas */}
      <canvas ref={canvasRef} width={1200} height={180} className="w-full h-[180px] block" />

      {/* Goniometer */}
      {showGoniometer && (
        <div className="border-t border-white/5 flex items-center gap-3 px-3 py-1.5">
          <canvas ref={goniometerRef} width={110} height={110}
            className="rounded-lg border border-white/5 flex-shrink-0" />
          <div className="flex flex-col gap-1 text-[8px] font-mono">
            <div className="text-gray-500 uppercase tracking-wider">Phase Correlation</div>
            <div className="flex items-center gap-2">
              <div className="w-24 h-2.5 bg-white/5 rounded-full overflow-hidden relative">
                <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-200"
                  style={{
                    width: `${((effectiveStats.correlation + 1) / 2 * 100).toFixed(0)}%`,
                    background: `linear-gradient(to right, #f87171, #fbbf24, #4ade80)`
                  }} />
              </div>
              <span style={{ color: corrColor }} className="font-bold">{effectiveStats.correlation.toFixed(2)}</span>
            </div>
            <div className="flex flex-col gap-1 text-[8px] font-mono">
              <div className="text-gray-500 uppercase tracking-wider">MSC Coherence (Freq)</div>
              <div className="flex items-end gap-[1px] h-6 w-24 bg-white/5 p-[1px] rounded">
                {(effectiveStats as any).coherence.map((c: number, i: number) => (
                  <div key={i} className="flex-1 rounded-t-[1px] transition-all duration-300"
                    style={{
                      height: `${(c * 100).toFixed(0)}%`,
                      background: c < 0.3 ? '#f87171' : c < 0.7 ? '#fbbf24' : '#4ade80',
                      opacity: 0.6 + c * 0.4
                    }} />
                ))}
              </div>
            </div>
            <div className="text-gray-600 mt-1">
              {effectiveStats.correlation > 0.7 ? '✓ Strong mono compat'
               : effectiveStats.correlation > 0.3 ? '◈ Good stereo width'
               : effectiveStats.correlation > 0 ? '◈ Wide stereo'
               : '⚠ Phase issues'}
            </div>
            <div className="text-gray-500 mt-1">Centroid <span className="text-gray-300">{effectiveStats.centroid >= 1000 ? `${(effectiveStats.centroid/1000).toFixed(1)}k` : effectiveStats.centroid} Hz</span></div>
            <div className="text-gray-500">Peak <span className="text-gray-300">{effectiveStats.db} dBFS</span></div>
          </div>
        </div>
      )}
    </div>
  );
});

Visualizer.displayName = 'Visualizer';
