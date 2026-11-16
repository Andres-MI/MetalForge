/**
 * Portero's rules, pure (no Phaser, no audio): what is at stake on top of the Judge's verdicts.
 *
 * A RUN is `ROUNDS` rounds; each is one strings Exercise (one target = one shot) judged by the shared Judge.
 * This module turns what happens to each shot into score, combo, hearts and streak and decides what comes next:
 *   - round completed -> next round, pace adapted to the recent accuracy (`nextPace`);
 *   - all hearts lost -> the SAME round again with a slower pace ("Otra vez, más despacio"), hearts refilled;
 *     never back to the menu; after `MAX_RESTARTS` retries the run is over (results scene).
 *
 * Shot -> outcome:
 *   clean save    +100 x multiplier (+ up to 40 for the time left in untimed levels), combo +1, streak +1
 *   fumbled save  +40 x multiplier, combo halved, streak 0
 *                 (timed: early/late; untimed: the right string came after a wrong one)
 *   goal          combo 0, streak 0, one heart lost
 *                 (timed: miss or wrong string; untimed: the time ran out)
 *   wrong string (untimed, shot still alive): the keeper dives the wrong way, combo 0, streak 0, NO heart lost:
 *                 the goal only happens if the time then runs out.
 * The multiplier (x1..x5, +1 every 5 of combo) only grows with clean saves. A double shot saved cleanly twice
 * gives `DOUBLE_BONUS` x multiplier on top.
 */
import type { Judgement } from '../../model/exercise';
import { comboMultiplier, MAX_HEARTS, MAX_RESTARTS, ROUNDS } from '../salto/state';
import { nextPace, restartPace, streakSpeed } from './pace';

export { comboMultiplier, MAX_HEARTS, MAX_RESTARTS, ROUNDS };
export const CLEAN_POINTS = 100;
export const FUMBLED_POINTS = 40;
export const SPEED_BONUS = 40;
export const DOUBLE_BONUS = 50;
export const FLAWLESS_BONUS = 500;

export type ShotOutcome = 'clean' | 'fumbled' | 'goal';

export interface ShotResolution {
  outcome: ShotOutcome;
  points: number;
  heartLost: boolean;
  /** True when this goal took the last heart: abandon the round and call `failRound()`. */
  roundFailed: boolean;
}

export interface RoundPlan {
  round: number;
  /** Seconds per shot (untimed) or bpm (timed). */
  pace: number;
  retry: boolean;
  attempt: number;
  countInBeats: number;
}

export interface RoundEnd {
  accuracy: number;
  bonus: number;
  heartGained: boolean;
  over: boolean;
  pace: number;
}

export interface RoundFail {
  over: boolean;
  pace: number;
}

export class PorteroRun {
  readonly timed: boolean;
  readonly basePace: number;
  pace: number;
  round = 1;
  attempt = 1;
  restarts = 0;
  hearts = MAX_HEARTS;
  score = 0;
  combo = 0;
  bestCombo = 0;
  /** Clean saves in a row: speeds up the next shots (untimed). */
  streak = 0;
  over = false;
  recentAccuracy: number | null = null;
  private retry = false;
  private clean = 0;
  private fumbled = 0;
  private goals = 0;

  constructor(timed: boolean, basePace: number) {
    this.timed = timed;
    this.basePace = basePace;
    this.pace = basePace;
  }

  get multiplier(): number {
    return comboMultiplier(this.combo);
  }

  /** Multiplier of the untimed time limit for the next shots (1 = base pace). */
  get speed(): number {
    return this.timed ? 1 : streakSpeed(this.streak);
  }

  plan(): RoundPlan {
    return { round: this.round, pace: this.pace, retry: this.retry, attempt: this.attempt, countInBeats: this.timed ? 4 : 0 };
  }

  /**
   * The Judge's final verdict for a shot. Timed: hit clean; early/late fumbled; miss/wrong goal.
   * Untimed: `hit` is a save (clean when `wrongAttempts` is 0, else fumbled), `miss` (time ran out) a goal.
   * `timeLeft` (0..1) only matters for untimed clean saves.
   */
  resolve(judgement: Judgement, opts: { wrongAttempts?: number; timeLeft?: number } = {}): ShotResolution {
    if (this.over) return { outcome: 'goal', points: 0, heartLost: false, roundFailed: false };
    const wrongs = opts.wrongAttempts ?? 0;
    if (judgement === 'hit' && (this.timed || wrongs === 0)) {
      const bonus = this.timed ? 0 : Math.round(SPEED_BONUS * Math.min(1, Math.max(0, opts.timeLeft ?? 0)));
      const points = (CLEAN_POINTS + bonus) * this.multiplier;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.streak++;
      this.score += points;
      this.clean++;
      return { outcome: 'clean', points, heartLost: false, roundFailed: false };
    }
    if (judgement === 'early' || judgement === 'late' || judgement === 'hit') {
      const points = FUMBLED_POINTS * this.multiplier;
      this.combo = Math.floor(this.combo / 2);
      this.streak = 0;
      this.score += points;
      this.fumbled++;
      return { outcome: 'fumbled', points, heartLost: false, roundFailed: false };
    }
    this.combo = 0;
    this.streak = 0;
    this.goals++;
    this.hearts = Math.max(0, this.hearts - 1);
    return { outcome: 'goal', points: 0, heartLost: true, roundFailed: this.hearts === 0 };
  }

  /** Untimed: the wrong string was played while the shot is alive. Combo and streak are lost, no heart. */
  wrongString(): { comboLost: number } {
    const comboLost = this.combo;
    this.combo = 0;
    this.streak = 0;
    return { comboLost };
  }

  /** A double shot whose two balls were both saved cleanly. */
  doubleBonus(): number {
    const points = DOUBLE_BONUS * this.multiplier;
    this.score += points;
    return points;
  }

  completeRound(): RoundEnd {
    const total = this.clean + this.fumbled + this.goals;
    const accuracy = total ? (this.clean + 0.5 * this.fumbled) / total : 0;
    const bonus = total > 0 && this.clean === total ? FLAWLESS_BONUS * this.round : 0;
    this.score += bonus;
    this.recentAccuracy = this.recentAccuracy === null ? accuracy : 0.6 * accuracy + 0.4 * this.recentAccuracy;
    const heartGained = accuracy >= 0.9 && this.hearts < MAX_HEARTS;
    if (heartGained) this.hearts++;
    this.resetRound();
    this.retry = false;
    if (this.round >= ROUNDS) {
      this.over = true;
      return { accuracy, bonus, heartGained, over: true, pace: this.pace };
    }
    this.pace = nextPace(this.timed, this.pace, this.recentAccuracy, this.basePace);
    this.round++;
    this.attempt++;
    return { accuracy, bonus, heartGained, over: false, pace: this.pace };
  }

  /** All hearts lost: same round again, slower, hearts refilled. Over when the retries ran out. */
  failRound(): RoundFail {
    this.resetRound();
    this.combo = 0;
    if (this.restarts >= MAX_RESTARTS) {
      this.over = true;
      return { over: true, pace: this.pace };
    }
    this.restarts++;
    this.attempt++;
    this.retry = true;
    this.hearts = MAX_HEARTS;
    this.pace = restartPace(this.timed, this.pace, this.basePace);
    return { over: false, pace: this.pace };
  }

  private resetRound(): void {
    this.clean = this.fumbled = this.goals = 0;
    this.streak = 0;
  }
}
