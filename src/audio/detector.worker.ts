/// <reference lib="webworker" />
/** Web Worker: runs the Detector off the main thread. Blocks come straight from the AudioWorklet. */
import type { DetectorEvent, DetectorOptions } from '../detection/detector';
import { BlockProcessor } from './blocks';

export type WorkerIn = { type: 'init'; options: DetectorOptions; port: MessagePort } | { type: 'expected'; midis: number[] };
export type WorkerOut = { type: 'events'; events: DetectorEvent[]; upTo: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;

let proc: BlockProcessor | null = null;
let pendingExpected: number[] = [];

scope.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === 'expected') {
    pendingExpected = msg.midis;
    proc?.setExpected(msg.midis);
    return;
  }
  if (msg.type !== 'init') return;
  const p = new BlockProcessor(msg.options);
  p.setExpected(pendingExpected);
  proc = p;
  const port = msg.port;
  port.onmessage = (m: MessageEvent<{ samples: Float32Array; frame: number }>) => {
    const { events, upTo } = p.push(m.data.samples, m.data.frame);
    const out: WorkerOut = { type: 'events', events, upTo };
    scope.postMessage(out);
  };
};
