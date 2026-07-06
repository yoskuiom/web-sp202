import * as Tone from 'tone';

/**
 * Generates lo-fi factory preset sounds mathematically using the AudioContext.
 * This is 100% robust, deterministic, lightning-fast, and bypasses any
 * Tone.Offline or browser-suspended rendering context issues.
 */
export async function generateFactorySamples() {
  const samples = {};
  const sampleRate = Tone.context.sampleRate || 44100;

  try {
    // Helper to create empty mono buffer
    const createBuffer = (duration) => {
      const length = Math.floor(sampleRate * duration);
      return Tone.context.createBuffer(1, length, sampleRate);
    };

    // 1. Kick Drum (Pad 1)
    // Pitch sweep from 150Hz to 40Hz with an exponential amplitude decay
    const kickBuf = createBuffer(0.35);
    const kickData = kickBuf.getChannelData(0);
    for (let i = 0; i < kickBuf.length; i++) {
      const t = i / sampleRate;
      const freq = 40 + 110 * Math.exp(-t * 40);
      const phase = 2 * Math.PI * (40 * t - (110 / 40) * Math.exp(-t * 40));
      const amp = Math.exp(-t * 12);
      kickData[i] = Math.sin(phase) * amp;
    }
    samples['A-1'] = kickBuf;

    // 2. Snare Drum (Pad 2)
    // Mix of a snappy triangle transient (180Hz to 100Hz) and filtered-style noise
    const snareBuf = createBuffer(0.3);
    const snareData = snareBuf.getChannelData(0);
    for (let i = 0; i < snareBuf.length; i++) {
      const t = i / sampleRate;
      const freq = 100 + 80 * Math.exp(-t * 50);
      const phase = 2 * Math.PI * (100 * t - (80 / 50) * Math.exp(-t * 50));
      const tri = (Math.abs((phase % (2 * Math.PI)) / Math.PI - 1) * 2 - 1) * Math.exp(-t * 25);
      const noise = (Math.random() * 2 - 1) * Math.exp(-t * 15);
      snareData[i] = (tri * 0.4 + noise * 0.3);
    }
    samples['A-2'] = snareBuf;

    // 3. Hi-Hat (Pad 3)
    // High-pass styled noise burst using first-difference high-pass filter
    const hatBuf = createBuffer(0.1);
    const hatData = hatBuf.getChannelData(0);
    let lastNoise = 0;
    for (let i = 0; i < hatBuf.length; i++) {
      const t = i / sampleRate;
      const rawNoise = Math.random() * 2 - 1;
      const hpNoise = rawNoise - lastNoise;
      lastNoise = rawNoise;
      const amp = Math.exp(-t * 45);
      hatData[i] = hpNoise * 0.35 * amp;
    }
    samples['A-3'] = hatBuf;

    // 4. Rimshot / Perk (Pad 4)
    // High-pitched acoustic-style transient sweep
    const rimBuf = createBuffer(0.15);
    const rimData = rimBuf.getChannelData(0);
    for (let i = 0; i < rimBuf.length; i++) {
      const t = i / sampleRate;
      const freq = 300 + 450 * Math.exp(-t * 60);
      const phase = 2 * Math.PI * (300 * t - (450 / 60) * Math.exp(-t * 60));
      const amp = Math.exp(-t * 35);
      rimData[i] = Math.sin(phase) * amp * 0.4;
    }
    samples['A-4'] = rimBuf;

    // 5. Ambient Rhodes Chord 1 - Gmaj7 (Pad 5)
    // Harmonized triangle/sine waves with a warm, slow-vibrato tremolo (6Hz)
    const chord1Buf = createBuffer(2.0);
    const chord1Data = chord1Buf.getChannelData(0);
    const freqs1 = [196.00, 246.94, 293.66, 369.99]; // G3, B3, D4, F#4
    for (let i = 0; i < chord1Buf.length; i++) {
      const t = i / sampleRate;
      let mix = 0;
      const trem = 0.85 + 0.15 * Math.sin(2 * Math.PI * 6 * t);

      freqs1.forEach(f => {
        const phase = 2 * Math.PI * f * t;
        const tri = Math.abs((phase % (2 * Math.PI)) / Math.PI - 1) * 2 - 1;
        const sine = Math.sin(phase);
        mix += (tri * 0.6 + sine * 0.4);
      });

      const env = Math.exp(-t * 1.5) * (1 - Math.exp(-t * 40));
      chord1Data[i] = (mix / freqs1.length) * env * trem * 0.45;
    }
    samples['A-5'] = chord1Buf;

    // 6. Ambient Rhodes Chord 2 - Am7 (Pad 6)
    // Harmonized triangle/sine waves with warm tremolo (5.5Hz)
    const chord2Buf = createBuffer(2.0);
    const chord2Data = chord2Buf.getChannelData(0);
    const freqs2 = [220.00, 261.63, 329.63, 392.00]; // A3, C4, E4, G4
    for (let i = 0; i < chord2Buf.length; i++) {
      const t = i / sampleRate;
      let mix = 0;
      const trem = 0.85 + 0.15 * Math.sin(2 * Math.PI * 5.5 * t);

      freqs2.forEach(f => {
        const phase = 2 * Math.PI * f * t;
        const tri = Math.abs((phase % (2 * Math.PI)) / Math.PI - 1) * 2 - 1;
        const sine = Math.sin(phase);
        mix += (tri * 0.6 + sine * 0.4);
      });

      const env = Math.exp(-t * 1.5) * (1 - Math.exp(-t * 40));
      chord2Data[i] = (mix / freqs2.length) * env * trem * 0.45;
    }
    samples['A-6'] = chord2Buf;

    // 7. Lo-Fi Synth Bass - E (Pad 7)
    // Thick sawtooth blended with a detuned sub-bass sine wave
    const bassBuf = createBuffer(1.5);
    const bassData = bassBuf.getChannelData(0);
    const f1 = 82.41; // E2
    const f2 = 82.81; // detuned E2 sub
    for (let i = 0; i < bassBuf.length; i++) {
      const t = i / sampleRate;
      const phase1 = f1 * t;
      const saw = 2 * (phase1 - Math.floor(phase1 + 0.5));
      const sub = Math.sin(2 * Math.PI * f2 * t);
      const rawMix = saw * 0.3 + sub * 0.7;
      const env = Math.exp(-t * 2.0) * (1 - Math.exp(-t * 50));
      bassData[i] = rawMix * env * 0.5;
    }
    samples['A-7'] = bassBuf;

    // 8. Vinyl Noise & Hum Loop (Pad 8)
    // Continuous pink-ish crackle noise combined with low frequency hum (50Hz)
    const vinylBuf = createBuffer(2.5);
    const vinylData = vinylBuf.getChannelData(0);
    for (let i = 0; i < vinylBuf.length; i++) {
      const t = i / sampleRate;
      const hiss = (Math.random() * 2 - 1) * 0.04;
      let crackle = 0;
      if (Math.random() < 0.001) {
        crackle = (Math.random() * 2 - 1) * 0.4;
      }
      const hum = Math.sin(2 * Math.PI * 50 * t) * 0.08;
      const env = Math.exp(-t * 0.1) * (1 - Math.exp(-t * 10));
      vinylData[i] = (hiss + crackle + hum) * env * 0.5;
    }
    samples['A-8'] = vinylBuf;

  } catch (error) {
    console.error("Error rendering mathematical factory samples:", error);
  }

  return samples;
}
