// Common headphone / loudspeaker target curves.
// Values are gain (dB) at the listed frequency (Hz), interpolated
// log-linearly when sampled in between.

export interface TargetCurve {
  id: string;
  name: string;
  description: string;
  points: { freq: number; gain: number }[];
}

// Harman over-ear target (2018), normalised to 0 dB @ 500 Hz.
const HARMAN_OE_2018: { freq: number; gain: number }[] = [
  { freq: 20,    gain:  6.4 },
  { freq: 32,    gain:  5.6 },
  { freq: 50,    gain:  4.6 },
  { freq: 80,    gain:  3.5 },
  { freq: 125,   gain:  2.6 },
  { freq: 200,   gain:  1.6 },
  { freq: 315,   gain:  0.7 },
  { freq: 500,   gain:  0.0 },
  { freq: 800,   gain: -0.4 },
  { freq: 1250,  gain: -0.2 },
  { freq: 2000,  gain:  2.4 },
  { freq: 3000,  gain:  6.4 },
  { freq: 4000,  gain:  4.5 },
  { freq: 5000,  gain:  3.0 },
  { freq: 6300,  gain:  2.8 },
  { freq: 8000,  gain:  1.0 },
  { freq: 10000, gain: -1.0 },
  { freq: 12500, gain: -3.0 },
  { freq: 16000, gain: -5.5 },
  { freq: 20000, gain: -8.0 },
];

// Diffuse-field-style flatter target (gentle bass shelf, mild presence).
const DIFFUSE_FIELD: { freq: number; gain: number }[] = [
  { freq: 20,    gain:  3.0 },
  { freq: 60,    gain:  2.0 },
  { freq: 200,   gain:  0.5 },
  { freq: 500,   gain:  0.0 },
  { freq: 1000,  gain:  0.0 },
  { freq: 2500,  gain:  3.0 },
  { freq: 4000,  gain:  4.0 },
  { freq: 8000,  gain:  1.5 },
  { freq: 12000, gain: -1.0 },
  { freq: 16000, gain: -3.0 },
  { freq: 20000, gain: -5.0 },
];

// Flat (reference / mastering) target — perfectly 0 dB across the band.
const FLAT: { freq: number; gain: number }[] = [
  { freq: 20,    gain: 0 },
  { freq: 20000, gain: 0 },
];

// Harman in-ear monitor target (Olive et al. 2019)
// Normalised to 0 dB @ 1000 Hz
const HARMAN_IEM_2019: { freq: number; gain: number }[] = [
  { freq: 20,    gain:  5.0 },
  { freq: 32,    gain:  4.8 },
  { freq: 50,    gain:  4.5 },
  { freq: 80,    gain:  4.0 },
  { freq: 125,   gain:  3.2 },
  { freq: 200,   gain:  2.0 },
  { freq: 315,   gain:  1.0 },
  { freq: 500,   gain:  0.3 },
  { freq: 1000,  gain:  0.0 },
  { freq: 2000,  gain:  1.5 },
  { freq: 3000,  gain:  4.5 },
  { freq: 4000,  gain:  5.0 },
  { freq: 5000,  gain:  4.0 },
  { freq: 6300,  gain:  2.5 },
  { freq: 8000,  gain:  0.0 },
  { freq: 10000, gain: -2.0 },
  { freq: 12500, gain: -4.5 },
  { freq: 16000, gain: -7.0 },
  { freq: 20000, gain: -10.0 },
];

// Etymotic Diffuse-Field (ER-4 reference)
const ETYMOTIC_DF: { freq: number; gain: number }[] = [
  { freq: 20,    gain:  0.0 },
  { freq: 200,   gain:  0.0 },
  { freq: 1000,  gain:  0.0 },
  { freq: 2500,  gain:  4.0 },
  { freq: 3200,  gain:  6.5 },
  { freq: 4000,  gain:  6.0 },
  { freq: 5000,  gain:  3.5 },
  { freq: 6300,  gain:  1.5 },
  { freq: 8000,  gain: -1.0 },
  { freq: 10000, gain: -3.5 },
  { freq: 12500, gain: -6.0 },
  { freq: 16000, gain: -9.0 },
  { freq: 20000, gain: -12.0 },
];

export const TARGET_CURVES: TargetCurve[] = [
  {
    id: 'flat',
    name: 'Flat',
    description: 'Reference / mastering. No tonal preference.',
    points: FLAT,
  },
  {
    id: 'harman',
    name: 'Harman OE 2018',
    description: 'Olive/Welti preferred over-ear target.',
    points: HARMAN_OE_2018,
  },
  {
    id: 'diffuse',
    name: 'Diffuse-Field',
    description: 'Smoother neutral target with mild bass + presence.',
    points: DIFFUSE_FIELD,
  },
  {
    id: 'harman_iem',
    name: 'Harman IEM 2019',
    description: 'Olive et al. preferred in-ear monitor target.',
    points: HARMAN_IEM_2019,
  },
  {
    id: 'etymotic_df',
    name: 'Etymotic Diffuse-Field',
    description: 'Reference target cho tai nghe in-ear chuẩn thính học.',
    points: ETYMOTIC_DF,
  },
];

// Log-linear interpolation between target points.
export function sampleTarget(curve: TargetCurve, freq: number): number {
  const pts = curve.points;
  if (freq <= pts[0].freq) return pts[0].gain;
  if (freq >= pts[pts.length - 1].freq) return pts[pts.length - 1].gain;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (freq >= a.freq && freq <= b.freq) {
      const t = (Math.log10(freq) - Math.log10(a.freq)) /
                (Math.log10(b.freq) - Math.log10(a.freq));
      return a.gain + t * (b.gain - a.gain);
    }
  }
  return 0;
}
