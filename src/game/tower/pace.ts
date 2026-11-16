/**
 * Pace of Torre (pure). The arcade's own time pressure over the untimed Judge is the WATER that rises behind the
 * player. "Pace" is the speed of the water in platforms per second on the untimed levels (1-9) and the tempo in bpm on
 * the timed level 10 (same band and rules as Salto, `../salto/pace`).
 *
 * The level fixes a base speed; during a run it moves inside a band around it according to how the player is doing.
 * A bass gets ~20 % slower water (low notes are recognised later); its timed tempo is 1/1.2 as fast.
 */
import type { InstrumentId } from '../../model/instrument';
import { restartBpm } from '../salto/pace';

export const BASS_SPEED_FACTOR = 0.8;
export const BASS_TEMPO_FACTOR = 1.2;
export const RECENT_WINDOW = 4;
/** Water speed of level 1 (platforms per second) and what each level adds; level 9 is the fastest untimed one. */
const BASE_SPEED = 0.12;
const SPEED_PER_LEVEL = 0.02;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const isBass = (instrument: InstrumentId) => instrument !== 'guitar';

/** Platforms per second of the water at a level: 0.12 at level 1 up to 0.28 at level 9 (x0.8 for a bass). */
export function baseWaterSpeed(level: number, instrument: InstrumentId): number {
  const lv = Math.min(9, Math.max(1, Math.round(level)));
  return r3((BASE_SPEED + SPEED_PER_LEVEL * (lv - 1)) * (isBass(instrument) ? BASS_SPEED_FACTOR : 1));
}

/** Base tempo of a timed level: the generator's, 1/1.2 as fast for a bass. */
export function baseTimedBpm(exerciseBpm: number, instrument: InstrumentId): number {
  return isBass(instrument) ? Math.round(exerciseBpm / BASS_TEMPO_FACTOR) : exerciseBpm;
}

export interface SpeedRange {
  min: number;
  max: number;
}

/** Band the water moves in: from 70 % to 140 % of the base. */
export function speedRange(base: number): SpeedRange {
  return { min: r3(base * 0.7), max: r3(base * 1.4) };
}

/**
 * Performance of one note, 0..1: the waiting time is measured in how far the water rose meanwhile
 * (`reaction` seconds x `speed` platforms/second), so a slow note on slow water is not a bad one.
 *   instant 1 .. a whole platform of water 0.4 · halved when a wrong note came first · skipped 0
 */
export function notePerformance(reaction: number, speed: number, wrongs: number, skipped: boolean): number {
  if (skipped) return 0;
  const rose = Math.min(1, Math.max(0, reaction * speed));
  const p = 1 - 0.6 * rose;
  return wrongs > 0 ? p * 0.5 : p;
}

/**
 * Water speed after a note, from the most recent performances (the last RECENT_WINDOW):
 *   mean >= 0.85 -> +6 %    >= 0.7 -> +2 %    0.5 .. 0.7 -> same    < 0.5 -> -8 %    < 0.25 -> -15 %
 * Stays inside `speedRange(base)`; a retry that went under the band is never pushed back up by the clamp alone.
 */
export function nextWaterSpeed(current: number, recent: readonly number[], base: number): number {
  if (!recent.length) return current;
  const win = recent.slice(-RECENT_WINDOW);
  const mean = win.reduce((a, b) => a + b, 0) / win.length;
  const factor = mean >= 0.85 ? 1.06 : mean >= 0.7 ? 1.02 : mean >= 0.5 ? 1 : mean >= 0.25 ? 0.92 : 0.85;
  const r = speedRange(base);
  const lo = Math.min(r.min, current);
  return r3(Math.min(r.max, Math.max(lo, current * factor)));
}

/** Speed after losing every heart: 20 % slower, down to half the base ("Otra vez, más despacio"). */
export function restartWaterSpeed(current: number, base: number): number {
  return r3(Math.max(base * 0.5, current * 0.8));
}

/** Pace of the retry for either kind of exercise (always slower until its floor). */
export function restartPace(timed: boolean, current: number, base: number): number {
  return timed ? restartBpm(current, base) : restartWaterSpeed(current, base);
}
