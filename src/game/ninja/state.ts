/**
 * Ninja's rules, pure (no Phaser, no audio). The Judge underneath is untimed (it waits for the player); the
 * arcade adds its own clock on top: each enemy has a time limit, and when it runs out the enemy strikes.
 * Time is injected (`now` in seconds), never read here.
 *
 * A RUN is `WAVES` waves; each wave is one untimed Exercise (the `plan`) judged by the shared Judge.
 *   - kill an enemy          +100 x multiplier x speed (1.0..1.5, faster = more) + dash bonus; combo +1
 *   - kill after wrong frets +50 x multiplier, combo not increased
 *   - wrong fret             combo halved (no heart lost)
 *   - shielded enemy         needs the note TWICE: the first hit cracks the shield (+25 x multiplier), the second kills.
 *                            It has 1.6x the time. The Judge sees it as two consecutive targets with the same pitch.
 *   - time over              the enemy strikes: -1 heart, combo 0, target skipped (`skipCurrent`)
 *   - dash bonus             from level 6 (where the generator allows leaps of 7+ semitones): +5 per fret crossed
 *                            beyond 4, at most +40
 *   - multiplier x1..x5      +1 every 5 clean kills in a row
 *   - all hearts lost        the SAME wave again, with 25 % more time, hearts refilled (never back to the menu);
 *                            after `MAX_RESTARTS` retries the run ends
 *   - wave completed         +300 x wave when flawless; +1 heart when its accuracy is >= 90 %
 * The time limit adapts after each enemy (see pace.ts).
 */
import type { Exercise, Target } from '../../model/exercise';
import type { FretPos, InstrumentId } from '../../model/instrument';
import { baseLimit, nextLimit, restartLimit, SHIELD_TIME_FACTOR, targetPerformance } from './pace';

export const MAX_HEARTS = 3;
export const WAVES = 3;
export const MAX_RESTARTS = 3;
export const KILL_POINTS = 100;
export const CLUMSY_POINTS = 50;
export const CRACK_POINTS = 25;
export const FLAWLESS_BONUS = 300;
export const MAX_MULTIPLIER = 5;
export const SHIELD_FROM_LEVEL = 4;
export const LEAP_FROM_LEVEL = 6;
export const DASH_FREE_FRETS = 4;
export const DASH_BONUS_PER_FRET = 5;
export const DASH_BONUS_MAX = 40;
/** Seconds after an enemy appears during which a wrong note is not punished (the previous note may still be ringing). */
export const WRONG_GRACE = 0.25;

export function comboMultiplier(combo: number): number {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(Math.max(0, combo) / 5));
}

/** Reaction speed factor: 1.5 for an instant kill down to 1.0 at the last moment. */
export function speedFactor(reaction: number, limit: number): number {
  return 1 + 0.5 * (1 - Math.min(1, Math.max(0, reaction / limit)));
}

export function dashBonus(level: number, frets: number): number {
  if (level < LEAP_FROM_LEVEL) return 0;
  return Math.min(DASH_BONUS_MAX, Math.max(0, frets - DASH_FREE_FRETS) * DASH_BONUS_PER_FRET);
}

// ---------- wave plan ----------

export interface Enemy {
  pos: FretPos;
  midi: number;
  shield: boolean;
  /** Index of its first target in the derived exercise (a shielded enemy owns two consecutive targets). */
  firstIndex: number;
  /** Frets crossed from the previous enemy (0 for the first). */
  dash: number;
}

export interface WavePlan {
  /** The Exercise the Judge gets: the generated one, with every shielded enemy's target repeated. */
  exercise: Exercise;
  enemies: Enemy[];
  /** Enemy owning each target of `exercise`. */
  enemyOf: number[];
}

/** Share of enemies that carry a shield: none before level 4, then 20 % growing 3 points per level. */
export function shieldPercent(level: number): number {
  return level < SHIELD_FROM_LEVEL ? 0 : 20 + 3 * (level - SHIELD_FROM_LEVEL);
}

function hash(i: number, seed: number): number {
  let h = (Math.imul(i + 1, 2654435761) ^ Math.imul(seed + 7, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/** Turns a generated 'frets' exercise into the wave to play (deterministic by seed; the first enemy is never shielded). */
export function planWave(base: Exercise, level: number, seed: number): WavePlan {
  const pct = shieldPercent(level);
  const targets: Target[] = [];
  const enemies: Enemy[] = [];
  const enemyOf: number[] = [];
  let prev: FretPos | undefined;
  base.targets.forEach((t, i) => {
    if (t.kind.type !== 'note' || !t.kind.pos) throw new Error('Ninja needs note targets with a position');
    const shield = i > 0 && hash(i, seed) % 100 < pct;
    const pos = t.kind.pos;
    enemies.push({ pos, midi: t.kind.midi, shield, firstIndex: targets.length, dash: prev ? Math.abs(pos.fret - prev.fret) : 0 });
    for (let k = 0; k < (shield ? 2 : 1); k++) {
      targets.push(t);
      enemyOf.push(i);
    }
    prev = pos;
  });
  return { exercise: { ...base, id: `${base.id}:ninja`, targets }, enemies, enemyOf };
}

// ---------- run ----------

export interface LiveEnemy {
  index: number;
  shield: boolean;
  /** Hits still needed: 1, or 2 for a fresh shielded enemy. */
  hitsLeft: number;
  /** Time (context seconds) the countdown started and how long it lasts. */
  startedAt: number;
  limit: number;
  wrongs: number;
  dash: number;
}

export type HitResult =
  | { kind: 'crack'; points: number }
  | { kind: 'kill'; points: number; clean: boolean; reaction: number };

export interface WaveEnd {
  accuracy: number;
  bonus: number;
  heartGained: boolean;
  over: boolean;
}

export interface WaveFail {
  over: boolean;
  limit: number;
}

export class NinjaRun {
  readonly level: number;
  readonly baseLimit: number;
  /** Seconds per plain enemy right now. */
  limit: number;
  wave = 1;
  attempt = 1;
  restarts = 0;
  hearts = MAX_HEARTS;
  score = 0;
  combo = 0;
  bestCombo = 0;
  over = false;
  live: LiveEnemy | null = null;
  private recent: number[] = [];
  private kills = 0;
  private cleanKills = 0;
  private timeouts = 0;

  constructor(level: number, instrument: InstrumentId) {
    this.level = level;
    this.baseLimit = baseLimit(level, instrument);
    this.limit = this.baseLimit;
  }

  get multiplier(): number {
    return comboMultiplier(this.combo);
  }

  /** An enemy appears; its countdown starts at `now + delay`. */
  spawn(index: number, enemy: Pick<Enemy, 'shield' | 'dash'>, now: number, delay = 0): LiveEnemy {
    this.live = {
      index,
      shield: enemy.shield,
      hitsLeft: enemy.shield ? 2 : 1,
      startedAt: now + delay,
      limit: this.limit * (enemy.shield ? SHIELD_TIME_FACTOR : 1),
      wrongs: 0,
      dash: enemy.dash,
    };
    return this.live;
  }

  /** Seconds left (can be above the limit during the start delay), or null with no enemy. */
  remaining(now: number): number | null {
    const e = this.live;
    return e ? e.startedAt + e.limit - now : null;
  }

  expired(now: number): boolean {
    const r = this.remaining(now);
    return r !== null && r <= 0;
  }

  /** A wrong fret: combo halved, no heart. Returns false when it was ignored (grace after the enemy appeared). */
  wrong(now: number): boolean {
    const e = this.live;
    if (!e || this.over || now < e.startedAt + WRONG_GRACE) return false;
    e.wrongs++;
    this.combo = Math.floor(this.combo / 2);
    return true;
  }

  /** The right note arrived. */
  hit(now: number): HitResult | null {
    const e = this.live;
    if (!e || this.over) return null;
    const reaction = Math.max(0, now - e.startedAt);
    if (e.hitsLeft === 2) {
      e.hitsLeft = 1;
      const points = CRACK_POINTS * this.multiplier;
      this.score += points;
      return { kind: 'crack', points };
    }
    const clean = e.wrongs === 0;
    const points = clean
      ? Math.round(KILL_POINTS * this.multiplier * speedFactor(reaction, e.limit)) + dashBonus(this.level, e.dash)
      : CLUMSY_POINTS * this.multiplier;
    if (clean) {
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.cleanKills++;
    }
    this.score += points;
    this.kills++;
    this.finishEnemy(targetPerformance(reaction, e.limit, e.wrongs, false));
    return { kind: 'kill', points, clean, reaction };
  }

  /** Time over: the enemy strikes. Returns true when that took the last heart (the wave must be abandoned). */
  timeout(): boolean {
    if (!this.live || this.over) return false;
    this.timeouts++;
    this.combo = 0;
    this.hearts = Math.max(0, this.hearts - 1);
    this.finishEnemy(0);
    return this.hearts === 0;
  }

  private finishEnemy(perf: number): void {
    this.live = null;
    this.recent.push(perf);
    this.limit = nextLimit(this.limit, this.recent, this.baseLimit);
  }

  /** The wave's exercise finished with hearts left. */
  completeWave(): WaveEnd {
    const total = this.kills + this.timeouts;
    const accuracy = total ? this.cleanKills / total : 0;
    const flawless = total > 0 && this.cleanKills === total;
    const bonus = flawless ? FLAWLESS_BONUS * this.wave : 0;
    this.score += bonus;
    const heartGained = accuracy >= 0.9 && this.hearts < MAX_HEARTS;
    if (heartGained) this.hearts++;
    this.resetWave();
    if (this.wave >= WAVES) {
      this.over = true;
      return { accuracy, bonus, heartGained, over: true };
    }
    this.wave++;
    this.attempt++;
    return { accuracy, bonus, heartGained, over: false };
  }

  /** All hearts lost: same wave again, slower (more time), hearts refilled. Over when the retries ran out. */
  failWave(): WaveFail {
    this.resetWave();
    this.combo = 0;
    if (this.restarts >= MAX_RESTARTS) {
      this.over = true;
      return { over: true, limit: this.limit };
    }
    this.restarts++;
    this.attempt++;
    this.hearts = MAX_HEARTS;
    this.limit = restartLimit(this.limit, this.baseLimit);
    this.recent = [];
    return { over: false, limit: this.limit };
  }

  private resetWave(): void {
    this.kills = this.cleanKills = this.timeouts = 0;
    this.live = null;
  }
}
