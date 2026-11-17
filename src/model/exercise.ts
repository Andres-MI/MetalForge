/**
 * The common currency of every game. A generator produces an Exercise; a game (sober "learn" mode or
 * arcade "practice" mode) only decides how to draw it and what is at stake. Scoring reads the same data.
 */
import type { FretPos, InstrumentId } from './instrument';

export type SkillId =
  | 'rhythm'
  | 'frets'
  | 'strings'
  | 'chords'
  | 'scales'
  | 'strumming'
  | 'techniques'
  | 'ear'
  | 'fretboard';

/** What the player must produce for one target. */
export type TargetKind =
  | { type: 'attack' } // any sound, only timing matters (rhythm)
  | { type: 'note'; midi: number; pos?: FretPos } // one pitch; pos is the suggested fingering
  | { type: 'pitchClass'; pc: number } // any octave of a note name (fretboard games)
  | { type: 'chord'; name: string; midis: number[]; shape?: FretPos[] }
  | { type: 'anyOf'; midis: number[] }; // free play inside a scale

export interface Target {
  /** Stable id of the smallest thing we track mastery for, e.g. "frets:guitar:s0:f3" or "chords:Em>Am". */
  itemId: string;
  kind: TargetKind;
  /** Beat position for timed exercises; undefined when the player sets the pace. */
  beat?: number;
  /** Length in beats, for held notes. */
  beats?: number;
  /** Chord exercises: ordinal of the chord this target belongs to (a bass chord is 3-4 note targets, and a chord may repeat). */
  chord?: number;
}

export interface Exercise {
  id: string;
  skill: SkillId;
  instrument: InstrumentId;
  /** Timed exercises run against a clock at `bpm`; untimed ones wait for the player. */
  timed: boolean;
  bpm?: number;
  targets: Target[];
}

export type Judgement = 'hit' | 'early' | 'late' | 'wrong' | 'miss';

export interface TargetResult {
  itemId: string;
  judgement: Judgement;
  /** Seconds from the ideal moment (timed) or reaction time since the target appeared (untimed). */
  delta: number;
}
