/**
 * Hechicero's rules, pure (no Phaser, no audio). The Judge underneath is untimed on levels 1-9 (it waits for the
 * player) and the arcade adds its own clock: every enemy walks towards the wizard and has a time limit. Level 10 is
 * timed: the enemies arrive on the beat and the Judge's timing decides. Time is injected (`now`, seconds), never read here.
 *
 * A RUN is `WAVES` waves; each wave is one Exercise judged by the shared Judge. At the end of wave 3 a BOSS appears: a
 * second exercise (a progression of 4-6 chords) whose chords break the plates of its shield one by one.
 *
 *   - spell cast, CLEAN (cleanliness >= `TUNING.criticalClean`; on the beat too in the timed level)
 *       CRITICAL HIT   +100 x 1.8 x multiplier x speed (1.0..1.5)
 *   - spell cast, accepted but not clean   normal hit   +100 x multiplier x speed
 *   - CHANGE bonus: casting a DIFFERENT chord than the previous cast within `TUNING.changeWindow` x the enemy's time limit
 *       (timed level: on the beat) adds +40 x the length of the change chain (chain capped at 5); a slow or repeated
 *       cast resets the chain. This is the skill being trained.
 *   - wrong chord = FIZZLE: combo and chain lost, no heart; the same enemy keeps waiting (a short grace after it appears
 *       is not punished: the previous chord may still be ringing)
 *   - enemy arrives (time over / missed on the beat): -1 heart, combo and chain lost, target skipped
 *   - multiplier x1..x5: +1 every 5 clean casts in a row
 *   - boss: its plates give x1.5; breaking all of them is worth `BOSS_BONUS`
 *   - all hearts lost: the SAME wave again, 25 % more time (or 15 % slower tempo), hearts refilled (never back to the
 *       menu); after `MAX_RESTARTS` retries the run ends
 *   - wave completed: +300 x wave when flawless; +1 heart when its accuracy is >= 90 %
 *
 * A chord verdict arrives about 0.25 s after the strum, so the scene tells the run when an attack was heard
 * (`strumHeard`) and when its verdict arrived (`strumDone`): while a strum is being judged the enemy never counts as
 * arrived (`expired` is false), and the scene shows a short "casting" charge.
 */
import { baseLimit, BOSS_TIME_FACTOR, foePerformance, nextBpm, nextLimit, restartBpm, restartLimit } from './pace';
import type { InstrumentId } from '../../model/instrument';

export const MAX_HEARTS = 3;
export const WAVES = 3;
export const MAX_RESTARTS = 3;
export const NORMAL_POINTS = 100;
export const CRITICAL_FACTOR = 1.8;
export const CHANGE_BONUS = 40;
export const CHANGE_CHAIN_MAX = 5;
export const FLAWLESS_BONUS = 300;
export const BOSS_BONUS = 600;
export const BOSS_PLATE_FACTOR = 1.5;
export const MAX_MULTIPLIER = 5;
/** Seconds after an enemy appears during which a wrong chord is not punished. */
export const FIZZLE_GRACE = 0.35;
/** Longest wait for a chord verdict after an attack, seconds (the real one takes ~0.25 s). */
export const CAST_WAIT = 0.8;

/** Tunable numbers of the arcade. */
export const TUNING = {
  /** Cleanliness (0..1, `ChordAnalysis.cleanliness`) from which an accepted chord is a critical hit. */
  criticalClean: 0.6,
  /** A change is "quick" when the cast comes within this share of the enemy's time limit after the previous cast. */
  changeWindow: 0.7,
};

export function comboMultiplier(combo: number): number {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(Math.max(0, combo) / 5));
}

/** Reaction speed factor: 1.5 for an instant cast down to 1.0 at the last moment. */
export function speedFactor(reaction: number, limit: number): number {
  return 1 + 0.5 * (1 - Math.min(1, Math.max(0, reaction / limit)));
}

/** Chords of the boss progression: 4 at levels 1-3, 5 at 4-7, 6 at 8-9 (the timed level always has 4). */
export function bossLength(level: number): number {
  return level >= 10 ? 4 : level >= 8 ? 6 : level >= 4 ? 5 : 4;
}

export interface LiveFoe {
  /** Index of the enemy (chord group) in the wave and the chord it carries. */
  index: number;
  name: string;
  boss: boolean;
  /** Notes still to play: 1 on guitar, 3-4 on bass (the rune fills in step by step). */
  steps: number;
  done: number;
  startedAt: number;
  /** Seconds the enemy takes to arrive (untimed levels). */
  limit: number;
  fizzles: number;
}

export type CastResult = {
  kind: 'critical' | 'normal';
  points: number;
  /** Extra points of the change bonus (already in `points`). */
  bonus: number;
  /** The cast was a quick change into another chord. */
  change: boolean;
  chain: number;
  reaction: number;
};

export interface CastInfo {
  /** The chord (or, on bass, the whole note sequence) was clean. */
  clean: boolean;
  /** Timed level only: the cast landed on the beat. Overrides the time window of the change bonus. */
  onBeat?: boolean;
}

export interface WaveEnd {
  accuracy: number;
  bonus: number;
  heartGained: boolean;
  over: boolean;
}

export interface WaveFail {
  over: boolean;
  limit: number;
  bpm: number;
}

export class WizardRun {
  readonly level: number;
  readonly timed: boolean;
  readonly baseLimit: number;
  readonly baseBpm: number;
  /** Seconds per plain enemy right now (untimed levels). */
  limit: number;
  /** Tempo of the wave (timed level; 0 otherwise). */
  bpm: number;
  wave = 1;
  stage: 'foes' | 'boss' = 'foes';
  attempt = 1;
  restarts = 0;
  hearts = MAX_HEARTS;
  score = 0;
  combo = 0;
  bestCombo = 0;
  chain = 0;
  over = false;
  bossDefeated = false;
  live: LiveFoe | null = null;
  lastCast: { name: string; at: number } | null = null;
  private recent: number[] = [];
  private casts = 0;
  private cleanCasts = 0;
  private arrivals = 0;
  private fizzleCount = 0;
  private castUntil = -Infinity;

  constructor(level: number, instrument: InstrumentId, bpm?: number) {
    this.level = level;
    this.timed = bpm !== undefined;
    this.baseLimit = baseLimit(level, instrument);
    this.limit = this.baseLimit;
    this.baseBpm = bpm ?? 0;
    this.bpm = bpm ?? 0;
  }

  get multiplier(): number {
    return comboMultiplier(this.combo);
  }

  /** An enemy appears; its countdown starts at `now + delay`. */
  spawn(index: number, foe: { name: string; steps?: number; boss?: boolean }, now: number, delay = 0): LiveFoe {
    this.live = {
      index,
      name: foe.name,
      boss: !!foe.boss,
      steps: foe.steps ?? 1,
      done: 0,
      startedAt: now + delay,
      limit: this.limit * (foe.boss ? BOSS_TIME_FACTOR : 1),
      fizzles: 0,
    };
    return this.live;
  }

  /** The wave is over for the plain enemies: the boss comes next. */
  enterBoss(): void {
    this.stage = 'boss';
    this.live = null;
  }

  /** Seconds left (above the limit during the start delay), or null with no enemy. */
  remaining(now: number): number | null {
    const e = this.live;
    return e ? e.startedAt + e.limit - now : null;
  }

  // ----- strum being judged -----

  /** An attack was heard: its chord verdict is on the way. */
  strumHeard(now: number): void {
    this.castUntil = now + CAST_WAIT;
  }

  /** The verdict of the strum arrived (or the wait is over). */
  strumDone(): void {
    this.castUntil = -Infinity;
  }

  casting(now: number): boolean {
    return now < this.castUntil;
  }

  /** Time over. Never while a strum is being judged, never in the timed level (the beat decides there). */
  expired(now: number): boolean {
    const r = this.remaining(now);
    return !this.timed && r !== null && r <= 0 && !this.casting(now);
  }

  // ----- what the player does -----

  /** A note of a bass enemy's sequence was played (not the last one). Returns the steps done. */
  step(): number {
    const e = this.live;
    if (!e) return 0;
    e.done = Math.min(e.steps - 1, e.done + 1);
    return e.done;
  }

  /** A wrong chord: combo and chain lost, no heart. False when it was ignored (grace after the enemy appeared). */
  fizzle(now: number): boolean {
    const e = this.live;
    if (!e || this.over || now < e.startedAt + FIZZLE_GRACE) return false;
    e.fizzles++;
    this.fizzleCount++;
    this.combo = 0;
    this.chain = 0;
    return true;
  }

  /** Timed level: a wrong chord on its beat. The beat has passed, so the enemy retreats: no heart lost, combo and chain are. */
  retreat(): boolean {
    const e = this.live;
    if (!e || this.over) return false;
    e.fizzles++;
    this.fizzleCount++;
    this.combo = 0;
    this.chain = 0;
    this.lastCast = null;
    this.finishFoe(0.2);
    return true;
  }

  /** The right chord was cast. */
  cast(now: number, info: CastInfo): CastResult | null {
    const e = this.live;
    if (!e || this.over) return null;
    const reaction = Math.max(0, now - e.startedAt);
    const clean = info.clean && e.fizzles === 0;
    // Quick change into another chord.
    const prev = this.lastCast;
    const different = !!prev && prev.name !== e.name;
    const quick = this.timed ? !!info.onBeat : !!prev && now - prev.at <= TUNING.changeWindow * e.limit;
    const change = different && quick;
    this.chain = change ? Math.min(CHANGE_CHAIN_MAX, this.chain + 1) : 0;
    const critical = clean && (!this.timed || info.onBeat !== false);
    const factor = (critical ? CRITICAL_FACTOR : 1) * (e.boss ? BOSS_PLATE_FACTOR : 1);
    const speed = this.timed ? 1 : speedFactor(reaction, e.limit);
    const base = Math.round(NORMAL_POINTS * factor * this.multiplier * speed);
    const bonus = change ? CHANGE_BONUS * this.chain : 0;
    const points = base + bonus;
    if (clean) {
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.cleanCasts++;
    }
    this.score += points;
    this.casts++;
    this.lastCast = { name: e.name, at: now };
    this.finishFoe(foePerformance(reaction, e.limit, e.fizzles, false));
    return { kind: critical ? 'critical' : 'normal', points, bonus, change, chain: this.chain, reaction };
  }

  /** The enemy arrives. Returns true when that took the last heart (the wave must be abandoned). */
  arrive(): boolean {
    if (!this.live || this.over) return false;
    this.arrivals++;
    this.combo = 0;
    this.chain = 0;
    this.lastCast = null;
    this.hearts = Math.max(0, this.hearts - 1);
    this.finishFoe(0);
    return this.hearts === 0;
  }

  private finishFoe(perf: number): void {
    this.live = null;
    this.castUntil = -Infinity;
    this.recent.push(perf);
    if (!this.timed) this.limit = nextLimit(this.limit, this.recent, this.baseLimit);
  }

  /** The wave's last exercise finished with hearts left (`bossBroken` when the shield of the wave-3 boss fell). */
  completeWave(bossBroken = false): WaveEnd {
    const total = this.casts + this.arrivals;
    const accuracy = total ? this.cleanCasts / total : 0;
    const flawless = total > 0 && this.arrivals === 0 && this.fizzleCount === 0;
    let bonus = flawless ? FLAWLESS_BONUS * this.wave : 0;
    if (bossBroken) {
      bonus += BOSS_BONUS;
      this.bossDefeated = true;
    }
    this.score += bonus;
    const heartGained = accuracy >= 0.9 && this.hearts < MAX_HEARTS;
    if (heartGained) this.hearts++;
    this.resetWave();
    if (this.timed) this.bpm = nextBpm(this.bpm, accuracy, this.baseBpm);
    if (this.wave >= WAVES) {
      this.over = true;
      return { accuracy, bonus, heartGained, over: true };
    }
    this.wave++;
    this.attempt++;
    return { accuracy, bonus, heartGained, over: false };
  }

  /** All hearts lost: the same wave again, slower, hearts refilled. Over when the retries ran out. */
  failWave(): WaveFail {
    this.resetWave();
    this.combo = 0;
    this.chain = 0;
    if (this.restarts >= MAX_RESTARTS) {
      this.over = true;
      return { over: true, limit: this.limit, bpm: this.bpm };
    }
    this.restarts++;
    this.attempt++;
    this.hearts = MAX_HEARTS;
    this.limit = restartLimit(this.limit, this.baseLimit);
    if (this.timed) this.bpm = restartBpm(this.bpm, this.baseBpm);
    this.recent = [];
    return { over: false, limit: this.limit, bpm: this.bpm };
  }

  private resetWave(): void {
    this.casts = this.cleanCasts = this.arrivals = this.fizzleCount = 0;
    this.live = null;
    this.stage = 'foes';
    this.lastCast = null;
    this.castUntil = -Infinity;
  }
}
