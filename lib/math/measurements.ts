/**
 * SONIC — Measurement Data Parsers (REW, CSV)
 */

export interface MeasurementData {
  frequencies: number[];
  magnitudes: number[];
  phases?: number[];
}

/**
 * Parses REW (Room EQ Wizard) text export.
 * Format usually: 
 * Freq(Hz) SPL(dB) Phase(deg)
 * 20.00 75.4 0.0
 */
export function parseRewData(text: string): MeasurementData {
  const lines = text.split(/\r?\n/);
  const frequencies: number[] = [];
  const magnitudes: number[] = [];
  const phases: number[] = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('*') || line.startsWith(';') || /[a-zA-Z]/.test(line.split(/\s+/)[0])) {
      continue;
    }

    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      frequencies.push(parts[0]);
      magnitudes.push(parts[1]);
      if (!isNaN(parts[2])) phases.push(parts[2]);
    }
  }

  return { frequencies, magnitudes, phases: phases.length ? phases : undefined };
}

/**
 * Parses CSV measurement data.
 * Supports comma, semicolon, or tab delimited.
 * Looks for columns that look like Freq and Magnitude.
 */
export function parseCsvMeasurement(text: string): MeasurementData {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) throw new Error('Empty CSV file');

  // Detect delimiter
  const firstLine = lines[0];
  let delimiter = ',';
  if (firstLine.includes('\t')) delimiter = '\t';
  else if (firstLine.includes(';')) delimiter = ';';

  const frequencies: number[] = [];
  const magnitudes: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(delimiter).map(p => p.trim());
    
    // Skip header
    if (i === 0 && (parts[0].toLowerCase().includes('freq') || isNaN(Number(parts[0])))) {
      continue;
    }

    const f = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);

    if (!isNaN(f) && !isNaN(m)) {
      frequencies.push(f);
      magnitudes.push(m);
    }
  }

  if (frequencies.length === 0) {
    throw new Error('No valid numeric data found in CSV. Ensure the first column is frequency and second column is magnitude.');
  }

  return { frequencies, magnitudes };
}

/**
 * Logarithmic interpolation of measurement data to specific target bands.
 */
export function interpolateRewToBands(
  srcFreqs: number[],
  srcMags: number[],
  targetFreqs: number[]
): number[] {
  if (srcFreqs.length === 0) return targetFreqs.map(() => 0);

  return targetFreqs.map(tf => {
    // Exact match
    const exactIdx = srcFreqs.indexOf(tf);
    if (exactIdx !== -1) return srcMags[exactIdx];

    // Find neighbours
    let lowerIdx = -1;
    let upperIdx = -1;

    for (let i = 0; i < srcFreqs.length; i++) {
      if (srcFreqs[i] < tf) lowerIdx = i;
      if (srcFreqs[i] > tf && upperIdx === -1) {
        upperIdx = i;
        break;
      }
    }

    // Boundary cases
    if (lowerIdx === -1) return srcMags[0];
    if (upperIdx === -1) return srcMags[srcMags.length - 1];

    // Linear interpolation on log-frequency scale
    const f1 = srcFreqs[lowerIdx];
    const f2 = srcFreqs[upperIdx];
    const m1 = srcMags[lowerIdx];
    const m2 = srcMags[upperIdx];

    const logF = Math.log10(tf);
    const logF1 = Math.log10(f1);
    const logF2 = Math.log10(f2);

    const t = (logF - logF1) / (logF2 - logF1);
    return m1 + t * (m2 - m1);
  });
}
