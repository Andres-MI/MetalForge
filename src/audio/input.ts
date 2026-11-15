/** Opens the instrument input and feeds a Detector. The only file that touches Web Audio capture. */
import { Detector, type DetectorEvent } from '../detection/detector';
import { pitchRange, type Instrument } from '../model/instrument';

export interface InputHandle {
  context: AudioContext;
  stop(): void;
}

export async function startInput(inst: Instrument, onEvent: (e: DetectorEvent) => void): Promise<InputHandle> {
  // The browser's voice processing destroys instrument audio, so all of it goes off.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const context = new AudioContext({ latencyHint: 'interactive' });
  await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`);
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'capture', { numberOfInputs: 1, numberOfOutputs: 0 });
  // Window sizes are defined at 48 kHz; keep the same duration at other rates.
  const windowSize = 1 << Math.round(Math.log2((inst.windowSize * context.sampleRate) / 48000));
  const detector = new Detector({ sampleRate: context.sampleRate, windowSize, ...pitchRange(inst) });
  node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    for (const e of detector.process(ev.data)) onEvent(e);
  };
  source.connect(node);
  return {
    context,
    stop() {
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void context.close();
    },
  };
}
