/**
 * Opens the instrument input. The only file that touches Web Audio capture.
 *
 * Chain: microphone -> AudioWorklet (public/capture-worklet.js, 1024-sample blocks) -> MessagePort -> Web
 * Worker (detector.worker.ts runs the Detector) -> main thread. The main thread never analyses audio.
 *
 * TIME BASES. Every event's `time` (and `emittedAt`) is in seconds on the AudioContext timeline, i.e. the
 * same scale as `context.currentTime`, `AudioContext` scheduling (`osc.start(t)`) and the metronome. The
 * worklet stamps each block with `currentFrame` (the context frame of its first sample) and the worker
 * adds `firstFrame / sampleRate` to the detector's sample-based time, so by construction there is NO
 * offset between "worklet sample count" and the context timeline (see `BlockProcessor`).
 *
 * What remains is physical, and constant per device: sound played at context time T leaves the speaker at
 * about T + outputLatency, and a sound that reaches the microphone at T is delivered at about T +
 * inputLatency. That sum (plus the player's own habit) is what calibration measures as `latencyOffset`;
 * the Judge subtracts it. `InputHandle.lag` reports the other, harmless, offset: how far behind the
 * context's main-thread clock the processed audio is (transport + worker time), for diagnostics only.
 */
import type { DetectorEvent } from '../detection/detector';
import { pitchRange, type Instrument } from '../model/instrument';
import type { WorkerOut } from './detector.worker';

export interface InputHandle {
  context: AudioContext;
  stop(): void;
  /** Context time (s) of the first captured sample; null until the first block arrives. */
  captureStart(): number | null;
  /** Diagnostics: seconds the processed audio trails `context.currentTime` (median of the last blocks). */
  lag(): number;
  /** Static device latencies reported by the browser, seconds (0 when unknown). */
  latencies(): { base: number; output: number };
}

/**
 * @param onEvent  every DetectorEvent, with times on the AudioContext timeline.
 * @param onProgress  called after each processed block with `upTo`: the detector has seen all audio up to
 *   that context time, so nothing earlier can still appear (the Judge may close targets up to there).
 */
export async function startInput(
  inst: Instrument,
  onEvent: (e: DetectorEvent) => void,
  onProgress?: (upTo: number) => void,
): Promise<InputHandle> {
  // The browser's voice processing destroys instrument audio, so all of it goes off.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const context = new AudioContext({ latencyHint: 'interactive' });
  await context.resume().catch(() => undefined);
  await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`);
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'capture', { numberOfInputs: 1, numberOfOutputs: 0 });
  // Window sizes are defined at 48 kHz; keep the same duration at other rates.
  const windowSize = 1 << Math.round(Math.log2((inst.windowSize * context.sampleRate) / 48000));

  const worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
  const channel = new MessageChannel();
  worker.postMessage({ type: 'init', options: { sampleRate: context.sampleRate, windowSize, ...pitchRange(inst) }, port: channel.port1 }, [channel.port1]);
  node.port.postMessage({ port: channel.port2 }, [channel.port2]);

  let firstUpTo: number | null = null;
  const lags: number[] = [];
  worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
    const m = ev.data;
    if (m.type !== 'events') return;
    if (firstUpTo === null) firstUpTo = m.upTo - 1024 / context.sampleRate;
    lags.push(context.currentTime - m.upTo);
    if (lags.length > 64) lags.shift();
    for (const e of m.events) onEvent(e);
    onProgress?.(m.upTo);
  };
  source.connect(node);
  return {
    context,
    captureStart: () => firstUpTo,
    lag() {
      if (!lags.length) return 0;
      const s = [...lags].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    },
    latencies: () => ({ base: context.baseLatency ?? 0, output: (context as AudioContext & { outputLatency?: number }).outputLatency ?? 0 }),
    stop() {
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      worker.terminate();
      void context.close();
    },
  };
}
