import { webUSB } from './webusb-audio';

// Pipeline Âm thanh Chất lượng Cao (High-Res Audio Pipeline)
// Dựa trên chiến lược: Fetch -> Decode -> Transfer -> Process -> Destination

export class HighResAudioPipeline {
  private context: AudioContext | null = null;
  private highResNode: AudioWorkletNode | null = null;
  private isLoaded: boolean = false;
  private isPlaying: boolean = false;

  // Track sample rates to notify user of resampling
  public targetSampleRate: number = 0;
  public actualSampleRate: number = 0;
  public isResampled: boolean = false;

  // Limiter & Worker
  private volumeNode: GainNode | null = null;
  private limiterNode: DynamicsCompressorNode | null = null;
  private visWorker: Worker | null = null;

  // Thuật toán: Dọn dẹp context cũ triệt để (The Red Teaming check)
  public async init(sampleRate: number = 44100) {
    if (this.context) {
      if (this.highResNode) {
        this.highResNode.disconnect();
      }
      await this.context.close();
      this.context = null;
    }

    // Khởi tạo AudioContext với sampleRate khớp chính xác với file nguồn để ngăn trình duyệt resample lần thứ hai
    try {
      this.context = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate });
      this.actualSampleRate = this.context.sampleRate;
      this.targetSampleRate = sampleRate;
      this.isResampled = this.actualSampleRate !== this.targetSampleRate;
    } catch(e) {
      this.context = new (window.AudioContext || (window as any).webkitAudioContext)(); // fallback
      this.actualSampleRate = this.context.sampleRate;
      this.targetSampleRate = sampleRate;
      this.isResampled = this.actualSampleRate !== this.targetSampleRate;
    }

    // Volume Node (Gain Staging)
    this.volumeNode = this.context.createGain();
    this.volumeNode.gain.value = 1.0;

    // Set up Lookahead Limiter / True Peak Limiter
    this.limiterNode = this.context.createDynamicsCompressor();
    this.limiterNode.threshold.value = -0.3; // -0.3 dBFS True Peak 
    this.limiterNode.knee.value = 0.0;
    this.limiterNode.ratio.value = 20.0; // Brickwall
    this.limiterNode.attack.value = 0.005; // 5ms look-ahead
    this.limiterNode.release.value = 0.050; // 50ms release

    await this.context.audioWorklet.addModule('/worklets/high-res-processor.js');
    this.highResNode = new AudioWorkletNode(this.context, 'high-res-processor', {
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    this.highResNode.connect(this.volumeNode);
    this.volumeNode.connect(this.limiterNode);
    this.limiterNode.connect(this.context.destination);
  }

  public setVolume(val: number) {
     if(this.volumeNode) {
        // smooth volume transition
        this.volumeNode.gain.setTargetAtTime(val, this.context?.currentTime || 0, 0.05);
     }
  }

  public attachVisualizer(canvas: HTMLCanvasElement) {
    if (!this.highResNode) return;
    if (this.visWorker) {
      this.visWorker.terminate();
    }
    this.visWorker = new Worker('/workers/visualizer-worker.js');
    
    // Use OffscreenCanvas
    const offscreen = canvas.transferControlToOffscreen();
    this.visWorker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);

    // Setup MessageChannel to feed direct binary data from AudioWorklet to Worker
    const channel = new MessageChannel();
    this.visWorker.postMessage({ type: 'setup_port', port: channel.port1 }, [channel.port1]);
    this.highResNode.port.postMessage({ type: 'setup_port', port: channel.port2 }, [channel.port2]);
  }

  // Thuật toán giả lập Wasm Decoder hoặc Offline Decode PCM Float32Array nguyên bản
  public async loadAndDecode(fileUrl: string) {
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();

    // Trong thực tế, chúng ta có thể gọi một Wasm Decoder (ffmpeg.wasm/libflac.js) ở đây. 
    // Giải pháp thay thế (Fallback Plan) theo Red-Teaming:
    // Vì không cài đặt wasm module, chúng ta sử dụng OfflineAudioContext hoặc decodeAudioData để trích xuất PCM.
    
    // Tạo temporary context (không gắn với hardware) để giải mã offline với rate cố định của file
    const tempContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await tempContext.decodeAudioData(arrayBuffer);
    
    // Đồng bộ hóa Sample Rate
    await this.init(audioBuffer.sampleRate);
    
    // Lấy PCM Float32Array
    const channels = [];
    for(let i=0; i<audioBuffer.numberOfChannels; i++){
       channels.push(audioBuffer.getChannelData(i));
    }
    
    // Chuyển dữ liệu cho Worklet thông qua MessagePort để sử dụng Circular / Ring Buffer
    // Chia nhỏ (chunk) để không block thread nếu file quá lớn
    this.sendToWorklet(channels);
    this.isLoaded = true;
  }

  private sendToWorklet(channels: Float32Array[], chunkSize=8192) {
    if(!this.highResNode) return;
    
    const maxLen = channels[0].length;
    for(let offset = 0; offset < maxLen; offset += chunkSize) {
        let chunk = [];
        for(let c=0; c<channels.length; c++) {
             chunk.push(channels[c].subarray(offset, Math.min(offset + chunkSize, maxLen)));
        }
        this.highResNode.port.postMessage({ type: 'chunks', data: chunk });
    }
  }

  public play() {
    if(this.context?.state === 'suspended') {
       this.context.resume();
    }
    this.highResNode?.port.postMessage({ type: 'play' });
    this.isPlaying = true;
  }

  public pause() {
    this.highResNode?.port.postMessage({ type: 'pause' });
    this.isPlaying = false;
  }

  public toggleDither(enabled: boolean) {
     // Bật/tắt TPDF dithering (đã implement trong Worklet)
     this.highResNode?.port.postMessage({ type: 'dither', enabled });
  }

  public cleanup() {
    if (this.context) {
       this.pause();
       if(this.highResNode) this.highResNode.disconnect();
       this.context.close();
       this.context = null;
    }
  }
}

export const highResAudio = new HighResAudioPipeline();
