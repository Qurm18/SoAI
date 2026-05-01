class HighResProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ringBuffer = []; // Store incoming Float32Array PCM chunks
    this.bufferHead = 0;
    this.isPlaying = false;
    this.ditherEnabled = true;

    this.visPort = null;
    this.visCounter = 0;

    this.port.onmessage = (e) => {
      if (e.data.type === 'chunks') {
        this.ringBuffer.push(...e.data.data);
      } else if (e.data.type === 'play') {
        this.isPlaying = true;
      } else if (e.data.type === 'pause') {
        this.isPlaying = false;
      } else if (e.data.type === 'dither') {
        this.ditherEnabled = e.data.enabled;
      } else if (e.data.type === 'setup_port') {
        this.visPort = e.data.port;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!this.isPlaying || this.ringBuffer.length === 0) {
      return true; // Output silence
    }

    const framesToFill = output[0].length;
    
    // We assume incoming chunks are interleaved Float32Array. 
    // Wait, let's just make it simpler: port receives non-interleaved channels, or we send float32 array chunks per channel.
    // To be efficient, let's say chunk is an array of Float32Arrays [left, right]
    
    const leftOut = output[0];
    const rightOut = output[1] || output[0]; // mono fallback

    for (let i = 0; i < framesToFill; i++) {
        while (this.ringBuffer.length > 0 && this.bufferHead >= this.ringBuffer[0][0].length) {
             this.ringBuffer.shift();
             this.bufferHead = 0;
        }
        
        if (this.ringBuffer.length === 0) {
             this.isPlaying = false; // Stopped
             break;
        }

        const currentChunk = this.ringBuffer[0];
        const leftIn = currentChunk[0];
        const rightIn = currentChunk[1] || currentChunk[0];

        let l = leftIn[this.bufferHead];
        let r = rightIn[this.bufferHead];
        
        if (this.ditherEnabled) {
             // TPDF Dithering logic for optimal quality on local DAC (simulating 16-bit DAC constraints)
             let ditherL = Math.random() - Math.random();
             let ditherR = Math.random() - Math.random();

             // 16-bit scaling
             let valL = l < 0 ? l * 32768 : l * 32767;
             let valR = r < 0 ? r * 32768 : r * 32767;

             l = Math.round(valL + ditherL) / 32768; // back to float
             r = Math.round(valR + ditherR) / 32768; // back to float
        }

        leftOut[i] = l;
        rightOut[i] = r;
        this.bufferHead++;
    }

    if (this.visPort) {
        this.visCounter += framesToFill;
        // Send ~30 fps or roughly every 1470 frames at 44.1kHz (let's use 2048 to be safe)
        if (this.visCounter >= 2048) {
             this.visCounter = 0;
             // Send a copy to avoid neutered objects if something goes wrong, or just slice
             this.visPort.postMessage({ type: 'audio_data', data: leftOut.slice() });
        }
    }

    return true;
  }
}

registerProcessor('high-res-processor', HighResProcessor);
