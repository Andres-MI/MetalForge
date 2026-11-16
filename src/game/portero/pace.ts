/**
 * Adaptive pace of Portero (pure). "Pace" is a number whose unit depends on the exercise:
 *  - untimed levels (1-6): SECONDS the player has per shot (smaller = harder);
 *  - timed levels (7+): BPM (bigger = harder), with the same band and rules as Salto (`../salto/pace`).
 * The level fixes a base pace; the game moves inside a band around it according to the recent accuracy.
 * Bass gets about 20 % more time: more seconds per shot, and a tempo 1/1.2 as fast.
 */
import type { InstrumentId } from '../../model/instrument';
import { bpmRange, nextBpm, restartBpm } from '../salto/pace';

export const BASS_TIME_FACTOR = 1.2;
/** Seconds per shot of levels 1..6 for a guitar (the untimed levels). */
const BASE_SECONDS = [4.2, 4.0, 3.8, 3.6, 3.4, 3.2];

const round1 = (x: number) => Math.round(x * 10) / 10;
export const isBass = (instrument: InstrumentId) => instrument !== 'guitar';

/** Base seconds per shot for an untimed level (levels above 6 use the last value). */
export function baseShotSeconds(level: number, instrument: InstrumentId): number {
  const s = BASE_SECONDS[Math.min(BASE_SECONDS.length, Math.max(1, Math.round(level))) - 1];
  return round1(isBass(instrument) ? s * BASS_TIME_FACTOR : s);
}

/** Base tempo of a timed level: the generator's, 1/1.2 as fast for a bass. */
export function baseTimedBpm(exerciseBpm: number, instrument: InstrumentId): number {
  return isBass(instrument) ? Math.round(exerciseBpm / BASS_TIME_FACTOR) : exerciseBpm;
}

export interface SecondsRange {
  min: number;
  max: number;
}

/** Seconds band of a level: from 35 % less time to 40 % more than its base. */
export function shotRange(base: number): SecondsRange {
  return { min: round1(base * 0.65), max: round1(base * 1.4) };
}

/**
 * Seconds per shot of the next round (smaller = faster) from the recent accuracy (0..1: clean save 1, fumbled 0.5):
 *  >= 0.9 -> -8 %    >= 0.8 -> -4 %    0.6 .. 0.8 -> same    < 0.6 -> +8 %    < 0.4 -> +15 %
 * Stays inside `shotRange(base)`; a retry that went above the band is not pushed back down by the clamp alone.
 */
export function nextShotSeconds(current: number, recentAccuracy: number, base: number): number {
  const a = Math.min(1, Math.max(0, recentAccuracy));
  const factor = a >= 0.9 ? 0.92 : a >= 0.8 ? 0.96 : a >= 0.6 ? 1 : a >= 0.4 ? 1.08 : 1.15;
  const r = shotRange(base);
  const hi = Math.max(r.max, current);
  return Math.min(hi, Math.max(r.min, round1(current * factor)));
}

/** Seconds after losing every heart: 20 % more time (at least +0.3 s), up to 1.6x the base. */
export function restartShotSeconds(current: number, base: number): number {
  const cap = round1(base * 1.6);
  return Math.min(cap, round1(current + Math.max(0.3, current * 0.2)));
}

/** Streak of clean saves -> multiplier of the time limit: each 4 clean saves in a row take 6 % off, at most 3 steps (-18 %). */
export function streakSpeed(cleanStreak: number): number {
  return Math.round((1 - 0.06 * Math.min(3, Math.floor(Math.max(0, cleanStreak) / 4))) * 100) / 100;
}

/** Pace of the next round for either kind of exercise. */
export function nextPace(timed: boolean, current: number, accuracy: number, base: number): number {
  return timed ? nextBpm(current, accuracy, base) : nextShotSeconds(current, accuracy, base);
}

/** Pace of the retry for either kind of exercise (always slower until its floor/cap). */
export function restartPace(timed: boolean, current: number, base: number): number {
  return timed ? restartBpm(current, base) : restartShotSeconds(current, base);
}

export { bpmRange };
