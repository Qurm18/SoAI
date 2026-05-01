class TapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.visPort = null;
    this.visCounter = 0;

    this.port.onmessage = (e) => {
      if (e.data.type === 'setup_port') {
        this.visPort = e.data.port;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    // Pass through
    if (input && output) {
      for (let channel = 0; channel < input.length; channel++) {
         if (output[channel]) {
            output[channel].set(input[channel]);
         }
      }
    }

    if (this.visPort && input && input[0]) {
        this.visCounter += input[0].length;
        if (this.visCounter >= 1024) {
             this.visCounter = 0;
             // Send interleaved or just Left to visualize
             this.visPort.postMessage({ type: 'audio_data', data: input[0].slice() });
        }
    }

    return true;
  }
}

registerProcessor('tap-processor', TapProcessor);
