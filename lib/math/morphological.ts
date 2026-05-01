/**
 * SONIC AI — Phase 4.2: Morphological Filters for Transient Preservation
 *
 * Implements Morphological smoothing (erosion/dilation) on spectrogram data
 */

function erode1D(data: Float32Array, kernelSize: number): Float32Array {
  const result = new Float32Array(data.length);
  const half = Math.floor(kernelSize / 2);
  for (let i = 0; i < data.length; i++) {
    let minVal = Infinity;
    for (let j = -half; j <= half; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < data.length) {
        if (data[idx] < minVal) minVal = data[idx];
      } else {
        // Assume 0 for out of bounds? Or reflect boundary. Using mirror.
        const refIdx = idx < 0 ? -idx : (idx >= data.length ? 2 * data.length - 2 - idx : idx);
        if (data[refIdx] < minVal) minVal = data[refIdx];
      }
    }
    result[i] = minVal;
  }
  return result;
}

function dilate1D(data: Float32Array, kernelSize: number): Float32Array {
  const result = new Float32Array(data.length);
  const half = Math.floor(kernelSize / 2);
  for (let i = 0; i < data.length; i++) {
    let maxVal = -Infinity;
    for (let j = -half; j <= half; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < data.length) {
        if (data[idx] > maxVal) maxVal = data[idx];
      } else {
        const refIdx = idx < 0 ? -idx : (idx >= data.length ? 2 * data.length - 2 - idx : idx);
        if (data[refIdx] > maxVal) maxVal = data[refIdx];
      }
    }
    result[i] = maxVal;
  }
  return result;
}

export function morphologicalSmoothing(
  spectrogram: Float32Array,  // flattened 2D: time × freq
  nTime: number,
  nFreq: number,
  kernelSize: number = 3
): Float32Array {
  // Morphological Opening = Erode -> Dilate (removes small noise spikes, keeps broad shapes)
  // Morphological Closing = Dilate -> Erode (fills small holes)
  
  // We will perform a 1D closing over time for each frequency bin to preserve transients
  // then opening to remove spurious noise.

  const result = new Float32Array(spectrogram.length);

  for (let freqIdx = 0; freqIdx < nFreq; freqIdx++) {
    const timeVec = new Float32Array(nTime);
    for (let t = 0; t < nTime; t++) {
      timeVec[t] = spectrogram[t * nFreq + freqIdx];
    }

    // Closing: Dilate then Erode
    let smoothed = dilate1D(timeVec, kernelSize);
    smoothed = erode1D(smoothed, kernelSize);

    // Opening: Erode then Dilate
    smoothed = erode1D(smoothed, kernelSize);
    smoothed = dilate1D(smoothed, kernelSize);

    for (let t = 0; t < nTime; t++) {
      result[t * nFreq + freqIdx] = smoothed[t];
    }
  }

  return result;
}
