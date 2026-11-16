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

/** What Luciérnagas shows right now. */
export interface FirefliesHook {
  index: number;
  total: number;
  /** The lit target: string index, fret and MIDI note. */
  string: number;
  fret: number;
  midi: number;
  caught: number;
  skipped: number;
  /** Text of the up/down hint on screen ('' when none), e.g. 'más agudo →'. */
  hint: string;
  /** Where the last wrong note was drawn on the board (fret, or null when off the board). */
  wrongFret: number | null;
  /** Screen x of the lit target and of the fret numbers' row (canvas pixels). */
  targetX: number;
  over: boolean;
}

/** What Ninja shows right now. */
export interface NinjaHook {
  wave: number;
  waves: number;
  attempt: number;
  restarts: number;
  hearts: number;
  score: number;
  combo: number;
  bestCombo: number;
  multiplier: number;
  /** Seconds per plain enemy now. */
  limit: number;
  /** Seconds left on the live enemy (null before it appears or with none). */
  remaining: number | null;
  /** The live enemy: string, fret, MIDI, shield and hits it still needs; null with none. */
  enemy: { string: number; fret: number; midi: number; shield: boolean; hitsLeft: number } | null;
  /** Text of the banner on screen ('' when none), e.g. 'Otra vez, más despacio'. */
  banner: string;
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

/** Escalada (learn, scales) live state for automation. */
export interface ClimbHook {
  /** 'run' = the ordered run, 'offer' = finished, waiting for Enter (free round) or R (results), 'free' = free round. */
  phase: 'run' | 'offer' | 'free';
  timed: boolean;
  /** Target waiting (untimed) or next to play (timed), and the number of targets. */
  index: number;
  total: number;
  /** The lit target: string index, fret and MIDI note (-1 when none). */
  string: number;
  fret: number;
  midi: number;
  /** Notes of the scale lit so far, number of different notes in the zone, and root notes drawn. */
  lit: number;
  scaleNotes: number;
  /** MIDI of every note of the zone (the scale position on the board). */
  scaleMidis: number[];
  roots: number;
  /** Text of the up/down hint on screen ('' when none) and where the last wrong note was drawn (fret or null). */
  hint: string;
  wrongFret: number | null;
  /** Free round: different scale notes visited, notes outside the scale tried (MIDI), plays. */
  visited: number;
  outside: number[];
  plays: number;
  /** Text of the message line and of the sub line. */
  msg: string;
  sub: string;
  /** Hold the climber is on (index of the target) and its screen position. */
  climberHold: number;
  /** True while the whole scale is being played back. */
  listening: boolean;
  over: boolean;
}

/** Torre (arcade, scales) live state for automation. */
export interface TowerHook {
  /** 'climb' = a floor, 'boss' = a guardian room (a banner may be on top of either, see `banner`). */
  phase: 'climb' | 'boss';
  timed: boolean;
  floor: number;
  floors: number;
  attempt: number;
  restarts: number;
  hearts: number;
  score: number;
  combo: number;
  bestCombo: number;
  multiplier: number;
  /** Water speed (platforms/second) or tempo (bpm) now, and the platforms between the hero and the water. */
  pace: number;
  gap: number;
  /** Platform the hero stands on (index of the last reached target + 1), and the index of the target waiting. */
  platform: number;
  index: number;
  total: number;
  target: { string: number; fret: number; midi: number } | null;
  invulnerable: boolean;
  banner: string;
  /** Boss room: health, bars, last damage and repeat streak; null outside it. */
  boss: { hp: number; maxHp: number; bar: number; bars: number; lastDamage: number; repeat: number; defeated: boolean; strays: number } | null;
  /** MIDI of every note of the floor's scale position. */
  zone: number[];
  floorsDone: number;
  bossesDefeated: number;
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
  /** Luciérnagas (learn) and Ninja (arcade) live state, or null outside them. */
  fireflies: FirefliesHook | null;
  ninja: NinjaHook | null;
  /** Escalada (learn) and Torre (arcade) live state, or null outside them. */
  climb: ClimbHook | null;
  tower: TowerHook | null;
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
  fireflies: null,
  ninja: null,
  climb: null,
  tower: null,
};

export function installHooks(): void {
  window.__metalforge = hooks;
}
