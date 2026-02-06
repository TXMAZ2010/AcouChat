
import { CRYPTO_CONFIG } from '../constants';

export class CryptoService {
  private keyPair: CryptoKeyPair | null = null;
  private liveSharedSecret: CryptoKey | null = null;
  private defaultVaultKey: CryptoKey | null = null;

  async initialize() {
    this.keyPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey']
    );

    const enc = new TextEncoder();
    const material = await window.crypto.subtle.importKey(
      'raw', 
      enc.encode('AcouChat_Default_V1_System_Key'), 
      'PBKDF2', 
      false, 
      ['deriveKey']
    );
    this.defaultVaultKey = await window.crypto.subtle.deriveKey(
      { 
        name: 'PBKDF2', 
        salt: enc.encode('AcouChat_Static_Salt'), 
        iterations: 1000, 
        hash: 'SHA-256' 
      },
      material, 
      { name: 'AES-GCM', length: 256 }, 
      false, 
      ['encrypt', 'decrypt']
    );
  }

  async getPublicBytes(): Promise<Uint8Array> {
    if (!this.keyPair) await this.initialize();
    return new Uint8Array(await window.crypto.subtle.exportKey('raw', this.keyPair!.publicKey));
  }

  async deriveLiveSecret(peerPub: Uint8Array) {
    const key = await window.crypto.subtle.importKey('raw', peerPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    this.liveSharedSecret = await window.crypto.subtle.deriveKey(
      { name: 'ECDH', public: key }, this.keyPair!.privateKey,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async deriveVaultKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return window.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: CRYPTO_CONFIG.ITERATIONS, hash: 'SHA-256' },
      keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async encrypt(data: Uint8Array, key?: CryptoKey): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
    if (!this.defaultVaultKey) await this.initialize();
    const activeKey = key || this.liveSharedSecret || this.defaultVaultKey;
    if (!activeKey) throw new Error('No key available');
    
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, activeKey, data);
    return { iv, ciphertext: new Uint8Array(ct) };
  }

  async decrypt(iv: Uint8Array, ct: Uint8Array, key?: CryptoKey): Promise<Uint8Array> {
    try {
      if (!this.defaultVaultKey) await this.initialize();
      const activeKey = key || this.liveSharedSecret || this.defaultVaultKey;
      if (!activeKey) throw new Error('No key available');

      const pt = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, activeKey, ct);
      return new Uint8Array(pt);
    } catch (e) {
      // In Web Crypto, a wrong key usually throws an OperationError during AES-GCM decryption
      throw new Error('INVALID_PASSWORD');
    }
  }
}

export const cryptoService = new CryptoService();
