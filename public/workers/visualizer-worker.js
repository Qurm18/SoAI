let canvasCtx = null;
let canvasWidth = 0;
let canvasHeight = 0;

self.onmessage = (e) => {
  if (e.data.type === 'init') {
    const canvas = e.data.canvas;
    canvasCtx = canvas.getContext('2d', { alpha: false });
    canvasWidth = canvas.width;
    canvasHeight = canvas.height;
  } else if (e.data.type === 'setup_port') {
    const port = e.data.port;
    port.onmessage = (event) => {
       if (event.data.type === 'audio_data') {
           drawOscilloscope(event.data.data);
       }
    };
  }
};

function drawOscilloscope(data) {
  if (!canvasCtx) return;
  canvasCtx.fillStyle = 'rgb(10, 10, 10)';
  canvasCtx.fillRect(0, 0, canvasWidth, canvasHeight);

  canvasCtx.lineWidth = 2;
  canvasCtx.strokeStyle = 'rgb(0, 255, 100)';
  canvasCtx.beginPath();

  const sliceWidth = canvasWidth / data.length;
  let x = 0;

  for (let i = 0; i < data.length; i++) {
    const v = data[i] * 0.5 + 0.5; // -1 to 1 => 0 to 1
    const y = v * canvasHeight;

    if (i === 0) {
      canvasCtx.moveTo(x, y);
    } else {
      canvasCtx.lineTo(x, y);
    }
    x += sliceWidth;
  }
  canvasCtx.stroke();
}
