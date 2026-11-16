/** Data hooks on `window.__metalforge`: the canvas has no DOM, so automation and tests read state from here. */
import type { FakeControl } from '../game/fakePlayer';

export interface JudgedHook {
  index: number;
  judgement: string;
  /** Milliseconds from the ideal moment, after the calibrated latency (positive = late). */
  deltaMs: number;
}

export interface SaltoHook {
  round: number;
  rounds: number;
  /** Sessions started in this run (rounds + restarts), 1-based: changes every time a new round or retry begins. */
  attempt: number;
  restarts: number;
  bpm: number;
  hearts: number;
  score: number;
  combo: number;
  bestCombo: number;
  multiplier: number;
  /** 'run' | 'jump' | 'stumble': what the runner is doing right now. */
  pose: string;
  /** Text of the banner on screen ('' when none), e.g. 'Otra vez, más despacio'. */
  banner: string;
  /** Screen x (320-wide canvas) of each obstacle of the current round, and of the rhythm marks above. */
  obstacleX: number[];
  targetBeats: number[];
  over: boolean;
}

/** Telar (learn, strings) live state for automation. */
export interface TelarHook {
  /** Index of the knot waiting (untimed) or next to play (timed). */
  current: number;
  /** String index, MIDI and fret of each target. */
  strings: number[];
  midis: number[];
  frets: number[];
  /** True for the targets reached with a skip (an arc is drawn). */
  skips: boolean[];
  /** Thread the last wrong note was heard on (-1 none) and the text of the hint on screen ('' none). */
  heardString: number;
  hint: string;
  /** Screen y of each thread, lowest-pitched first. */
  threadY: number[];
  over: boolean;
}

/** Portero (arcade, strings) live state for automation. */
export interface PorteroHook {
  round: number;
  rounds: number;
  attempt: number;
  restarts: number;
  /** Seconds per shot (untimed) or bpm (timed). */
  pace: number;
  timed: boolean;
  hearts: number;
  score: number;
  combo: number;
  bestCombo: number;
  multiplier: number;
  banner: string;
  /** Strings and MIDI notes of the round's targets; `shot` is the one waiting; `deadline` its limit in clock seconds (untimed). */
  strings: number[];
  midis: number[];
  shot: number;
  deadline: number;
  /** Targets of the current telegraph (two = a double shot). */
  group: number[];
  bands: number;
  over: boolean;
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
  results: { stars: number; accuracy: number; tendency: string | null; meanMs: number | null; strays: number; hits: number; early: number; late: number; miss: number; arcade?: { score: number; bestCombo: number; previousBest: number; newBest: boolean } } | null;
  /** Salto (arcade) live state, or null outside it. */
  salto: SaltoHook | null;
  /** Last calibration measured, or null. */
  calibration: { offsetMs: number; spreadMs: number; used: number; matched: number; ok: boolean } | null;
  /** Audio chain diagnostics of the running input (null with a fake input). */
  audio: { lagMs: number; baseLatencyMs: number; outputLatencyMs: number; captureStart: number | null } | null;
  /** Telar and Portero (strings) live state, or null outside them. */
  telar: TelarHook | null;
  portero: PorteroHook | null;
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
  salto: null,
  calibration: null,
  audio: null,
  telar: null,
  portero: null,
};

export function installHooks(): void {
  window.__metalforge = hooks;
}
