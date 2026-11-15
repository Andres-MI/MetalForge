/// <reference lib="webworker" />
/** Web Worker: runs the Detector off the main thread. Blocks come straight from the AudioWorklet. */
import type { DetectorEvent, DetectorOptions } from '../detection/detector';
import { BlockProcessor } from './blocks';

export type WorkerIn = { type: 'init'; options: DetectorOptions; port: MessagePort };
export type WorkerOut = { type: 'events'; events: DetectorEvent[]; upTo: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (ev: MessageEvent<WorkerIn>) => {
  if (ev.data.type !== 'init') return;
  const proc = new BlockProcessor(ev.data.options);
  const port = ev.data.port;
  port.onmessage = (m: MessageEvent<{ samples: Float32Array; frame: number }>) => {
    const { events, upTo } = proc.push(m.data.samples, m.data.frame);
    const out: WorkerOut = { type: 'events', events, upTo };
    scope.postMessage(out);
  };
};
