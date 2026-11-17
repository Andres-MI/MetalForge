import type { TargetResult } from '../model/exercise';
import type { ChordAnalysis } from './chord';

/** A TargetResult plus what the Judge knows about how it came about. Backwards compatible with TargetResult. */
export interface ScoredTarget extends TargetResult {
  index: number;
  /** False for a wrong attempt in untimed mode: the target is still waiting for the right note. */
  final: boolean;
  /** Wrong notes played before the right one (untimed). */
  wrongAttempts: number;
  /** MIDI notes heard, when relevant (wrong notes, chord attempts). */
  heard?: number[];
  /** Chord targets judged with the spectral check: which tones were missing or foreign, and how clean the strum was. */
  chord?: ChordAnalysis;
}

export interface RoundSummary {
  total: number;
  hits: number;
  early: number;
  late: number;
  wrong: number;
  miss: number;
  /** Credit per target: clean hit 1, early/late 0.5, anything else 0 (a target that needed retries gets 0). 0..1 */
  accuracy: number;
  /** Share of targets with the right note and no wrong attempts, whatever the timing. 0..1 */
  cleanliness: number;
  /** Mean signed error in seconds over timed results with the right note; > 0 drags, < 0 rushes. */
  meanTimingError: number | null;
  tendency: 'rush' | 'drag' | 'steady' | null;
  /** Mean reaction time in seconds (untimed). */
  meanReaction: number | null;
  /** Detected sounds that matched no target. */
  strays: number;
  /** 0..1, cleanliness weighs more than timing. */
  score: number;
  stars: 0 | 1 | 2 | 3;
}
