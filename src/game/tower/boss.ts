/**
 * The guardian of a boss room (Torre), pure. The player improvises on the scale over a backing vamp for `BOSS_BARS` bars
 * (the room's clock is the session's, in beats):
 *   - every note of the scale damages the guardian (`BASE_DAMAGE`);
 *   - repeating the SAME note in a row damages less and less (x0.6 each time, never under 10 %): move around the scale;
 *   - a note outside the scale heals it a little (`HEAL`), never above its full health;
 *   - no hearts are lost here. Defeating it gives `BOSS_BONUS`; running out of bars just continues the run.
 */
import { MAX_MULTIPLIER } from '../salto/state';

export { MAX_MULTIPLIER };
export const BOSS_BARS = 8;
export const BOSS_BEATS_PER_BAR = 4;
export const BASE_DAMAGE = 10;
export const HEAL = 3;
export const REPEAT_DECAY = 0.6;
export const MIN_REPEAT_FRACTION = 0.1;
/** Score per point of damage dealt, and the bonus for defeating the guardian (x the floor it guards). */
export const POINTS_PER_DAMAGE = 3;
export const BOSS_BONUS = 400;

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Health of the guardian: 70 at level 1 of the first floor, +6 per level, +10 per floor. */
export function bossHealth(level: number, floor: number): number {
  return 70 + 6 * (Math.min(10, Math.max(1, Math.round(level))) - 1) + 10 * (Math.max(1, floor) - 1);
}

/** Fraction of the full damage a note does when it is the `repeat`-th identical note in a row (1 = first). */
export function repeatFactor(repeat: number): number {
  return Math.max(MIN_REPEAT_FRACTION, Math.pow(REPEAT_DECAY, Math.max(0, repeat - 1)));
}

export interface BossHit {
  damage: number;
  /** How many times in a row this note has been played, this one included. */
  repeat: number;
  points: number;
  defeated: boolean;
}

export class BossFight {
  readonly maxHp: number;
  hp: number;
  readonly bars: number;
  /** Damage dealt, health given back and notes played over the fight. */
  dealt = 0;
  healed = 0;
  notes = 0;
  strays = 0;
  /** Different scale notes used (variety is what wins). */
  readonly used = new Set<number>();
  lastMidi: number | null = null;
  repeat = 0;
  /** Beat at which the time is up, relative to the room's beat 0. */
  readonly endBeat: number;

  constructor(maxHp: number, bars = BOSS_BARS) {
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.bars = bars;
    this.endBeat = bars * BOSS_BEATS_PER_BAR;
  }

  get defeated(): boolean {
    return this.hp <= 0;
  }

  /** Bar (1-based) a beat falls in, capped at the last one. */
  barAt(beat: number): number {
    return Math.min(this.bars, Math.max(0, Math.floor(beat / BOSS_BEATS_PER_BAR)) + 1);
  }

  /** The time is up when the beat reaches the end of the last bar. */
  timeUp(beat: number): boolean {
    return beat >= this.endBeat;
  }

  /** A note of the scale. */
  hit(midi: number): BossHit {
    this.repeat = midi === this.lastMidi ? this.repeat + 1 : 1;
    this.lastMidi = midi;
    this.notes++;
    this.used.add(midi);
    const damage = r1(Math.min(this.hp, BASE_DAMAGE * repeatFactor(this.repeat)));
    this.hp = r1(this.hp - damage);
    this.dealt = r1(this.dealt + damage);
    return { damage, repeat: this.repeat, points: Math.round(damage * POINTS_PER_DAMAGE), defeated: this.defeated };
  }

  /** A note outside the scale: the guardian heals a little and the repetition streak is broken. */
  stray(): number {
    this.strays++;
    this.repeat = 0;
    this.lastMidi = null;
    if (this.defeated) return 0;
    const back = r1(Math.min(HEAL, this.maxHp - this.hp));
    this.hp = r1(this.hp + back);
    this.healed = r1(this.healed + back);
    return back;
  }

  /** Bonus for having defeated it on the given floor (0 when it is still standing). */
  bonus(floor: number): number {
    return this.defeated ? BOSS_BONUS * Math.max(1, floor) : 0;
  }
}
