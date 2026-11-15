/** Data hooks on `window.__metalforge`: the canvas has no DOM, so automation and tests read state from here. */
import type { FakeControl } from '../game/fakePlayer';

export interface JudgedHook {
  index: number;
  judgement: string;
  /** Milliseconds from the ideal moment, after the calibrated latency (positive = late). */
  deltaMs: number;
}

export interface MetalforgeHooks {
  /** MIDI notes the detector reported as attacks, most recent last (the tuner scene fills it). */
  heard: number[];
  /** Key of the scene on screen, e.g. 'hub' or 'tuner'. */
  scene: string;
  /** Chosen instrument id, or null before the first pick. */
  instrument: string | null;
  /** Hub: id of the highlighted cabinet. Picker: id of the highlighted instrument. */
  selected: string | null;
  /** Whether the background effects are running. */
  backgroundEffects: boolean;
  /**
   * Set to true BEFORE starting a game (from page.evaluate) to use a virtual-time fake input instead of the
   * microphone: no audio, no calibration prompt. The game then waits for `fake` to advance time.
   */
  useFakeInput: boolean;
  /** Controls of the fake input of the running game session; null when there is none. */
  fake: FakeControl | null;
  /** Final results of the game on screen (timed games), in order. */
  judged: JudgedHook[];
  /** Summary of the last finished round, or null. */
  results: { stars: number; accuracy: number; tendency: string | null; meanMs: number | null; strays: number; hits: number; early: number; late: number; miss: number } | null;
  /** Last calibration measured, or null. */
  calibration: { offsetMs: number; spreadMs: number; used: number; matched: number; ok: boolean } | null;
  /** Audio chain diagnostics of the running input (null with a fake input). */
  audio: { lagMs: number; baseLatencyMs: number; outputLatencyMs: number; captureStart: number | null } | null;
}

declare global {
  interface Window {
    __metalforge: MetalforgeHooks;
  }
}

export const hooks: MetalforgeHooks = {
  heard: [],
  scene: '',
  instrument: null,
  selected: null,
  backgroundEffects: true,
  useFakeInput: false,
  fake: null,
  judged: [],
  results: null,
  calibration: null,
  audio: null,
};

export function installHooks(): void {
  window.__metalforge = hooks;
}
