# AcouChat
## Acoustic-Based Text Communication System
### Comprehensive Technical Documentation

---

## Abstract
AcouChat is an experimental, research-oriented communication system that enables text transmission through acoustic signals instead of conventional digital networks. By encoding textual data into sound waves and decoding them back into text, the system demonstrates an alternative communication paradigm suitable for constrained, offline, or infrastructure-restricted environments. This document provides a complete technical, architectural, and academic description of the project.

---

## 1. Introduction
Traditional communication systems rely heavily on radio-frequency-based technologies such as Wi-Fi, cellular networks, and Bluetooth. While efficient, these systems may be unavailable or intentionally restricted in certain environments such as secure facilities, disaster zones, or isolated locations.

AcouChat investigates the feasibility of **audio-based data communication**, using sound as the transmission medium. The project is designed primarily for academic, laboratory, and educational purposes, focusing on signal processing concepts and alternative data transmission techniques.

---

## 2. Objectives
The main objectives of AcouChat are:

- To design a functional text communication system without network infrastructure
- To explore audio signals as a data transmission medium
- To demonstrate basic encoding and decoding techniques
- To provide a modular platform for experimentation and further research
- To serve as a university-level laboratory or research project

---

## 3. Scope of the Project
This project focuses on short-range, low-bandwidth communication using standard consumer hardware (microphones and speakers). It does not aim to replace traditional communication systems but rather to complement academic research and experimentation.

Out of scope:
- High-speed data transmission
- Long-range communication
- Military-grade encryption
- Commercial deployment

---

## 4. System Overview
AcouChat operates entirely within a web browser environment and uses the Web Audio API for audio processing. The system consists of two primary processes:

1. **Transmission Process**
2. **Reception Process**

---

## 5. System Architecture

### 5.1 High-Level Architecture
```
User Input (Text)
        ↓
Text Encoder
        ↓
Audio Signal Generator
        ↓
Speaker Output
        ↓
Air (Acoustic Channel)
        ↓
Microphone Input
        ↓
Audio Signal Analyzer
        ↓
Text Decoder
        ↓
User Output (Text)
```

### 5.2 Component Description

#### 5.2.1 Text Encoder
- Converts characters into numerical representations
- Maps characters to predefined frequencies or waveforms

#### 5.2.2 Audio Signal Generator
- Uses oscillators to generate sound waves
- Controls frequency, duration, and amplitude

#### 5.2.3 Transmission Medium
- Acoustic channel (air)
- Subject to noise, echo, and attenuation

#### 5.2.4 Audio Signal Analyzer
- Captures sound using microphone
- Applies frequency analysis (e.g., FFT)

#### 5.2.5 Text Decoder
- Matches detected frequencies to characters
- Reconstructs original text message

---

## 6. Data Encoding Methodology
Each character is mapped to a specific frequency range. The transmission uses sequential tones with fixed duration. A delimiter tone may be used to indicate message boundaries.

Key parameters:
- Frequency range: Human-audible spectrum
- Tone duration: Fixed-length intervals
- Sampling rate: Browser default audio rate

---

## 7. Decoding Strategy
The receiver continuously samples microphone input and performs frequency-domain analysis. Detected dominant frequencies are mapped back to characters using a predefined lookup table.

Potential decoding challenges:
- Background noise
- Frequency overlap
- Hardware limitations

---

## 8. Technology Stack

### 8.1 Software
- Language: TypeScript
- Runtime: Web Browser
- APIs: Web Audio API
- Build Tool: Vite
- Package Manager: npm

### 8.2 Hardware
- Speaker or headphones
- Microphone (built-in or external)

---

## 9. Installation and Deployment

### 9.1 Prerequisites
- Node.js v14 or newer
- npm
- Modern browser with audio permissions

### 9.2 Installation Steps
```bash
git clone https://github.com/TXMAZ2010/AcouChat.git
cd AcouChat
npm install
npm run dev
```

---

## 10. Usage Instructions
1. Launch the application in a browser
2. Grant microphone access
3. Enter a text message
4. Initiate transmission
5. On receiving device, activate listening mode
6. View decoded text output

---

## 11. Performance Considerations
- Communication speed is low
- Accuracy depends on environmental conditions
- Works best in quiet environments
- Short messages yield better reliability

---

## 12. Limitations
- Susceptible to ambient noise
- No advanced error correction
- Limited character set
- Short communication distance

---

## 13. Security Considerations
- No encryption implemented
- Audio signals are publicly audible
- Suitable only for non-sensitive data

---

## 14. Testing and Validation
Testing was performed under controlled indoor conditions using standard laptop microphones and speakers. Accuracy decreases significantly in noisy environments.

---

## 15. Educational and Research Value
This project is suitable for:
- Signal processing courses
- Communication systems labs
- Experimental computer science projects
- Undergraduate or early postgraduate research

---

## 16. Future Improvements
- Error detection and correction
- Adaptive frequency selection
- Noise filtering algorithms
- Support for binary data
- Encryption layer

---

## 17. Ethical Considerations
The project is intended strictly for educational and experimental use. Misuse for unauthorized communication is discouraged.

---

## 18. License
This project is licensed under the MIT License.

---

## 19. Author
**Taymaz**  
GitHub: https://github.com/TXMAZ2010

---

## 20. Conclusion
AcouChat demonstrates the feasibility of acoustic-based text communication using widely available hardware and web technologies. While limited in performance, it provides significant educational value and a foundation for further research in alternative communication systems.
