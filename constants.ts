
export const AUDIO_CONFIG = {
  SAMPLE_RATE: 44100,
  FREQUENCIES: {
    MARK: 2200,    // Binary 1
    SPACE: 1200,   // Binary 0
    PILOT: 1700,   // Continuous Pilot Tone for Clock Recovery
    NOISE_FLOOR: 800, // Reference for ambient noise
  },
  BIT_DURATION: 0.15, // Increased to 150ms for significantly higher reliability in noisy rooms
  PREAMBLE_DURATION: 1.2,
  SYNC_WORD: 0xAB, // 10101011
  END_WORD: 0xFE,
  SNR_THRESHOLD: 2.2, // Signal must be at least 2.2x stronger than noise floor
};

export const CRYPTO_CONFIG = {
  ALGORITHM: 'AES-GCM',
  ITERATIONS: 10000, 
};
