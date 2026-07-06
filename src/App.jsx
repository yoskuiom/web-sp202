import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as Tone from 'tone';
import { Knob } from './components/Knob';
import { generateFactorySamples } from './lib/audioGenerator';
import { Mic, Upload, Trash2, HelpCircle, Save, FolderOpen, Power } from 'lucide-react';

const INITIAL_PAD_SETTINGS = () => ({
  grade: 'STANDARD',
  isStereo: false,
  isTrigger: true,
  isLoop: false,
  isReverse: false,
  startOffset: 0,
  endOffset: 1,
  pitchShift: 0,
  timeStretch: 1.0,
  delayTime: 0.25,
  filter1Freq: 15000,
  filter2Freq: 8000,
  ringModFreq: 250,
});

export default function App() {
  // DEVICE POWER STATE 
  const [isPowerOn, setIsPowerOn] = useState(true);
  const [isBooting, setIsBooting] = useState(false);

  // AUDIO CORE STATES 
  const [bank, setBank] = useState('A');
  const [currentPad, setCurrentPad] = useState(1); // Defaults to Pad 1 as current
  const [activePads, setActivePads] = useState({}); // Track actively playing pads
  const [bpm, setBpm] = useState(120);

  // AUDIO SETTINGS (PER PAD STATE) 
  const [padSettings, setPadSettings] = useState({});
  const [padStates, setPadStates] = useState({});

  // VIRTUAL MEMORY CARD 
  const [isCardInserted, setIsCardInserted] = useState(true); // Start with card inserted for easy use
  const [cardBlink, setCardBlink] = useState(false);

  // INTERFACE / BUTTON MODES 
  const [activeEffect, setActiveEffect] = useState(null);
  const [isPitchActive, setIsPitchActive] = useState(false); // Pitch can be active in parallel with other effects
  const [isDelMode, setIsDelMode] = useState(false);
  const [delTarget, setDelTarget] = useState(null);
  const [isRecMode, setIsRecMode] = useState(false);
  const [isRecStandby, setIsRecStandby] = useState(false);
  const [recTarget, setRecTarget] = useState(null);
  const [recTime, setRecTime] = useState(0);

  // AUDIO INPUT/SOURCE MIX 
  const [isSourceActive, setIsSourceActive] = useState(false);
  const [recLevelValue, setRecLevelValue] = useState(50); // 0 - 100
  const [masterVolume, setMasterVolume] = useState(75); // 0 - 100

  // WAVEFORM MARK & SELECTIVE TRUNCATION 
  const [isMarking, setIsMarking] = useState(false);
  const [markStep, setMarkStep] = useState('IDLE');

  // HOLD ENGINE
  const [isHoldMode, setIsHoldMode] = useState(false);
  const [heldPads, setHeldPads] = useState({});

  // DISPLAY MESSAGES
  const [displayText, setDisplayText] = useState('120');
  const [isBlinkingDisplay, setIsBlinkingDisplay] = useState(false);

  // AUDIO NOISE/METER LEVEL
  const [inputLevel, setInputLevel] = useState(0);
  const [peakLight, setPeakLight] = useState(false);

  // CORE TONE.JS REFS 
  const playersRef = useRef({});
  const activeVoicesRef = useRef([]); // To manage max 4 voices

  // Audio chain nodes
  const globalInputGain = useRef(null);
  const bitCrusher = useRef(null);
  const noiseCutFilter = useRef(null);
  const pitchShifter = useRef(null);
  const delayNode = useRef(null);
  const filter1Node = useRef(null);
  const filter2Node = useRef(null);
  const ringModInput = useRef(null);
  const ringModDry = useRef(null);
  const ringModWet = useRef(null);
  const ringModMultiplier = useRef(null);
  const ringModOutput = useRef(null);
  const ringModCarrier = useRef(null);
  const mainVolumeNode = useRef(null);
  const analyserNode = useRef(null);

  // Microphone and Recording
  const micNode = useRef(null);
  const mediaRecorder = useRef(null);
  const recordedChunks = useRef([]);
  const recTimerInterval = useRef(null);

  // Tap Tempo state
  const tapTimes = useRef([]);

  // Temp display reset timer
  const displayResetTimer = useRef(null);

  // Helper to trigger brief custom display messages
  const triggerTempMessage = useCallback((msg, durationMs = 1500) => {
    if (displayResetTimer.current) clearTimeout(displayResetTimer.current);
    setDisplayText(msg);
    displayResetTimer.current = setTimeout(() => {
      setDisplayText(bpm.toString());
    }, durationMs);
  }, [bpm]);

  // LAZY INITIALIZATION OF AUDIO
  const initAudio = async () => {
    if (Tone.context.state === 'suspended') {
      await Tone.start();
    }

    if (globalInputGain.current) return; // Already initialized

    // Create the processing nodes
    globalInputGain.current = new Tone.Gain(1).toDestination();
    mainVolumeNode.current = new Tone.Volume(0).connect(globalInputGain.current);

    analyserNode.current = new Tone.Analyser('waveform', 256);
    mainVolumeNode.current.connect(analyserNode.current);

    // 1. Bitcrusher (implemented as a safe WaveShaper to bypass worklet iframe CSP restrictions)
    bitCrusher.current = new Tone.WaveShaper();
    const defaultSteps = Math.pow(2, 8); // default 8 bits
    const defaultCurve = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) {
      const x = (i / 4095) * 2 - 1;
      defaultCurve[i] = Math.round(x * (defaultSteps / 2)) / (defaultSteps / 2);
    }
    bitCrusher.current.curve = defaultCurve;

    // 2. Noise Cut High Cut Filter (linked to Grade)
    noiseCutFilter.current = new Tone.Filter(20000, 'lowpass');
    bitCrusher.current.connect(noiseCutFilter.current);

    // 3. Pitch Shifter
    pitchShifter.current = new Tone.PitchShift(0);
    noiseCutFilter.current.connect(pitchShifter.current);

    // 4. Filter 1 (low pass effect)
    filter1Node.current = new Tone.Filter(20000, 'lowpass');
    pitchShifter.current.connect(filter1Node.current);

    // 5. Filter 2 (resonant sweep peaking filter)
    filter2Node.current = new Tone.BiquadFilter({
      type: 'peaking',
      frequency: 20000,
      Q: 1.0,
      gain: 0
    });
    filter1Node.current.connect(filter2Node.current);

    // 6. Ring Modulator sub-chain (wet/dry series block)
    ringModInput.current = new Tone.Gain();
    filter2Node.current.connect(ringModInput.current);

    ringModDry.current = new Tone.Gain(1.0);
    ringModWet.current = new Tone.Gain(0.0);
    ringModOutput.current = new Tone.Gain();

    ringModMultiplier.current = new Tone.Gain(0.0);

    ringModCarrier.current = new Tone.Oscillator({
      type: 'sine',
      frequency: 250
    }).start();
    ringModCarrier.current.connect(ringModMultiplier.current.gain);

    // Route inputs through dry & wet
    ringModInput.current.connect(ringModDry.current);
    ringModInput.current.connect(ringModMultiplier.current);
    ringModMultiplier.current.connect(ringModWet.current);

    ringModDry.current.connect(ringModOutput.current);
    ringModWet.current.connect(ringModOutput.current);

    // 7. Delay Node
    delayNode.current = new Tone.FeedbackDelay({
      delayTime: 0.25,
      feedback: 0.4,
      wet: 0
    });
    ringModOutput.current.connect(delayNode.current);

    // Connect Delay Node output to the Main Volume Node input
    delayNode.current.connect(mainVolumeNode.current);

    // Setup microphone node
    micNode.current = new Tone.UserMedia();
  };

  // Setup initial volume mapping
  useEffect(() => {
    if (mainVolumeNode.current && isPowerOn) {
      // Map 0-100 masterVolume to Tone.js decibels
      const db = Tone.gainToDb(masterVolume / 100);
      mainVolumeNode.current.volume.value = masterVolume === 0 ? -Infinity : db;
    }
  }, [masterVolume, isPowerOn]);

  // Load Factory Presets on Power On / Mount
  useEffect(() => {
    const loadPresets = async () => {
      setIsBooting(true);
      setDisplayText('2.0.2');
      setIsBlinkingDisplay(true);

      // Generate the lo-fi synthesized factory sound buffers
      const factoryBuffers = await generateFactorySamples();

      const states = {};
      const settings = {};

      // Initialize all banks and pads (A, B, C, D)
      ['A', 'B', 'C', 'D'].forEach(b => {
        for (let n = 1; n <= 8; n++) {
          const key = `${b}-${n}`;
          settings[key] = INITIAL_PAD_SETTINGS();

          if (b === 'A' && factoryBuffers[key]) {
            states[key] = {
              isLoaded: true,
              fileName: `Preset_${n}`,
              buffer: factoryBuffers[key]
            };
          } else {
            states[key] = { isLoaded: false };
          }
        }
      });

      setPadSettings(settings);
      setPadStates(states);

      // Simulate vintage 2.0.2 boot sequence
      setTimeout(() => {
        setIsBooting(false);
        setIsBlinkingDisplay(false);
        setDisplayText('120');
      }, 2000);
    };

    if (isPowerOn) {
      loadPresets();
    } else {
      setDisplayText('');
      setActivePads({});
      // Stop all playing audio
      Object.values(playersRef.current).forEach(p => p.stop());
    }
  }, [isPowerOn]);

  // Dynamic meter analyser & Peak LED monitoring
  useEffect(() => {
    let animationId;

    const monitorMeter = () => {
      if (!isPowerOn) {
        setPeakLight(false);
        setInputLevel(0);
        return;
      }

      let maxVal = 0;

      // 1. Monitor live playing level for output peaking
      if (analyserNode.current) {
        const audioValues = analyserNode.current.getValue();
        for (let i = 0; i < audioValues.length; i++) {
          const absVal = Math.abs(audioValues[i]);
          if (absVal > maxVal) maxVal = absVal;
        }
      }

      // 2. Monitor recording/mic level if active or in standby
      if ((isRecStandby || isRecMode || isSourceActive) && micNode.current) {
        // Mock recording input volume slightly fluctuating + reading actual stream values if needed
        const inputVol = (recLevelValue / 100) * 0.4 + (Math.random() * 0.15);
        if (inputVol > maxVal) maxVal = inputVol;
        setInputLevel(inputVol);
      } else {
        setInputLevel(0);
      }

      // Peak threshold (e.g. 0.6 rms or absolute)
      if (maxVal > 0.45) {
        setPeakLight(true);
        setTimeout(() => setPeakLight(false), 80);
      }

      animationId = requestAnimationFrame(monitorMeter);
    };

    monitorMeter();
    return () => cancelAnimationFrame(animationId);
  }, [isPowerOn, isRecStandby, isRecMode, isSourceActive, recLevelValue]);

  // CONTROLLER PARAMS UPDATER 
  // When activeEffect or control knob values change, update the audio engine parameters
  const updateAudioNodesForPad = (padKey) => {
    if (!bitCrusher.current || !noiseCutFilter.current || !pitchShifter.current || !delayNode.current || !filter1Node.current || !filter2Node.current || !ringModDry.current || !ringModWet.current || !ringModCarrier.current) {
      return;
    }

    const settings = padSettings[padKey];
    if (!settings) return;

    // 1. Bitcrushing & High cut (Sampling Grade)
    const grades = {
      'HI-FI': { bits: 12, freq: 15000 },
      'STANDARD': { bits: 8, freq: 8000 },
      'LO-FI 1': { bits: 6, freq: 4000 },
      'LO-FI 2': { bits: 4, freq: 2000 }
    };
    const gradeConfig = grades[settings.grade];

    if (bitCrusher.current) {
      const steps = Math.pow(2, gradeConfig.bits);
      const size = 4096;
      const curve = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        const x = (i / (size - 1)) * 2 - 1;
        curve[i] = Math.round(x * (steps / 2)) / (steps / 2);
      }
      bitCrusher.current.curve = curve;
    }

    noiseCutFilter.current.frequency.value = gradeConfig.freq;

    // 2. Pitch shifting (-12 to +12 semitones)
    if (isPitchActive || activeEffect === 'PITCH') {
      pitchShifter.current.pitch = settings.pitchShift;
    } else {
      pitchShifter.current.pitch = 0;
    }

    // 3. Time Stretch (playback rate 0.5 to 1.5)
    // Applied directly on Player trigger

    // 4. Delay node
    if (activeEffect === 'DELAY') {
      delayNode.current.delayTime.value = settings.delayTime;
      delayNode.current.wet.value = 0.55;
    } else {
      delayNode.current.wet.value = 0;
    }

    // 5. Filter 1 Effect
    if (activeEffect === 'FILTER 1') {
      filter1Node.current.frequency.value = settings.filter1Freq;
    } else {
      filter1Node.current.frequency.value = 20000; // bypass (open)
    }

    // 6. Filter 2 Effect
    if (activeEffect === 'FILTER 2') {
      filter2Node.current.frequency.value = settings.filter2Freq;
      filter2Node.current.Q.value = 7.0; // resonant peaks
      filter2Node.current.gain.value = 12; // amplify peak
    } else {
      filter2Node.current.frequency.value = 20000;
      filter2Node.current.gain.value = 0;
      filter2Node.current.Q.value = 1.0;
    }

    // 7. Ring Modulator Carrier Frequency
    if (activeEffect === 'RING MOD') {
      ringModCarrier.current.frequency.setValueAtTime(settings.ringModFreq, Tone.context.currentTime);
      ringModDry.current.gain.setValueAtTime(0.3, Tone.context.currentTime); // feed carrier multiply
      ringModWet.current.gain.setValueAtTime(0.7, Tone.context.currentTime);
    } else {
      ringModDry.current.gain.setValueAtTime(1.0, Tone.context.currentTime);
      ringModWet.current.gain.setValueAtTime(0, Tone.context.currentTime);
    }
  };

  // Helper to get active player of a pad
  const getOrCreatePlayer = (padKey) => {
    const state = padStates[padKey];
    if (!state || !state.isLoaded || !state.buffer) return null;

    if (!playersRef.current[padKey]) {
      // Connect specifically to our BitCrusher global effects input
      const p = new Tone.Player(state.buffer);
      if (bitCrusher.current) {
        p.connect(bitCrusher.current);
      }
      playersRef.current[padKey] = p;
    }
    return playersRef.current[padKey];
  };

  //  TRUNCATE / CROP SAMPLE 
  const handleTruncate = (padKey) => {
    const state = padStates[padKey];
    const settings = padSettings[padKey];
    if (!state || !state.isLoaded || !state.buffer || !settings) return;

    const buffer = state.buffer;
    const sampleRate = buffer.sampleRate;
    const totalFrames = buffer.length;

    const startFrame = Math.floor(settings.startOffset * totalFrames);
    const endFrame = Math.floor(settings.endOffset * totalFrames);
    const newLength = Math.max(100, endFrame - startFrame);

    // Slice buffer
    const audioCtx = Tone.context;
    const newBuffer = audioCtx.createBuffer(
      buffer.numberOfChannels,
      newLength,
      sampleRate
    );

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const oldData = buffer.getChannelData(channel);
      const newData = newBuffer.getChannelData(channel);
      for (let i = 0; i < newLength; i++) {
        newData[i] = oldData[startFrame + i];
      }
    }

    // Reset offsets back to full (0 to 1) for the cropped sound
    setPadSettings(prev => ({
      ...prev,
      [padKey]: {
        ...prev[padKey],
        startOffset: 0,
        endOffset: 1,
      }
    }));

    setPadStates(prev => ({
      ...prev,
      [padKey]: {
        ...prev[padKey],
        buffer: newBuffer
      }
    }));

    // Dispose old player
    if (playersRef.current[padKey]) {
      playersRef.current[padKey].dispose();
      delete playersRef.current[padKey];
    }

    triggerTempMessage('CrP', 1200); // "Cropped" feedback
  };

  // PLAY PAD 
  const playPad = async (num) => {
    if (!isPowerOn || isBooting) return;
    await initAudio();

    const padKey = `${bank}-${num}`;
    setCurrentPad(num);

    // Delete pad sequence
    if (isDelMode) {
      if (delTarget === null) {
        setDelTarget(padKey);
        triggerTempMessage('dEL', 2000);
      } else if (delTarget === padKey) {
        // Confirmed double click on target pad in delete mode DELETE IT!
        if (playersRef.current[padKey]) {
          playersRef.current[padKey].dispose();
          delete playersRef.current[padKey];
        }
        setPadStates(prev => ({
          ...prev,
          [padKey]: { isLoaded: false }
        }));
        setPadSettings(prev => ({
          ...prev,
          [padKey]: INITIAL_PAD_SETTINGS()
        }));
        setIsDelMode(false);
        setDelTarget(null);
        triggerTempMessage('CLR', 1200);
      }
      return;
    }

    // Record pad sequence
    if (isRecStandby) {
      setRecTarget(padKey);
      startRecordingProcess(padKey);
      return;
    }

    // Normal play path
    const player = getOrCreatePlayer(padKey);
    const settings = padSettings[padKey];

    if (player && settings) {
      // Manage 4-voice polyphony!
      if (activeVoicesRef.current.length >= 4) {
        const oldestPadKey = activeVoicesRef.current.shift();
        if (oldestPadKey && playersRef.current[oldestPadKey]) {
          playersRef.current[oldestPadKey].stop();
          setActivePads(prev => ({ ...prev, [oldestPadKey]: false }));
        }
      }

      // Start tracking this voice
      if (!activeVoicesRef.current.includes(padKey)) {
        activeVoicesRef.current.push(padKey);
      }

      updateAudioNodesForPad(padKey);

      // Apply settings
      player.reverse = settings.isReverse;
      player.loop = settings.isLoop;

      // Apply time stretch (TIME effect adjusts speed)
      if (activeEffect === 'TIME') {
        player.playbackRate = settings.timeStretch;
      } else {
        player.playbackRate = 1.0;
      }

      // Calculate start and end offsets
      const duration = player.buffer.duration;
      const startSec = settings.startOffset * duration;
      const endSec = settings.endOffset * duration;
      const playDuration = Math.max(0.01, endSec - startSec);

      player.stop();

      // Trigger playing states
      setActivePads(prev => ({ ...prev, [padKey]: true }));

      if (settings.isLoop) {
        player.loopStart = startSec;
        player.loopEnd = endSec;
        player.start(undefined, startSec);
      } else {
        player.start(undefined, startSec, playDuration);

        // Non-loop trigger timer (One shot auto off indicator)
        if (settings.isTrigger) {
          const timeoutDur = (playDuration / player.playbackRate) * 1000;
          setTimeout(() => {
            setActivePads(prev => ({ ...prev, [padKey]: false }));
            activeVoicesRef.current = activeVoicesRef.current.filter(k => k !== padKey);
          }, timeoutDur);
        }
      }

      // Latch hold trigger
      if (isHoldMode) {
        setHeldPads(prev => ({ ...prev, [padKey]: !prev[padKey] }));
      }
    } else {
      // Empty Pad clicked, trigger custom file upload if empty!
      const input = document.getElementById(`file-upload-${num}`);
      if (input) input.click();
    }
  };

  // STOP PAD (For GATE mode or toggled HOLDs) 
  const stopPad = (num) => {
    if (!isPowerOn) return;
    const padKey = `${bank}-${num}`;
    const settings = padSettings[padKey];

    if (settings && !settings.isTrigger) { // If mode is GATE
      // Stop unless held
      if (!heldPads[padKey]) {
        const player = playersRef.current[padKey];
        if (player) {
          player.stop();
        }
        setActivePads(prev => ({ ...prev, [padKey]: false }));
        activeVoicesRef.current = activeVoicesRef.current.filter(k => k !== padKey);
      }
    }
  };

  // MICROPHONE RECORDING LOGIC 
  const startRecordingProcess = async (padKey) => {
    try {
      await initAudio();
      if (!micNode.current) return;

      await micNode.current.open();

      setIsRecStandby(false);
      setIsRecMode(true);
      setDisplayText('rEC');
      setRecTime(0);

      // Start browser media recorder
      const stream = micNode.current.stream;
      recordedChunks.current = [];
      mediaRecorder.current = new MediaRecorder(stream);
      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.current.push(event.data);
      };

      mediaRecorder.current.onstop = async () => {
        const audioBlob = new Blob(recordedChunks.current, { type: 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();

        // Decode to AudioBuffer
        try {
          const buffer = await Tone.context.decodeAudioData(arrayBuffer);
          setPadStates(prev => ({
            ...prev,
            [padKey]: {
              isLoaded: true,
              fileName: `Sample_${new Date().toLocaleTimeString()}`,
              blob: audioBlob,
              buffer: buffer
            }
          }));
          triggerTempMessage('Snd', 1200); // "Sound Loaded" feedback
        } catch (err) {
          console.error("Decoding error:", err);
          triggerTempMessage('Err', 1200);
        }

        // Close mic
        if (micNode.current) micNode.current.close();
      };

      mediaRecorder.current.start();

      // Simple recording timer display
      if (recTimerInterval.current) clearInterval(recTimerInterval.current);
      let durationSec = 0;
      recTimerInterval.current = setInterval(() => {
        durationSec += 1;
        setRecTime(durationSec);
        // Display formatted duration e.g. "0.01", "0.02" etc
        const displaySecStr = durationSec.toString().padStart(2, '0');
        setDisplayText(`0.${displaySecStr}`);
      }, 1000);

    } catch (err) {
      console.error("Mic access failed", err);
      triggerTempMessage('Err', 1200);
      setIsRecStandby(false);
      setIsRecMode(false);
    }
  };

  const stopRecordingProcess = () => {
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop();
    }
    if (recTimerInterval.current) {
      clearInterval(recTimerInterval.current);
      recTimerInterval.current = null;
    }
    setIsRecMode(false);
    setRecTarget(null);
    setDisplayText(bpm.toString());
  };

  // SOURCE EFFECT SWITCH (VOICE EFFECTOR)
  const handleToggleSource = async () => {
    await initAudio();
    if (!micNode.current || !bitCrusher.current) return;

    if (!isSourceActive) {
      try {
        await micNode.current.open();
        // Route live microphone into our Bitcrusher effects chain!
        micNode.current.connect(bitCrusher.current);
        setIsSourceActive(true);
        triggerTempMessage('Src', 1200);
      } catch (err) {
        console.error("Mic source activation failed", err);
        triggerTempMessage('Err', 1200);
      }
    } else {
      micNode.current.close();
      micNode.current.disconnect();
      setIsSourceActive(false);
      triggerTempMessage('oFF', 1200);
    }
  };

  // MANUAL AUDIO FILE UPLOAD 
  const handleFileChange = (e, num) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const padKey = `${bank}-${num}`;

      const p = new Tone.Player({
        url: url,
        onload: () => {
          const buffer = p.buffer.get();
          setPadStates(prev => ({
            ...prev,
            [padKey]: {
              isLoaded: true,
              fileName: file.name,
              buffer: buffer
            }
          }));
          triggerTempMessage('LoD', 1200); // "Loaded"
        },
        onerror: () => {
          triggerTempMessage('Err', 1200);
        }
      });
    }
  };

  // STOP ALL SOUNDS
  const stopAll = () => {
    Object.values(playersRef.current).forEach(p => p.stop());
    setActivePads({});
    setHeldPads({});
    activeVoicesRef.current = [];
    setIsDelMode(false);
    setIsRecStandby(false);
    setDisplayText(bpm.toString());
    triggerTempMessage('StP', 1000);
  };

  // BPM TAP TEMPO CALCULATION 
  const handleTapTempo = () => {
    if (!isPowerOn) return;
    const now = performance.now();

    // Reset tap array if gap is > 2 seconds
    if (tapTimes.current.length > 0 && now - tapTimes.current[tapTimes.current.length - 1] > 2000) {
      tapTimes.current = [];
    }

    tapTimes.current.push(now);

    if (tapTimes.current.length >= 2) {
      // Calculate average gap
      let totalGaps = 0;
      for (let i = 1; i < tapTimes.current.length; i++) {
        totalGaps += (tapTimes.current[i] - tapTimes.current[i - 1]);
      }
      const avgGapMs = totalGaps / (tapTimes.current.length - 1);
      const calculatedBpm = Math.round(60000 / avgGapMs);

      if (calculatedBpm >= 40 && calculatedBpm <= 200) {
        setBpm(calculatedBpm);
        setDisplayText(calculatedBpm.toString());
      }
    } else {
      // Flash dot on tap
      setDisplayText('o.o.o');
      setTimeout(() => setDisplayText(bpm.toString()), 150);
    }
  };

  // Manual Adjust BPM ARROW KEYS
  const adjustBpm = (delta) => {
    const newVal = Math.max(40, Math.min(240, bpm + delta));
    setBpm(newVal);
    setDisplayText(newVal.toString());
  };

  // toggle EFFECT BUTTONS (PITCH, TIME, DELAY, FILTER 1, FILTER 2, RING MOD) 
  const toggleEffect = (effect) => {
    if (!isPowerOn) return;
    if (effect === 'PITCH') {
      const nextPitchState = !isPitchActive;
      setIsPitchActive(nextPitchState);
      triggerTempMessage(nextPitchState ? 'P.On' : 'P.oF', 1000);
    } else {
      const nextFx = activeEffect === effect ? null : effect;
      setActiveEffect(nextFx);
      triggerTempMessage(nextFx ? nextFx.substring(0, 3) : 'oFF', 1000);
    }
  };

  // Update effect parameter when CONTROL KNOB is rotated
  const handleControlKnobChange = (val) => {
    setRecLevelValue(val); // Shared mapping visually with Rec Level / Control
    if (!currentPad) return;
    const padKey = `${bank}-${currentPad}`;
    const settings = padSettings[padKey];
    if (!settings) return;

    const updatedSettings = { ...settings };

    // Set parameters based on the currently selected/focused effect
    if (isPitchActive || activeEffect === 'PITCH') {
      // Range: 0-100 translated to -12 to +12 semitones
      const pitchShift = Math.round((val / 100) * 24 - 12);
      updatedSettings.pitchShift = pitchShift;
      triggerTempMessage(`P.${pitchShift >= 0 ? '+' : ''}${pitchShift}`, 1000);
    } else if (activeEffect === 'TIME') {
      // Range: 0-100 translated to 0.5x to 1.5x play rate
      const speed = parseFloat(((val / 100) * 1.0 + 0.5).toFixed(2));
      updatedSettings.timeStretch = speed;
      triggerTempMessage(`t.${Math.round(speed * 100)}`, 1000);
    } else if (activeEffect === 'DELAY') {
      // Range: 0-100 mapped to 0.05s to 1.0s delay
      const delVal = parseFloat(((val / 100) * 0.95 + 0.05).toFixed(2));
      updatedSettings.delayTime = delVal;
      triggerTempMessage(`d.${Math.round(delVal * 100)}`, 1000);
    } else if (activeEffect === 'FILTER 1') {
      // Range: 0-100 mapped to logarithmic 150 to 15000Hz lowpass cutoff
      const freq = Math.round(150 * Math.pow(15000 / 150, val / 100));
      updatedSettings.filter1Freq = freq;
      triggerTempMessage(`F.${Math.round(freq / 100)}`, 1000);
    } else if (activeEffect === 'FILTER 2') {
      // Filter 2 resonant cutoff
      const freq2 = Math.round(200 * Math.pow(8000 / 200, val / 100));
      updatedSettings.filter2Freq = freq2;
      triggerTempMessage(`r.S.${Math.round(freq2 / 100)}`, 1000);
    } else if (activeEffect === 'RING MOD') {
      // Carrier frequency 30 to 1500Hz
      const ringFreq = Math.round(30 * Math.pow(1500 / 30, val / 100));
      updatedSettings.ringModFreq = ringFreq;
      triggerTempMessage(`r.m.${ringFreq}`, 1000);
    } else if (isMarking) {
      // Adjust start/end markers manually if MARK button is active!
      if (markStep === 'START') {
        const startOffset = parseFloat((val / 100).toFixed(2));
        updatedSettings.startOffset = startOffset;
        triggerTempMessage(`S.${Math.round(startOffset * 100)}`, 1000);
      } else if (markStep === 'END') {
        const endOffset = parseFloat((val / 100).toFixed(2));
        updatedSettings.endOffset = Math.max(settings.startOffset + 0.05, endOffset);
        triggerTempMessage(`E.${Math.round(updatedSettings.endOffset * 100)}`, 1000);
      }
    }

    setPadSettings(prev => ({ ...prev, [padKey]: updatedSettings }));
    updateAudioNodesForPad(padKey);
  };

  // Cycles sampling grade for the focused/current pad
  const handleCycleGrade = () => {
    if (!currentPad) return;
    const padKey = `${bank}-${currentPad}`;
    const settings = padSettings[padKey];
    if (!settings) return;

    const grades = ['HI-FI', 'STANDARD', 'LO-FI 1', 'LO-FI 2'];
    const currentIdx = grades.indexOf(settings.grade);
    const nextIdx = (currentIdx + 1) % grades.length;
    const nextGrade = grades[nextIdx];

    setPadSettings(prev => ({
      ...prev,
      [padKey]: { ...prev[padKey], grade: nextGrade }
    }));
    triggerTempMessage(nextGrade.substring(0, 3).replace('-', ''), 1000);
  };

  const handleToggleStereo = () => {
    if (!currentPad) return;
    const padKey = `${bank}-${currentPad}`;
    const nextVal = !currentPadConfig.isStereo;
    setPadSettings(prev => ({
      ...prev,
      [padKey]: { ...prev[padKey], isStereo: nextVal }
    }));
    triggerTempMessage(nextVal ? 'mOn' : 'StE', 1000);
  };

  const handleToggleTrigger = () => {
    if (!currentPad) return;
    const padKey = `${bank}-${currentPad}`;
    const nextVal = !currentPadConfig.isTrigger;
    setPadSettings(prev => ({
      ...prev,
      [padKey]: { ...prev[padKey], isTrigger: nextVal }
    }));
    triggerTempMessage(nextVal ? 'GAt' : 'trG', 1000);
  };

  const handleToggleLoop = () => {
    if (!currentPad) return;
    const padKey = `${bank}-${currentPad}`;
    const nextVal = !currentPadConfig.isLoop;
    setPadSettings(prev => ({
      ...prev,
      [padKey]: { ...prev[padKey], isLoop: nextVal }
    }));
    triggerTempMessage(nextVal ? 'OnS' : 'Lop', 1000);
  };

  const handleToggleReverse = () => {
    if (!currentPad) return;
    const padKey = `${bank}-${currentPad}`;
    const nextVal = !currentPadConfig.isReverse;
    setPadSettings(prev => ({
      ...prev,
      [padKey]: { ...prev[padKey], isReverse: nextVal }
    }));
    triggerTempMessage(nextVal ? 'nor' : 'rEv', 1000);
  };

  // TRUNCATE/MARK LOGIC 
  const handlePressMark = () => {
    if (!isPowerOn || !currentPad) return;
    const padKey = `${bank}-${currentPad}`;

    if (!isMarking) {
      setIsMarking(true);
      setMarkStep('START');
      triggerTempMessage('Mrk', 1500);
    } else {
      if (markStep === 'START') {
        setMarkStep('END');
        triggerTempMessage('End', 1200);
      } else {
        // Stop marking
        setIsMarking(false);
        setMarkStep('IDLE');
        triggerTempMessage('Fin', 1000);
      }
    }
  };

  // Toggles the virtual SmartMedia card insertion
  const handleToggleCardSlot = () => {
    if (isCardInserted) {
      // Ejecting
      setIsCardInserted(false);
      setBank('A'); // Fallback to internal bank
      triggerTempMessage('Ejt', 1500);
    } else {
      // Inserting card
      setCardBlink(true);
      setTimeout(() => {
        setIsCardInserted(true);
        setCardBlink(false);
        triggerTempMessage('Crd', 1500);
      }, 1000);
    }
  };

  // Bank switching buttons
  const selectBank = (group) => {
    if (!isPowerOn) return;
    if (group === 'AB') {
      setBank(prev => prev === 'A' ? 'B' : 'A');
      triggerTempMessage(`b.${bank === 'A' ? 'b' : 'A'}`, 1000);
    } else {
      // Banks C/D require psyop memory card!
      if (!isCardInserted) {
        triggerTempMessage('Crd', 1500); // Blinks Card alert
        return;
      }
      setBank(prev => prev === 'C' ? 'D' : 'C');
      triggerTempMessage(`b.${bank === 'C' ? 'd' : 'C'}`, 1000);
    }
  };

  // Get current pad settings safely for indicators
  const currentPadKey = currentPad ? `${bank}-${currentPad}` : '';
  const currentPadConfig = padSettings[currentPadKey] || INITIAL_PAD_SETTINGS();
  const currentPadState = padStates[currentPadKey] || { isLoaded: false };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[#0a0a0a] text-white font-sans antialiased overflow-y-auto selection:bg-[#ff1a1a]/30 selection:text-white">

      {/* let me tel you som */}
      <div className="max-w-[680px] w-full text-center mb-6 space-y-2">
        <p className="text-xs text-zinc-400 font-medium">
          There are pre-loaded sounds in the pads in bank A but you can download any sound you want. Have fun! 
        </p>
      </div>

      {/* Dark Theme style */}
      <div className="relative w-full max-w-[680px] bg-[#222222] p-8 rounded-2xl border-x-[6px] border-t-[2px] border-b-[16px] border-black shadow-[0_40px_100px_rgba(0,0,0,0.8)] select-none overflow-hidden">

        {/* screws in da corners for vibe lol */}
        <div className="absolute top-2 left-2 w-3 h-3 bg-zinc-700 rounded-full border border-black shadow-inner flex items-center justify-center"><div className="w-2 h-0.5 bg-black"></div></div>
        <div className="absolute top-2 right-2 w-3 h-3 bg-zinc-700 rounded-full border border-black shadow-inner flex items-center justify-center"><div className="w-2 h-0.5 bg-black rotate-90"></div></div>
        <div className="absolute bottom-2 left-2 w-3 h-3 bg-zinc-700 rounded-full border border-black shadow-inner flex items-center justify-center"><div className="w-2 h-0.5 bg-black rotate-45"></div></div>
        <div className="absolute bottom-2 right-2 w-3 h-3 bg-zinc-700 rounded-full border border-black shadow-inner flex items-center justify-center"><div className="w-2 h-0.5 bg-black -rotate-45"></div></div>

        {/* TOP PANEL: LOGO, MODEL, POWER TOGGLE */}
        <div className="flex justify-between items-end mb-6 relative">
          <div className="flex flex-col">
            <h1 className="text-[#ff1a1a] text-5xl font-black italic leading-none tracking-tighter">BOSS</h1>
            <p className="text-[#ff1a1a] text-[10px] font-bold uppercase tracking-[0.2em] mt-1">Roland Corporation Japan</p>
          </div>

          {/* POWER TOGGLE */}
          <div className="absolute top-0 right-1/2 translate-x-1/2 flex items-center gap-2 bg-black/40 px-3 py-1 rounded-full border border-black/85">
            <span className="text-[7.5px] text-zinc-400 font-extrabold uppercase tracking-widest leading-none">Power</span>
            <button
              onClick={() => setIsPowerOn(!isPowerOn)}
              className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 cursor-pointer ${isPowerOn ? 'bg-emerald-600' : 'bg-zinc-800'} shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] flex items-center ${isPowerOn ? 'justify-end' : 'justify-start'}`}
            >
              <div className="w-4 h-4 rounded-full bg-white shadow-md flex items-center justify-center">
                <Power className={`w-2 h-2 ${isPowerOn ? 'text-emerald-600' : 'text-zinc-400'}`} />
              </div>
            </button>
          </div>

          <div className="text-right">
            <h2 className="text-[#ff1a1a] text-sm font-black uppercase tracking-tighter">Dr. Sample</h2>
            <h2 className="text-[#ff1a1a] text-4xl font-black tracking-tighter">SP-202</h2>
          </div>
        </div>

        {/* PANEL: VOLUME + EFFECTS PANEL + CONTROL KNOB */}
        <div className="grid grid-cols-12 gap-4 mb-6">

          {/* VOLUME CONTROL KNOB */}
          <div className="col-span-3 bg-[#1a1a1a] p-4 rounded border border-black flex flex-col items-center justify-between">
            <Knob
              min={0}
              max={100}
              value={masterVolume}
              onChange={setMasterVolume}
              label="Volume"
            />
            <div className="w-full flex justify-between mt-2 px-1 text-[8px] font-bold text-[#ff1a1a]/60 uppercase italic">
              <span>Min</span><span>Max</span>
            </div>
          </div>

          {/* EFFECTS SELECTOR GRID AND CONTROL KNOB (9 COLS) */}
          <div className="col-span-9 bg-[#1a1a1a] p-3 rounded border border-black grid grid-cols-3 gap-2">

            {/* EFFECTS BUTTONS */}
            <div className="col-span-2">
              <label className="text-[#ff1a1a] text-[10px] font-black italic uppercase mb-2 block">Effects</label>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { name: 'PITCH', active: isPitchActive },
                  { name: 'TIME', active: activeEffect === 'TIME' },
                  { name: 'DELAY', active: activeEffect === 'DELAY' },
                  { name: 'FILTER 1', active: activeEffect === 'FILTER 1' },
                  { name: 'FILTER 2', active: activeEffect === 'FILTER 2' },
                  { name: 'RING MOD', active: activeEffect === 'RING MOD' }
                ].map(fx => (
                  <button
                    key={fx.name}
                    onClick={() => toggleEffect(fx.name)}
                    disabled={!isPowerOn}
                    className={`h-7 cursor-pointer text-[9px] font-black rounded-sm border-b-2 border-black active:translate-y-0.5 active:border-b-0 uppercase transition-all flex flex-col items-center justify-center gap-0.5 ${fx.active
                        ? 'bg-[#ff1a1a] text-white'
                        : 'bg-[#b0b0b0] text-black hover:bg-white'
                      }`}
                  >
                    <span className="scale-90 tracking-tighter leading-none">{fx.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* CONTROL KNOB */}
            <div className="flex flex-col items-center border-l border-black/40 pl-2">
              <Knob
                min={0}
                max={100}
                value={recLevelValue}
                onChange={handleControlKnobChange}
                label="Control"
              />
              {/* PEAK LED LIGHT INDICATOR */}
              <div className="flex items-center gap-1 mt-1">
                <div className={`w-2 h-2 rounded-full border border-black transition-all duration-75 ${peakLight ? 'bg-red-500 shadow-[0_0_8px_#ff1a1a]' : 'bg-red-950'}`}></div>
                <span className="text-[#ff1a1a]/60 text-[7px] font-bold uppercase italic tracking-tighter">Peak</span>
              </div>
            </div>

          </div>
        </div>

        {/* MIDDLE DISPLAY AND BUTTON PARAMETERS SECTION */}
        <div className="bg-[#111] p-4 border-[3px] border-black rounded-md mb-6 relative overflow-hidden">

          {/* DISPLAY GRID ROW */}
          <div className="flex justify-between items-start">

            {/* LED BPM DISPLAY BLOCK */}
            <div className="flex flex-col">
              <span className="text-[#ff1a1a] text-[10px] font-black italic uppercase mb-1 tracking-widest">Tempo / BPM</span>
              <div className="bg-black px-6 py-2 rounded border border-zinc-800 shadow-[inset_0_0_20px_rgba(255,0,0,0.3)] flex items-center justify-center min-w-[140px] h-[78px]">
                <span className={`text-[#ff1a1a] text-6xl font-black tracking-tighter leading-none italic ${isBlinkingDisplay ? 'animate-pulse' : ''}`} style={{ fontFamily: "'Courier New', monospace" }}>
                  {displayText || '---'}
                </span>
              </div>
            </div>

            {/* BPM ADJUST BUTTONS & BANK SELECTOR */}
            <div className="flex flex-col gap-2 pt-1.5">
              <div className="flex gap-1">
                <button
                  onClick={() => adjustBpm(-1)}
                  disabled={!isPowerOn}
                  className="w-10 h-8 bg-[#333] border-b-2 border-black rounded-sm flex items-center justify-center hover:bg-[#555] text-zinc-100 text-xs font-bold cursor-pointer"
                >
                  ▼
                </button>
                <button
                  onClick={() => adjustBpm(1)}
                  disabled={!isPowerOn}
                  className="w-10 h-8 bg-[#333] border-b-2 border-black rounded-sm flex items-center justify-center hover:bg-[#555] text-zinc-100 text-xs font-bold cursor-pointer"
                >
                  ▲
                </button>
              </div>

              <div className="bg-black p-1.5 rounded border border-zinc-800 flex flex-col items-center">
                <span className="text-[#ff1a1a] text-[8px] font-black uppercase mb-1">Bank</span>
                <div className="flex gap-1.5">
                  {['A', 'B', 'C', 'D'].map(b => {
                    const isActive = bank === b;
                    return (
                      <span
                        key={b}
                        className={`text-[11px] font-black px-2 rounded-sm ${isActive
                            ? 'bg-[#ff1a1a] text-black shadow-[0_0_8px_#ff1a1a]'
                            : 'text-[#333]'
                          }`}
                      >
                        {b}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* TAP BUTTON */}
            <button
              onClick={handleTapTempo}
              disabled={!isPowerOn}
              className="w-24 h-24 bg-[#c0c0c0] text-black border-b-[6px] border-black rounded-md font-black text-lg flex flex-col items-center justify-center hover:bg-white cursor-pointer active:translate-y-1 active:border-b-2"
            >
              <span className="text-[10px] opacity-60 uppercase">Value</span>
              TAP
            </button>

          </div>

          {/* PARAMS LED GRID & 5 EDIT BUTTONS */}
          <div className="grid grid-cols-5 gap-3 mt-6">
            {[
              {
                title: 'GRADE',
                active: currentPadConfig.grade,
                options: ['HI-FI', 'STANDARD', 'LO-FI 1', 'LO-FI 2'],
                fn: handleCycleGrade
              },
              {
                title: 'OUTPUT',
                active: currentPadConfig.isStereo ? 'STEREO' : 'MONO',
                options: ['MONO', 'STEREO'],
                fn: handleToggleStereo
              },
              {
                title: 'PLAY',
                active: currentPadConfig.isTrigger ? 'TRIGGER' : 'GATE',
                options: ['TRIGGER', 'GATE'],
                fn: handleToggleTrigger
              },
              {
                title: 'LOOP',
                active: currentPadConfig.isLoop ? 'LOOP' : 'ONE SHOT',
                options: ['LOOP', 'ONE SHOT'],
                fn: handleToggleLoop
              },
              {
                title: 'REVERSE',
                active: currentPadConfig.isReverse ? 'REVERSE' : 'NORMAL',
                options: ['NORMAL', 'REVERSE'],
                fn: handleToggleReverse
              }
            ].map((col, idx) => (
              <div key={idx} className="flex flex-col items-center justify-between">
                {/* Dynamic LED stack for column options */}
                <div className="flex flex-col gap-1 items-start bg-black/60 px-1.5 py-2 rounded border border-zinc-900 w-full mb-1.5">
                  {col.options.map(opt => {
                    const isLit = col.active === opt;
                    return (
                      <div key={opt} className="flex items-center gap-1 w-full">
                        <div className={`w-1.5 h-1.5 rounded-full border border-black/50 transition-all ${isLit ? 'bg-[#ff1a1a] shadow-[0_0_6px_#ff1a1a]' : 'bg-[#333]'}`}></div>
                        <span className={`text-[6px] font-extrabold tracking-tighter ${isLit ? 'text-zinc-100 font-black' : 'text-zinc-700'}`}>
                          {opt}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={col.fn}
                  disabled={!isPowerOn}
                  className="w-full h-1.5 bg-[#333] hover:bg-zinc-600 rounded-full cursor-pointer"
                ></button>
                <span className="text-[#ff1a1a] text-[8px] font-black uppercase tracking-tighter mt-1">{col.title}</span>
              </div>
            ))}
          </div>

        </div>

        {/*  FUNCTION BUTTONS ROW */}
        <div className="grid grid-cols-7 gap-1 mb-8">
          {[
            {
              label: 'Del',
              desc: 'DELETE',
              classes: isDelMode ? 'bg-[#ff1a1a] text-white animate-pulse' : 'bg-[#ccc] text-black hover:bg-white',
              fn: () => {
                if (!isPowerOn) return;
                setIsDelMode(!isDelMode);
                setIsRecStandby(false);
                setDelTarget(null);
                triggerTempMessage(isDelMode ? 'oFF' : 'dEL', 1200);
              }
            },
            {
              label: 'Rec',
              desc: 'SAMPLING',
              classes: isRecStandby ? 'bg-red-600 text-white animate-pulse' : isRecMode ? 'bg-[#ff1a1a] text-white shadow-[0_0_8px_#ff1a1a]' : 'bg-[#ccc] text-black hover:bg-white',
              fn: () => {
                if (!isPowerOn) return;
                if (isRecMode) {
                  stopRecordingProcess();
                } else {
                  setIsRecStandby(!isRecStandby);
                  setIsDelMode(false);
                  triggerTempMessage(isRecStandby ? 'oFF' : 'rdy', 1200);
                }
              }
            },
            {
              label: 'Mark',
              desc: 'TRUNCATE',
              classes: isMarking ? 'bg-amber-500 text-black animate-pulse' : 'bg-[#ccc] text-black hover:bg-white',
              fn: handlePressMark
            },
            {
              label: 'Cancel',
              desc: 'STOP/ESC',
              classes: 'bg-[#ff1a1a] text-white',
              fn: () => {
                if (!isPowerOn) return;
                if (isRecMode) {
                  stopRecordingProcess();
                }
                stopAll();
              }
            },
            {
              label: 'Remain',
              desc: 'STATUS',
              classes: 'bg-[#ccc] text-black hover:bg-white',
              fn: () => {
                if (!isPowerOn) return;
                const min = Math.floor(Math.random() * 4);
                const sec = Math.floor(Math.random() * 60).toString().padStart(2, '0');
                triggerTempMessage(`${min}.${sec}`, 2000);
              }
            },
            {
              label: 'A/B',
              desc: 'BANK INT',
              classes: 'bg-[#ccc] text-black hover:bg-white',
              fn: () => selectBank('AB')
            },
            {
              label: 'C/D',
              desc: 'BANK CARD',
              classes: !isCardInserted ? 'bg-[#333] text-zinc-500' : 'bg-[#ccc] text-black hover:bg-white',
              fn: () => selectBank('CD')
            }
          ].map(btn => (
            <div key={btn.label} className="flex flex-col items-center">
              <button
                onClick={btn.fn}
                disabled={!isPowerOn}
                className={`cursor-pointer ${btn.classes} text-[9px] font-black h-9 w-full border-b-4 border-black uppercase flex items-center justify-center transition-all`}
              >
                {btn.label}
              </button>
              <span className="text-[5.5px] text-zinc-400 font-extrabold mt-1 uppercase text-center tracking-tighter">
                {btn.desc}
              </span>
            </div>
          ))}
        </div>

        {/* THE PADS - Left 4 Cols for Pads, Right 1 Col for Hold and Source Pads */}
        <div className="grid grid-cols-5 gap-4">
          <div className="col-span-4 grid grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(num => {
              const padKey = `${bank}-${num}`;
              const isLoaded = padStates[padKey]?.isLoaded;
              const isPlaying = activePads[padKey];
              const isFocused = currentPad === num;

              return (
                <div key={num} className="relative h-20">
                  <input
                    type="file"
                    id={`file-upload-${num}`}
                    onChange={(e) => handleFileChange(e, num)}
                    accept="audio/*"
                    className="hidden"
                  />

                  <button
                    onMouseDown={() => playPad(num)}
                    onMouseUp={() => stopPad(num)}
                    onMouseLeave={() => stopPad(num)}
                    disabled={!isPowerOn}
                    className={`cursor-pointer w-full h-full rounded border-b-8 border-black font-black text-4xl flex flex-col items-center justify-center transition-all relative ${isPlaying
                        ? 'bg-[#ff1a1a] text-white border-black shadow-[0_0_20px_rgba(255,26,26,0.6)] translate-y-2 border-b-0'
                        : isFocused
                          ? 'bg-zinc-100 text-zinc-950 border-black ring-2 ring-red-500/50'
                          : isLoaded
                            ? 'bg-zinc-200 text-zinc-800'
                            : 'bg-[#eee] text-black border-black shadow-lg'
                      }`}
                  >
                    {isLoaded && !isPlaying && (
                      <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_3px_#10b981]"></span>
                    )}
                    <span>{num}</span>
                    <span className="text-[7px] uppercase tracking-tighter opacity-70 font-bold block mt-0.5">
                      {isLoaded ? 'Loaded' : 'Empty'}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="grid grid-rows-2 gap-4">
            {/* HOLD PAD */}
            <button
              onClick={() => {
                if (!isPowerOn) return;
                setIsHoldMode(!isHoldMode);
                triggerTempMessage(isHoldMode ? 'oFF' : 'HLd', 1000);
              }}
              disabled={!isPowerOn}
              className={`cursor-pointer w-full h-full rounded border-b-8 border-black text-[10px] font-black uppercase leading-none flex flex-col items-center justify-center gap-1 transition-all ${isHoldMode
                  ? 'bg-gradient-to-b from-amber-400 to-amber-500 text-black border-black shadow-[0_0_15px_rgba(245,158,11,0.6)] translate-y-1 border-b-2'
                  : 'bg-[#ccc] text-black hover:bg-white'
                }`}
            >
              <span className="text-sm">⏸</span>
              HOLD
            </button>

            {/* VOICE EFFECTOR SOURCE PAD */}
            <button
              onClick={handleToggleSource}
              disabled={!isPowerOn}
              className={`cursor-pointer w-full h-full rounded border-b-8 border-black text-[10px] font-black uppercase leading-none flex flex-col items-center justify-center gap-1 transition-all ${isSourceActive
                  ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white border-black shadow-[0_0_15px_rgba(16,185,129,0.6)] translate-y-1 border-b-2'
                  : 'bg-[#ccc] text-black hover:bg-white'
                }`}
            >
              <Mic className="w-4 h-4" />
              SOURCE
            </button>
          </div>
        </div>

        {/* BOTTOM SECTION DECO (MEMORY CARD + BUILT-IN MIC) */}
        <div className="mt-8 pt-4 border-t border-zinc-800/80 flex justify-between items-center px-4">

          {/* SMARTMEDIA VIRTUAL CARD SLOT */}
          <div className="flex flex-col items-start relative group">
            <span className="text-zinc-500 text-[6.5px] font-black tracking-wider uppercase mb-1">SmartMedia Slot</span>
            <div
              onClick={handleToggleCardSlot}
              className="w-24 h-5 bg-[#0f0f0f] rounded border-x border-t border-zinc-800 flex items-center justify-center relative cursor-pointer hover:border-zinc-700 transition-colors shadow-inner"
            >
              {/* Sliding 3D simulated memory card */}
              <div
                className={`absolute bottom-0 w-[84px] h-3.5 rounded-t bg-gradient-to-b from-amber-600 to-amber-700 border-x border-t border-amber-900 shadow-md transition-transform duration-500 flex items-center justify-between px-1.5 ${isCardInserted ? 'translate-y-0' : 'translate-y-5 opacity-0'
                  }`}
              >
                <span className="text-[5.5px] font-black text-amber-100">4MB CARD</span>
                <div className="w-3 h-1 bg-amber-400 rounded-sm"></div>
              </div>

              {!isCardInserted && (
                <span className="text-[6px] text-zinc-600 font-extrabold animate-pulse">EMPTY</span>
              )}
            </div>
            <p className="text-[#ff1a1a]/70 text-[7px] font-black tracking-[0.2em] uppercase mt-1 italic leading-none">
              Memory Card
            </p>
          </div>

          {/* BUILT-IN MIC decoration */}
          <div className="flex flex-col items-center">
            <div className="grid grid-cols-4 gap-1 w-10">
              <div className="h-4 w-1 bg-zinc-800 rounded-full shadow-inner"></div>
              <div className="h-5 w-1 bg-zinc-800 rounded-full shadow-inner"></div>
              <div className="h-5 w-1 bg-zinc-800 rounded-full shadow-inner"></div>
              <div className="h-4 w-1 bg-zinc-800 rounded-full shadow-inner"></div>
            </div>
            <span className="text-zinc-500 text-[7px] font-bold tracking-widest uppercase mt-1.5">
              Built-In Mic
            </span>
          </div>

        </div>

      </div>

      {/*tips*/}
      <div className="max-w-[680px] w-full text-center mt-6 text-[11px] text-zinc-500 space-y-1">
        <p>
          💡 <strong>Tip:</strong> double click <strong>DEL</strong> and then press a Pad to completely delete it.
        </p>
        <p>
          ✂️ <strong>Truncation:</strong> While playing, tap <strong>MARK</strong> once for start, again for end. Tap <strong>DEL</strong> to crop and save memory space.
        </p>
        <p>
          🎙️ <strong>Live Mode:</strong> Toggle <strong>SOURCE</strong> to turn your computer's mic into a processed effector.
        </p>
      </div>

    </div>
  );
}
