/**
 * Torre's rules, pure (no Phaser, no audio). The Judge underneath is untimed (it waits for the player); the arcade adds
 * its own pressure on top: WATER (or darkness) rising behind the hero. Time is injected (`now`, seconds), never read here.
 *
 * A RUN is `FLOORS` floors; each is one scales Exercise (an ordered run of the scale, one platform per note) judged by
 * the shared Judge. After floors 1 and 2 comes a boss room (src/game/tower/boss.ts).
 *
 * Untimed levels (1-9). Height is counted in platforms; `gap` is how many platforms the hero stands above the water.
 *   - right note       the hero jumps to the next platform: gap +1 (at most `MAX_GAP`)
 *                      clean (no wrong note first)  +100 x multiplier x speed (1.0..1.5, faster = more), combo +1
 *                      after a wrong note           +50 x multiplier, combo not increased
 *   - wrong note       combo halved and a small slip (gap -`SLIP`); no heart
 *   - the water rises  `speed` platforms/second (adaptive, see pace.ts); when gap reaches 0 it catches the hero:
 *                      -1 heart, combo 0, the current target is skipped (`skipCurrent`), the hero is lifted to a gap of
 *                      `RESCUE_GAP` and the water holds still for `INVULN_SECONDS`
 *   - all hearts lost  the SAME floor again, water 20 % slower ("Otra vez, más despacio"), hearts refilled; never back
 *                      to the menu; after `MAX_RESTARTS` retries the run ends
 *   - a clean ascent or descent (a whole phase of the run with no wrong note and no skip) +`PHASE_BONUS` x multiplier
 *   - a floor with every note clean  +`FLAWLESS_BONUS` x floor; accuracy >= 90 % gives a heart back
 * Timed level 10 (the exercise has a clock): the jumps happen on the beat. Same verdicts as Salto: hit = clean jump,
 * early/late = clumsy jump (combo halved), miss/wrong = the hero falls and loses a heart (unless it is still
 * invulnerable). The water only shows how close the fall was; it does not chase.
 * The multiplier (x1..x5, +1 every 5 combo) only grows with clean jumps.
 */
import type { Judgement } from '../../model/exercise';
import type { InstrumentId } from '../../model/instrument';
import { runPhases, type Phase } from '../scales/info';
import { comboMultiplier, MAX_HEARTS, MAX_MULTIPLIER, MAX_RESTARTS } from '../salto/state';
import { nextBpm } from '../salto/pace';
import { baseWaterSpeed, nextWaterSpeed, notePerformance, restartPace } from './pace';

export { comboMultiplier, MAX_HEARTS, MAX_MULTIPLIER, MAX_RESTARTS };
export const FLOORS = 3;
export const CLEAN_POINTS = 100;
export const CLUMSY_POINTS = 50;
export const CLUMSY_TIMED_POINTS = 40;
export const PHASE_BONUS = 250;
export const FLAWLESS_BONUS = 400;
/** Platforms of water between the hero and the water when a floor starts, and the most it can grow to. */
export const START_GAP = 3;
export const MAX_GAP = 4.5;
export const RESCUE_GAP = 1.5;
export const SLIP = 0.4;
/** Seconds the water holds still after catching the hero, and before a floor's first note. */
export const INVULN_SECONDS = 2.5;
export const FLOOR_GRACE = 1.5;
/** Seconds after a target appears during which a wrong note is not punished (the previous note may still ring). */
export const WRONG_GRACE = 0.25;
/** Beats of invulnerability after a fall (timed). */
export const INVULNERABLE_BEATS = 1.5;

/** Reaction speed factor: 1.5 for an instant note down to 1.0 when the water rose a whole platform meanwhile. */
export function speedFactor(rose: number): number {
  return 1 + 0.5 * (1 - Math.min(1, Math.max(0, rose)));
}

export type JumpKind = 'clean' | 'clumsy';

export interface JumpResult {
  kind: JumpKind;
  points: number;
  /** Bonus of a clean ascent/descent completed with this note (0 when none). */
  phaseBonus: number;
  phase: Phase | null;
  reaction: number;
}

export type CatchResult = { heartLost: true; roundFailed: boolean };

export interface TimedResolution {
  outcome: 'clean' | 'clumsy' | 'fall' | 'spared';
  points: number;
  heartLost: boolean;
  roundFailed: boolean;
  phaseBonus: number;
}

export interface FloorEnd {
  accuracy: number;
  bonus: number;
  heartGained: boolean;
  over: boolean;
  flawless: boolean;
}

export interface FloorFail {
  over: boolean;
  /** New pace: platforms/second (untimed) or bpm (timed). */
  pace: number;
}

export class TowerRun {
  readonly timed: boolean;
  /** Base pace: water speed (untimed) or tempo in bpm (timed). */
  readonly basePace: number;
  /** Pace now. */
  pace: number;
  floor = 1;
  attempt = 1;
  restarts = 0;
  hearts = MAX_HEARTS;
  score = 0;
  combo = 0;
  bestCombo = 0;
  over = false;
  /** Platforms between the hero and the water (untimed). */
  gap = START_GAP;
  /** Smoothed accuracy of the completed floors (null before the first). */
  recentAccuracy: number | null = null;
  /** Number of target currently shown (the next platform to reach). */
  index = 0;
  private phases: Phase[] = [];
  private phaseDirty: boolean[] = [];
  private appearedAt = 0;
  private lastTick = 0;
  private waterFrozenUntil = -Infinity;
  private invulnerableUntil = -Infinity;
  private wrongsHere = 0;
  private recent: number[] = [];
  private clean = 0;
  private clumsy = 0;
  private failed = 0;
  private retry = false;

  /** `pace` is the base water speed (untimed) or the base tempo in bpm (timed). */
  constructor(timed: boolean, pace: number) {
    this.timed = timed;
    this.basePace = pace;
    this.pace = pace;
  }

  static forLevel(level: number, instrument: InstrumentId, timedBpm?: number): TowerRun {
    return new TowerRun(timedBpm !== undefined, timedBpm ?? baseWaterSpeed(level, instrument));
  }

  get multiplier(): number {
    return comboMultiplier(this.combo);
  }

  get retrying(): boolean {
    return this.retry;
  }

  /** A floor (or a retry of it) begins: `midis` are the notes of its targets, in order. */
  startFloor(midis: readonly number[], now: number): void {
    this.phases = runPhases(midis);
    this.phaseDirty = this.phases.map(() => false);
    this.index = 0;
    this.gap = START_GAP;
    this.wrongsHere = 0;
    this.recent = [];
    this.clean = this.clumsy = this.failed = 0;
    this.appearedAt = now + FLOOR_GRACE;
    this.lastTick = now;
    this.waterFrozenUntil = now + FLOOR_GRACE;
    this.invulnerableUntil = -Infinity;
  }

  phaseOf(index: number): number {
    return this.phases.findIndex((p) => index >= p.start && index <= p.end);
  }

  /** Seconds since the shown target appeared (never negative). */
  reaction(now: number): number {
    return Math.max(0, now - this.appearedAt);
  }

  isInvulnerable(at: number): boolean {
    return at < this.invulnerableUntil;
  }

  // ---------- untimed ----------

  /** The water rises up to `now`. Returns a catch when it reached the hero (the caller skips the target). */
  tick(now: number): CatchResult | null {
    if (this.timed || this.over) {
      this.lastTick = now;
      return null;
    }
    const from = Math.max(this.lastTick, this.waterFrozenUntil);
    if (now > from) this.gap -= (now - from) * this.pace;
    this.lastTick = now;
    if (this.gap > 0 || now < this.invulnerableUntil) return null;
    this.hearts = Math.max(0, this.hearts - 1);
    this.combo = 0;
    this.gap = RESCUE_GAP;
    this.invulnerableUntil = now + INVULN_SECONDS;
    this.waterFrozenUntil = now + INVULN_SECONDS;
    this.failed++;
    this.dirty(this.index);
    this.recent.push(notePerformance(0, 0, 0, true));
    this.pace = nextWaterSpeed(this.pace, this.recent, this.basePace);
    return { heartLost: true, roundFailed: this.hearts === 0 };
  }

  /** The target after the current one appears (the caller advances the platform). */
  next(index: number, now: number): void {
    this.index = index;
    this.appearedAt = now;
    this.wrongsHere = 0;
  }

  /** A wrong note: combo halved and a slip; no heart. Returns false when ignored (grace after the target appeared). */
  wrong(now: number): boolean {
    if (this.timed || this.over || now < this.appearedAt + WRONG_GRACE) return false;
    this.wrongsHere++;
    this.combo = Math.floor(this.combo / 2);
    this.gap = this.gap - SLIP;
    this.dirty(this.index);
    return true;
  }

  /** The right note arrived (untimed): the hero jumps up one platform. */
  jump(now: number): JumpResult | null {
    if (this.timed || this.over) return null;
    const reaction = this.reaction(now);
    const clean = this.wrongsHere === 0;
    const points = clean ? Math.round(CLEAN_POINTS * this.multiplier * speedFactor(reaction * this.pace)) : CLUMSY_POINTS * this.multiplier;
    if (clean) {
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.clean++;
    } else this.clumsy++;
    this.score += points;
    this.gap = Math.min(MAX_GAP, this.gap + 1);
    this.recent.push(notePerformance(reaction, this.pace, this.wrongsHere, false));
    this.pace = nextWaterSpeed(this.pace, this.recent, this.basePace);
    const idx = this.index;
    const phase = this.phaseEndingAt(idx);
    const phaseBonus = this.phaseBonusAt(idx);
    return { kind: clean ? 'clean' : 'clumsy', points, phaseBonus, phase, reaction };
  }

  // ---------- timed ----------

  /** The Judge's verdict for a target at `beat` (its own beat). */
  resolveTimed(judgement: Judgement, index: number, beat: number): TimedResolution {
    if (this.over) return { outcome: 'spared', points: 0, heartLost: false, roundFailed: false, phaseBonus: 0 };
    if (judgement === 'hit') {
      const points = CLEAN_POINTS * this.multiplier;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.score += points;
      this.clean++;
      return { outcome: 'clean', points, heartLost: false, roundFailed: false, phaseBonus: this.phaseBonusAt(index) };
    }
    if (judgement === 'early' || judgement === 'late') {
      const points = CLUMSY_TIMED_POINTS * this.multiplier;
      this.combo = Math.floor(this.combo / 2);
      this.score += points;
      this.clumsy++;
      this.dirty(index);
      return { outcome: 'clumsy', points, heartLost: false, roundFailed: false, phaseBonus: this.phaseBonusAt(index) };
    }
    this.combo = 0;
    this.failed++;
    this.dirty(index);
    const phaseBonus = this.phaseBonusAt(index);
    if (this.isInvulnerable(beat)) return { outcome: 'spared', points: 0, heartLost: false, roundFailed: false, phaseBonus };
    this.hearts = Math.max(0, this.hearts - 1);
    this.invulnerableUntil = beat + INVULNERABLE_BEATS;
    return { outcome: 'fall', points: 0, heartLost: true, roundFailed: this.hearts === 0, phaseBonus };
  }

  // ---------- common ----------

  private dirty(index: number): void {
    const p = this.phaseOf(index);
    if (p >= 0) this.phaseDirty[p] = true;
  }

  private phaseEndingAt(index: number): Phase | null {
    return this.phases.find((p) => p.end === index) ?? null;
  }

  /** Adds (and returns) the bonus when `index` closes a phase that stayed clean. */
  private phaseBonusAt(index: number): number {
    const p = this.phases.findIndex((ph) => ph.end === index);
    if (p < 0 || this.phaseDirty[p]) return 0;
    const bonus = PHASE_BONUS * this.multiplier;
    this.score += bonus;
    return bonus;
  }

  /** The floor's exercise finished with hearts left. */
  completeFloor(): FloorEnd {
    const total = this.clean + this.clumsy + this.failed;
    const accuracy = total ? (this.clean + 0.5 * this.clumsy) / total : 0;
    const flawless = total > 0 && this.clean === total;
    const bonus = flawless ? FLAWLESS_BONUS * this.floor : 0;
    this.score += bonus;
    this.recentAccuracy = this.recentAccuracy === null ? accuracy : 0.6 * accuracy + 0.4 * this.recentAccuracy;
    const heartGained = accuracy >= 0.9 && this.hearts < MAX_HEARTS;
    if (heartGained) this.hearts++;
    this.retry = false;
    this.clean = this.clumsy = this.failed = 0;
    if (this.floor >= FLOORS) {
      this.over = true;
      return { accuracy, bonus, heartGained, over: true, flawless };
    }
    if (this.timed) this.pace = nextBpm(this.pace, this.recentAccuracy, this.basePace);
    this.floor++;
    this.attempt++;
    return { accuracy, bonus, heartGained, over: false, flawless };
  }

  /** All hearts lost: the same floor again, slower, hearts refilled. Over when the retries ran out. */
  failFloor(): FloorFail {
    this.clean = this.clumsy = this.failed = 0;
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

  /** Points earned in a boss room (damage and the bonus for defeating it). */
  addBossPoints(points: number): void {
    this.score += points;
  }
}
