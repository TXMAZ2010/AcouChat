
import { AUDIO_CONFIG } from '../constants';

export type BitCallback = (bit: number) => void;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyzer: AnalyserNode | null = null;
  private onBit: BitCallback | null = null;
  private isListening = false;
  private timerRef: number | null = null;
  public transmitting = false; 
  private activeOscillators: Set<OscillatorNode> = new Set();
  private transmissionTimeout: number | null = null;

  private isSyncing = false;
  private samplesPerBit = 10; // Increased sampling density
  private bitSamples: number[] = [];

  async init() {
    if (this.ctx && this.ctx.state !== 'closed') return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: AUDIO_CONFIG.SAMPLE_RATE });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true 
        } 
      });
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyzer = this.ctx.createAnalyser();
      this.analyzer.fftSize = 2048;
      this.analyzer.smoothingTimeConstant = 0.2; 
      src.connect(this.analyzer);
    } catch (e) {
      console.warn("Mic Access Denied");
    }
  }

  setBitCallback(cb: BitCallback) { this.onBit = cb; }

  private goertzel(samples: Float32Array, freq: number, sr: number): number {
    const n = samples.length;
    const k = (n * freq) / sr;
    const w = (2 * Math.PI * k) / n;
    const cosW = Math.cos(w);
    const coeff = 2 * cosW;
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) {
      s0 = samples[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (n * n);
  }

  isSignalPresent(): boolean {
    if (!this.analyzer) return false;
    const freqData = new Uint8Array(this.analyzer.frequencyBinCount);
    this.analyzer.getByteFrequencyData(freqData);
    
    const binSize = AUDIO_CONFIG.SAMPLE_RATE / this.analyzer.fftSize;
    const getPower = (f: number) => {
      const bin = Math.round(f / binSize);
      return freqData[bin] || 0;
    };

    const p1 = getPower(AUDIO_CONFIG.FREQUENCIES.MARK);
    const p0 = getPower(AUDIO_CONFIG.FREQUENCIES.SPACE);
    const pp = getPower(AUDIO_CONFIG.FREQUENCIES.PILOT);
    const pn = getPower(AUDIO_CONFIG.FREQUENCIES.NOISE_FLOOR) || 10;
    
    const maxSignal = Math.max(p1, p0, pp);
    return maxSignal > 60 && maxSignal > pn * 1.8;
  }

  async transmit(bits: number[]) {
    await this.init();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    
    this.stopAllAudio();
    this.transmitting = true; 
    const now = this.ctx.currentTime;
    let t = now + 0.15; // Small buffer for hardware ramp-up
    const g = this.ctx.createGain();
    g.connect(this.ctx.destination);
    
    const play = (f: number, d: number, ramp = 0.015) => {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.7, t + ramp);
      g.gain.linearRampToValueAtTime(0.7, t + d - ramp);
      g.gain.linearRampToValueAtTime(0, t + d);
      
      this.activeOscillators.add(o);
      o.onended = () => this.activeOscillators.delete(o);
      o.connect(g); 
      o.start(t); 
      o.stop(t + d);
      t += d;
    };

    // Pilot tone helps receiver sync its clock
    play(AUDIO_CONFIG.FREQUENCIES.PILOT, AUDIO_CONFIG.PREAMBLE_DURATION);
    bits.forEach(b => play(b === 1 ? AUDIO_CONFIG.FREQUENCIES.MARK : AUDIO_CONFIG.FREQUENCIES.SPACE, AUDIO_CONFIG.BIT_DURATION));
    
    const totalTime = (t - now) * 1000 + 200;
    return new Promise<void>(r => {
      this.transmissionTimeout = window.setTimeout(() => {
        this.transmitting = false; 
        this.transmissionTimeout = null;
        r();
      }, totalTime);
    });
  }

  stopAllAudio() {
    this.activeOscillators.forEach(o => {
      try { o.stop(); o.disconnect(); } catch(e) {}
    });
    this.activeOscillators.clear();
    if (this.transmissionTimeout) {
      clearTimeout(this.transmissionTimeout);
      this.transmissionTimeout = null;
    }
    this.transmitting = false;
  }

  startLive() {
    if(this.isListening) return;
    this.isListening = true;
    
    const interval = (AUDIO_CONFIG.BIT_DURATION * 1000) / this.samplesPerBit;
    this.bitSamples = [];
    
    this.timerRef = window.setInterval(() => {
      if(this.transmitting || !this.analyzer) return;

      const freqData = new Uint8Array(this.analyzer.frequencyBinCount);
      this.analyzer.getByteFrequencyData(freqData);
      
      const binSize = AUDIO_CONFIG.SAMPLE_RATE / this.analyzer.fftSize;
      const getPower = (f: number) => {
        const bin = Math.round(f / binSize);
        return freqData[bin] || 0;
      };

      const p1 = getPower(AUDIO_CONFIG.FREQUENCIES.MARK);
      const p0 = getPower(AUDIO_CONFIG.FREQUENCIES.SPACE);
      const pp = getPower(AUDIO_CONFIG.FREQUENCIES.PILOT);
      const pn = Math.max(getPower(AUDIO_CONFIG.FREQUENCIES.NOISE_FLOOR), 15);
      
      const signalPower = Math.max(p1, p0);
      const isBitPresent = signalPower > 45 && signalPower > pn * AUDIO_CONFIG.SNR_THRESHOLD;

      // Pilot detection for re-sync
      if (pp > 70 && pp > pn * 2.2) {
        this.isSyncing = true;
        this.bitSamples = [];
        return;
      }

      if (this.isSyncing && pp < 40) {
        this.isSyncing = false;
      }

      if (!this.isSyncing) {
        const bit = isBitPresent ? (p1 > p0 ? 1 : 0) : -1;
        this.bitSamples.push(bit);

        if (this.bitSamples.length >= this.samplesPerBit) {
          // Robust Voting: Center samples have more weight
          let voteScore = 0;
          let validVotes = 0;
          
          this.bitSamples.forEach((b, idx) => {
            if (b === -1) return;
            // Center weight (indices 3-7 for samplesPerBit=10)
            const weight = (idx >= 3 && idx <= 7) ? 2 : 1;
            voteScore += (b === 1 ? weight : -weight);
            validVotes += weight;
          });
          
          if (validVotes > 0 && Math.abs(voteScore) >= validVotes * 0.4) {
            this.onBit?.(voteScore > 0 ? 1 : 0);
          }
          this.bitSamples = []; 
        }
      }
    }, interval);
  }

  stopLive() {
    if(this.timerRef) clearInterval(this.timerRef);
    this.isListening = false;
    this.stopAllAudio();
  }

  getAnalyzer() { return this.analyzer; }

  // Rest of helper functions...
  async generateBlob(bits: number[]): Promise<Blob> {
    const sr = AUDIO_CONFIG.SAMPLE_RATE;
    const dur = AUDIO_CONFIG.PREAMBLE_DURATION + (bits.length * AUDIO_CONFIG.BIT_DURATION) + 1;
    const octx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);
    const g = octx.createGain(); g.connect(octx.destination);
    let t = 0.2;

    const osc = (f: number, d: number) => {
      const o = octx.createOscillator();
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.8, t + 0.015);
      g.gain.linearRampToValueAtTime(0.8, t + d - 0.015);
      g.gain.linearRampToValueAtTime(0, t + d);
      o.connect(g); o.start(t); o.stop(t + d);
      t += d;
    };

    osc(AUDIO_CONFIG.FREQUENCIES.PILOT, AUDIO_CONFIG.PREAMBLE_DURATION);
    bits.forEach(b => osc(b === 1 ? AUDIO_CONFIG.FREQUENCIES.MARK : AUDIO_CONFIG.FREQUENCIES.SPACE, AUDIO_CONFIG.BIT_DURATION));

    const buffer = await octx.startRendering();
    return this.bufferToWav(buffer);
  }

  async decodeBuffer(buffer: AudioBuffer, onProg?: (p: number) => void): Promise<number[]> {
    const data = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    const bitS = Math.floor(AUDIO_CONFIG.BIT_DURATION * sr);
    
    let max = 0;
    for(let i=0; i<data.length; i++) if(Math.abs(data[i]) > max) max = Math.abs(data[i]);
    if(max < 0.001) return [];
    for(let i=0; i<data.length; i++) data[i] /= max;

    let bestPilot = 0, startIdx = -1;
    const step = Math.floor(bitS/10);
    for(let i=0; i < data.length - bitS; i += step) {
      if(onProg) onProg((i/data.length)*0.3);
      const e = this.goertzel(data.slice(i, i+bitS), AUDIO_CONFIG.FREQUENCIES.PILOT, sr);
      if(e > bestPilot) { bestPilot = e; }
      if(bestPilot > 0.005 && e < bestPilot * 0.15) { startIdx = i; break; }
    }

    if(startIdx === -1) return [];

    const bits: number[] = [];
    let ptr = startIdx;
    while(ptr + bitS <= data.length) {
      if(onProg) onProg(0.3 + (ptr/data.length)*0.7);
      const chunk = data.slice(ptr, ptr+bitS);
      const e1 = this.goertzel(chunk, AUDIO_CONFIG.FREQUENCIES.MARK, sr);
      const e0 = this.goertzel(chunk, AUDIO_CONFIG.FREQUENCIES.SPACE, sr);
      bits.push(e1 > e0 ? 1 : 0);
      ptr += bitS;
      if(bits.length > 20000) break;
    }
    return bits;
  }

  private bufferToWav(buffer: AudioBuffer): Blob {
    const length = buffer.length * 2 + 44, bArr = new ArrayBuffer(length), view = new DataView(bArr);
    let pos = 0;
    const s32 = (d: number) => { view.setUint32(pos, d, true); pos += 4; };
    const s16 = (d: number) => { view.setUint16(pos, d, true); pos += 2; };
    s32(0x46464952); s32(length - 8); s32(0x45564157); s32(0x20746d66); s32(16); s16(1); s16(1);
    s32(buffer.sampleRate); s32(buffer.sampleRate * 2); s16(2); s16(16); s32(0x61746164); s32(length - 44);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      let s = Math.max(-1, Math.min(1, data[i]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true); pos += 2;
    }
    return new Blob([bArr], { type: 'audio/wav' });
  }
}
export const audioEngine = new AudioEngine();
