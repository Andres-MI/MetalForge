/**
 * Salto's rules, pure (no Phaser, no audio): what is at stake on top of the Judge's verdicts.
 *
 * A RUN is `ROUNDS` rounds. Each round is one timed rhythm Exercise judged by the shared Judge; this module
 * only turns each verdict into score, combo, hearts and "momentum", and decides what comes next:
 *   - round completed -> next round, tempo adapted to the recent accuracy (`nextBpm`);
 *   - all hearts lost -> the SAME round again, slower (`restartBpm`), hearts refilled; never back to the menu;
 *   - last round completed, or more than `MAX_RESTARTS` retries -> the run is over (results scene).
 *
 * Verdict -> outcome:
 *   hit          clean jump    +100 x multiplier, combo +1
 *   early/late   clumsy jump   +40 x multiplier, combo halved, momentum drops
 *   miss/wrong   stumble       combo 0, one heart lost and `INVULNERABLE_BEATS` of invulnerability
 *                (a miss while invulnerable costs no heart: outcome 'spared')
 * Cleanliness beats speed: the multiplier (x1..x5, +1 every 5 clean jumps in a row) only grows with clean hits.
 */
import type { Judgement } from '../../model/exercise';
import { nextBpm, restartBpm } from './pace';

export const MAX_HEARTS = 3;
export const ROUNDS = 3;
export const MAX_RESTARTS = 3;
export const INVULNERABLE_BEATS = 1.5;
export const CLEAN_POINTS = 100;
export const CLUMSY_POINTS = 40;
export const FLAWLESS_BONUS = 500;
export const MAX_MULTIPLIER = 5;

export type Outcome = 'clean' | 'clumsy' | 'stumble' | 'spared';

export interface Resolution {
  outcome: Outcome;
  points: number;
  heartLost: boolean;
  /** True when this verdict took the last heart: the caller must abandon the round and call `failRound()`. */
  roundFailed: boolean;
}

export interface RoundPlan {
  /** 1-based round number. */
  round: number;
  bpm: number;
  /** True when this plan repeats a round after losing all hearts. */
  retry: boolean;
  /** Sessions started so far in the run including this one (seed variety). */
  attempt: number;
  countInBeats: number;
}

export interface RoundEnd {
  /** Accuracy of the round just completed (clean 1, clumsy 0.5), 0..1. */
  accuracy: number;
  bonus: number;
  heartGained: boolean;
  /** True when the run is over (that was the last round). */
  over: boolean;
  /** Tempo of the next round (unchanged when over). */
  bpm: number;
}

export interface RoundFail {
  /** True when there are no retries left: the run is over. */
  over: boolean;
  /** Tempo of the retry. */
  bpm: number;
}

/** x1 for combos 0..4, x2 for 5..9 ... capped at x5. */
export function comboMultiplier(combo: number): number {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(Math.max(0, combo) / 5));
}

export class SaltoRun {
  readonly baseBpm: number;
  bpm: number;
  round = 1;
  attempt = 1;
  restarts = 0;
  hearts = MAX_HEARTS;
  score = 0;
  combo = 0;
  bestCombo = 0;
  /** 0..1: how fast the runner looks (drawing only; obstacles always follow the beat). */
  momentum = 1;
  over = false;
  /** Smoothed accuracy of the completed rounds (null before the first). */
  recentAccuracy: number | null = null;
  private retry = false;
  private invulnerableUntil = -Infinity;
  private clean = 0;
  private clumsy = 0;
  private failed = 0;

  constructor(baseBpm: number) {
    this.baseBpm = baseBpm;
    this.bpm = baseBpm;
  }

  get multiplier(): number {
    return comboMultiplier(this.combo);
  }

  /** What to play now. Every round starts with a full bar of count-in (time to read the first obstacles). */
  plan(): RoundPlan {
    return { round: this.round, bpm: this.bpm, retry: this.retry, attempt: this.attempt, countInBeats: 4 };
  }

  isInvulnerable(beat: number): boolean {
    return beat < this.invulnerableUntil;
  }

  /** Applies the Judge's verdict for a target at `beat` (the target's own beat, not the frame time). */
  resolve(judgement: Judgement, beat: number): Resolution {
    if (this.over) return { outcome: 'spared', points: 0, heartLost: false, roundFailed: false };
    if (judgement === 'hit') {
      const points = CLEAN_POINTS * this.multiplier;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.score += points;
      this.clean++;
      this.momentum = Math.min(1, this.momentum + 0.15);
      return { outcome: 'clean', points, heartLost: false, roundFailed: false };
    }
    if (judgement === 'early' || judgement === 'late') {
      const points = CLUMSY_POINTS * this.multiplier;
      this.combo = Math.floor(this.combo / 2);
      this.score += points;
      this.clumsy++;
      this.momentum = Math.max(0.2, this.momentum - 0.3);
      return { outcome: 'clumsy', points, heartLost: false, roundFailed: false };
    }
    this.combo = 0;
    this.failed++;
    this.momentum = 0.2;
    if (this.isInvulnerable(beat)) return { outcome: 'spared', points: 0, heartLost: false, roundFailed: false };
    this.hearts = Math.max(0, this.hearts - 1);
    this.invulnerableUntil = beat + INVULNERABLE_BEATS;
    return { outcome: 'stumble', points: 0, heartLost: true, roundFailed: this.hearts === 0 };
  }

  /** The round's exercise finished with hearts left. */
  completeRound(): RoundEnd {
    const total = this.clean + this.clumsy + this.failed;
    const accuracy = total ? (this.clean + 0.5 * this.clumsy) / total : 0;
    const flawless = total > 0 && this.clean === total;
    const bonus = flawless ? FLAWLESS_BONUS * this.round : 0;
    this.score += bonus;
    this.recentAccuracy = this.recentAccuracy === null ? accuracy : 0.6 * accuracy + 0.4 * this.recentAccuracy;
    const heartGained = accuracy >= 0.9 && this.hearts < MAX_HEARTS;
    if (heartGained) this.hearts++;
    this.resetRound();
    this.retry = false;
    if (this.round >= ROUNDS) {
      this.over = true;
      return { accuracy, bonus, heartGained, over: true, bpm: this.bpm };
    }
    this.bpm = nextBpm(this.bpm, this.recentAccuracy, this.baseBpm);
    this.round++;
    this.attempt++;
    return { accuracy, bonus, heartGained, over: false, bpm: this.bpm };
  }

  /** All hearts were lost: same round again, slower, hearts refilled. Over when the retries ran out. */
  failRound(): RoundFail {
    this.resetRound();
    this.combo = 0;
    if (this.restarts >= MAX_RESTARTS) {
      this.over = true;
      return { over: true, bpm: this.bpm };
    }
    this.restarts++;
    this.attempt++;
    this.retry = true;
    this.hearts = MAX_HEARTS;
    this.momentum = 1;
    this.bpm = restartBpm(this.bpm, this.baseBpm);
    return { over: false, bpm: this.bpm };
  }

  private resetRound(): void {
    this.clean = this.clumsy = this.failed = 0;
    this.invulnerableUntil = -Infinity;
  }
}
