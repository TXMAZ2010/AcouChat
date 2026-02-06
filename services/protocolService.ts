
import { AppState, PacketType } from '../types';
import { audioEngine } from './audioEngine';
import { cryptoService } from './cryptoService';
import { AUDIO_CONFIG } from '../constants';

export class ProtocolService {
  private bits: number[] = [];
  private onEvent: (s: AppState, d?: any) => void = () => {};
  private currentState: AppState = AppState.IDLE;
  private lastSentPacket: { type: number, load: Uint8Array } | null = null;
  private userName: string = '';
  private lastProcessTime: number = 0;

  constructor() {
    audioEngine.setBitCallback(b => this.handleBit(b));
  }

  setCallback(cb: any) { this.onEvent = cb; }

  setUserName(name: string) { this.userName = name; }

  private updateState(s: AppState, data?: any) {
    this.currentState = s;
    this.onEvent(s, data);
  }

  private handleBit(bit: number) {
    if (audioEngine.transmitting) return; 
    const now = Date.now();
    // Clear buffer if there's too much silence
    if (now - this.lastProcessTime > 2000) this.bits = [];
    this.lastProcessTime = now;
    
    this.bits.push(bit);
    if (this.bits.length > 4000) this.bits.shift();
    
    this.processBitBuffer();
  }

  private calculateChecksum(type: number, load: Uint8Array): number {
    let checksum = type ^ (load.length & 0xFF) ^ ((load.length >> 8) & 0xFF);
    for (let i = 0; i < load.length; i++) checksum ^= load[i];
    return checksum;
  }

  private async processBitBuffer() {
    // Look for Sync Word bit-by-bit (Sliding window)
    for (let i = 0; i <= this.bits.length - 40; i++) {
      if (this.bitsToByte(this.bits.slice(i, i + 8)) === AUDIO_CONFIG.SYNC_WORD) {
        const type = this.bitsToByte(this.bits.slice(i + 8, i + 16));
        const len = (this.bitsToByte(this.bits.slice(i + 16, i + 24)) << 8) | this.bitsToByte(this.bits.slice(i + 24, i + 32));
        
        const totalBitsNeeded = 32 + (len * 8) + 16; 
        if (this.bits.length < i + totalBitsNeeded) return; // Wait for more bits

        const checksumPos = i + 32 + (len * 8);
        const endPos = checksumPos + 8;
        const receivedChecksum = this.bitsToByte(this.bits.slice(checksumPos, checksumPos + 8));
        const endWord = this.bitsToByte(this.bits.slice(endPos, endPos + 8));

        if (endWord === AUDIO_CONFIG.END_WORD) {
          const payload = new Uint8Array(len);
          for (let j = 0; j < len; j++) {
            payload[j] = this.bitsToByte(this.bits.slice(i + 32 + (j * 8), i + 32 + (j * 8) + 8));
          }

          if (this.calculateChecksum(type, payload) === receivedChecksum) {
            this.bits = []; // Clear buffer after successful packet
            await this.executePacket(type, payload);
          } else {
            // Checksum failed, shift and continue searching
            this.bits = this.bits.slice(i + 1);
          }
          return; 
        }
      }
    }
  }

  private async executePacket(type: number, payload: Uint8Array) {
    try {
      switch (type) {
        case PacketType.HANDSHAKE_INIT: {
          this.updateState(AppState.HANDSHAKE, { status: 'HANDSHAKE_RECEIVED' });
          const pub = payload.slice(0, 65), peerName = new TextDecoder().decode(payload.slice(65));
          await cryptoService.deriveLiveSecret(pub);
          
          const myPub = await cryptoService.getPublicBytes(), myName = new TextEncoder().encode(this.userName);
          const resp = new Uint8Array(myPub.length + myName.length);
          resp.set(myPub); resp.set(myName, myPub.length);
          
          // Wait to let hardware settle before responding
          await new Promise(r => setTimeout(r, 1200));
          await audioEngine.transmit(this.wrapPacket(PacketType.HANDSHAKE_RESP, resp));
          this.updateState(AppState.CONNECTED, { status: 'CONNECTED', peerName });
          break;
        }
        case PacketType.HANDSHAKE_RESP: {
          const pub = payload.slice(0, 65), peerName = new TextDecoder().decode(payload.slice(65));
          await cryptoService.deriveLiveSecret(pub);
          this.updateState(AppState.CONNECTED, { status: 'CONNECTED', peerName });
          break;
        }
        case PacketType.DATA_MSG: {
          const iv = payload.slice(0, 12), ct = payload.slice(12);
          const pt = await cryptoService.decrypt(iv, ct);
          this.updateState(AppState.CONNECTED, { incomingMessage: new TextDecoder().decode(pt) });
          break;
        }
        case PacketType.RETRY_REQ: {
          if (this.lastSentPacket) {
            await new Promise(r => setTimeout(r, 1000));
            await audioEngine.transmit(this.wrapPacket(this.lastSentPacket.type, this.lastSentPacket.load));
          }
          break;
        }
        case PacketType.DISCONNECT:
          this.updateState(AppState.WAITING, { status: 'PEER_DISCONNECTED' });
          break;
      }
    } catch (e) { console.error("Protocol Decoding Error:", e); }
  }

  async initiateHandshake() {
    // Avoid collision if line is busy
    let collisionWait = 0;
    while(audioEngine.isSignalPresent() && collisionWait < 3) {
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
        collisionWait++;
    }

    this.updateState(AppState.HANDSHAKE, { status: 'CONNECTING' });
    const pub = await cryptoService.getPublicBytes(), name = new TextEncoder().encode(this.userName);
    const load = new Uint8Array(pub.length + name.length);
    load.set(pub); load.set(name, pub.length);
    
    const packet = this.wrapPacket(PacketType.HANDSHAKE_INIT, load);
    this.lastSentPacket = { type: PacketType.HANDSHAKE_INIT, load };
    await audioEngine.transmit(packet);
  }

  async sendMessage(text: string) {
    if (this.currentState !== AppState.CONNECTED) return;
    
    let busyRetry = 0;
    while(audioEngine.isSignalPresent() && busyRetry < 5) {
        this.updateState(AppState.SENDING, { status: 'LINE_BUSY' });
        await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
        busyRetry++;
    }

    await cryptoService.initialize();
    this.updateState(AppState.SENDING, { status: 'SENDING' });
    
    const { iv, ciphertext } = await cryptoService.encrypt(new TextEncoder().encode(text));
    const load = new Uint8Array(12 + ciphertext.length); 
    load.set(iv); load.set(ciphertext, 12);
    
    const packet = this.wrapPacket(PacketType.DATA_MSG, load);
    this.lastSentPacket = { type: PacketType.DATA_MSG, load };
    await audioEngine.transmit(packet);
    this.updateState(AppState.CONNECTED, { status: 'READY' });
  }

  async disconnect() {
    await audioEngine.transmit(this.wrapPacket(PacketType.DISCONNECT, new Uint8Array(0)));
    this.updateState(AppState.WAITING);
  }

  private wrapPacket(type: number, load: Uint8Array): number[] {
    const bits: number[] = [];
    const addByte = (b: number) => { 
        for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1); 
    };
    
    addByte(AUDIO_CONFIG.SYNC_WORD); 
    addByte(type); 
    addByte((load.length >> 8) & 0xFF); 
    addByte(load.length & 0xFF);
    load.forEach(b => addByte(b));
    addByte(this.calculateChecksum(type, load));
    addByte(AUDIO_CONFIG.END_WORD);
    
    return bits;
  }

  private bitsToByte(b: number[]): number {
    let r = 0; 
    for (let i = 0; i < 8; i++) if (b[i]) r |= (1 << (7 - i)); 
    return r;
  }

  // Vault helpers... (keeping same signature but ensuring crypto is ready)
  async createVaultFile(text: string, sender: string, password?: string): Promise<Blob> {
    await cryptoService.initialize();
    const salt = window.crypto.getRandomValues(new Uint8Array(16)), key = password ? await cryptoService.deriveVaultKey(password, salt) : undefined;
    const { iv, ciphertext } = await cryptoService.encrypt(new TextEncoder().encode(text), key);
    const snd = new TextEncoder().encode(sender || 'User');
    const load = new Uint8Array(1 + 16 + 1 + snd.length + 12 + ciphertext.length);
    load[0] = password ? 1 : 0; load.set(salt, 1); load[17] = snd.length; load.set(snd, 18);
    const encPart = new Uint8Array(12 + ciphertext.length);
    encPart.set(iv); encPart.set(ciphertext, 12);
    load.set(encPart, 18 + snd.length);
    return audioEngine.generateBlob(this.wrapPacket(PacketType.VAULT_ENTRY, load));
  }

  async decodeVaultFile(bits: number[], password?: string): Promise<{text: string, sender: string} | null> {
    await cryptoService.initialize();
    for (let i = 0; i <= bits.length - 40; i++) {
      if (this.bitsToByte(bits.slice(i, i + 8)) === AUDIO_CONFIG.SYNC_WORD) {
        try {
          const type = this.bitsToByte(bits.slice(i + 8, i + 16));
          if (type !== PacketType.VAULT_ENTRY) continue;
          const len = (this.bitsToByte(bits.slice(i + 16, i + 24)) << 8) | this.bitsToByte(bits.slice(i + 24, i + 32));
          if (bits.length < i + 32 + (len * 8) + 16) continue;
          const checksumPos = i + 32 + (len * 8), endPos = checksumPos + 8;
          const receivedChecksum = this.bitsToByte(bits.slice(checksumPos, checksumPos + 8));
          if (this.bitsToByte(bits.slice(endPos, endPos + 8)) !== AUDIO_CONFIG.END_WORD) continue;
          const load = new Uint8Array(len);
          for (let j = 0; j < len; j++) load[j] = this.bitsToByte(bits.slice(i + 32 + (j * 8), i + 32 + (j + 1) * 8));
          if (this.calculateChecksum(type, load) !== receivedChecksum) continue;
          const hasP = load[0] === 1, salt = load.slice(1, 17), sLen = load[17];
          const sender = new TextDecoder().decode(load.slice(18, 18 + sLen)), encPart = load.slice(18 + sLen);
          const iv = encPart.slice(0, 12), ct = encPart.slice(12);
          if(hasP && !password) throw new Error('PASSWORD_REQUIRED');
          const key = hasP ? await cryptoService.deriveVaultKey(password!, salt) : undefined;
          return { text: new TextDecoder().decode(await cryptoService.decrypt(iv, ct, key)), sender };
        } catch(e: any) { if(e.message === 'PASSWORD_REQUIRED' || e.message === 'INVALID_PASSWORD') throw e; }
      }
    }
    return null;
  }
}
export const protocolService = new ProtocolService();
