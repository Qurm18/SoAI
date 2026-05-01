class USBBridgeProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0] || !input[1]) return true;

    const length = input[0].length;
    const int16Buffer = new Int16Array(length * 2);

    const left = input[0];
    const right = input[1] || input[0]; // fallback to mono if right is missing

    for (let i = 0; i < length; i++) {
      let l = Math.max(-1, Math.min(1, left[i]));
      let r = Math.max(-1, Math.min(1, right[i]));
      
      // TPDF Dithering: add two independent uniformly distributed random variables (-1 to +1 LSB total)
      let ditherL = Math.random() - Math.random();
      let ditherR = Math.random() - Math.random();

      // Multiply to 16-bit range, add dither and round
      let valL = l < 0 ? l * 32768 : l * 32767;
      let valR = r < 0 ? r * 32768 : r * 32767;

      int16Buffer[i * 2] = Math.round(valL + ditherL);
      int16Buffer[i * 2 + 1] = Math.round(valR + ditherR);
    }

    this.port.postMessage(int16Buffer.buffer, [int16Buffer.buffer]);
    return true;
  }
}

registerProcessor('usb-bridge-processor', USBBridgeProcessor);
