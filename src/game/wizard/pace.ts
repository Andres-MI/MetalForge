/**
 * Adaptive pace of Hechicero (pure). Forming a chord takes a beginner several seconds, so the limits are generous:
 *
 *  - untimed levels (1-9): seconds an enemy takes to walk to the wizard. 10 s at level 1, 0.5 s less per level, and the
 *    levels that start asking for CHANGES (5+) get 1.5 s extra on top of that trend. Bass +30 % (three notes in order,
 *    and low notes are recognised later). During a run the limit moves inside 70 %..150 % of the base: it shrinks when
 *    the recent play was fast and clean and grows when it was slow or failed.
 *  - timed level (10): the base tempo comes from the exercise; the run moves inside 80 %..125 % of it.
 */
import type { InstrumentId } from '../../model/instrument';

export const BASS_TIME_FACTOR = 1.3;
export const RECENT_WINDOW = 4;
/** Level from which the generator asks for chord CHANGES. */
export const CHANGES_FROM_LEVEL = 5;
export const CHANGE_EXTRA = 1.5;
/** The boss gives this much more time per chord than a plain enemy. */
export const BOSS_TIME_FACTOR = 1.25;

const clampLevel = (level: number) => Math.min(10, Math.max(1, Math.round(level)));

/** Seconds per enemy at a level (guitar: 10, 9.5, 9, 8.5, 9.5, 9, 8.5, 8, 7.5, 7). */
export function baseLimit(level: number, instrument: InstrumentId): number {
  const lv = clampLevel(level);
  const s = 10 - 0.5 * (lv - 1) + (lv >= CHANGES_FROM_LEVEL ? CHANGE_EXTRA : 0);
  return Math.round(s * (instrument === 'guitar' ? 1 : BASS_TIME_FACTOR) * 100) / 100;
}

export interface LimitRange {
  min: number;
  max: number;
}

export function limitRange(base: number): LimitRange {
  return { min: Math.round(base * 0.7 * 100) / 100, max: Math.round(base * 1.5 * 100) / 100 };
}

/**
 * Performance of one enemy, 0..1: a spell cast with reaction r of limit L is worth 1 - 0.6 r/L (1 at once, 0.4 at the
 * last moment); a fizzle first halves it; a crit is not needed to be 1. An enemy that arrived is 0.
 */
export function foePerformance(reaction: number, limit: number, fizzles: number, arrived: boolean): number {
  if (arrived) return 0;
  const speed = 1 - 0.6 * Math.min(1, Math.max(0, reaction / limit));
  return fizzles > 0 ? speed * 0.5 : speed;
}

/**
 * Limit for the next enemy from the current one and the last RECENT_WINDOW performances:
 *   mean >= 0.85 -> -6 %    >= 0.7 -> -2 %    0.5 .. 0.7 -> same    < 0.5 -> +8 %    < 0.25 -> +15 %
 * Stays inside `limitRange(base)` (a restart may leave it above the band: it is then never pushed up further).
 */
export function nextLimit(current: number, recent: number[], base: number): number {
  if (!recent.length) return current;
  const win = recent.slice(-RECENT_WINDOW);
  const mean = win.reduce((a, b) => a + b, 0) / win.length;
  const factor = mean >= 0.85 ? 0.94 : mean >= 0.7 ? 0.98 : mean >= 0.5 ? 1 : mean >= 0.25 ? 1.08 : 1.15;
  const r = limitRange(base);
  const hi = Math.max(r.max, current);
  return Math.round(Math.min(hi, Math.max(r.min, current * factor)) * 100) / 100;
}

/** Limit after losing every heart: 25 % more time, at most twice the base. */
export function restartLimit(current: number, base: number): number {
  return Math.round(Math.min(base * 2, current * 1.25) * 100) / 100;
}

// ---------- timed level ----------

export function bpmRange(base: number): LimitRange {
  return { min: Math.max(36, Math.round(base * 0.8)), max: Math.round(base * 1.25) };
}

/** Tempo after a wave from its accuracy (0..1): >= 0.9 +6 %, >= 0.7 same, < 0.7 -8 %, < 0.4 -15 %; inside `bpmRange`. */
export function nextBpm(current: number, accuracy: number, base: number): number {
  const factor = accuracy >= 0.9 ? 0.06 : accuracy >= 0.7 ? 0 : accuracy >= 0.4 ? -0.08 : -0.15;
  const r = bpmRange(base);
  const lo = Math.min(r.min, Math.round(current));
  const step = factor === 0 ? 0 : Math.sign(factor) * Math.max(2, Math.round(Math.abs(factor) * current));
  return Math.min(r.max, Math.max(lo, Math.round(current + step)));
}

/** Tempo after losing every heart: 15 % slower (at least 3 bpm), down to 60 % of the base. */
export function restartBpm(current: number, base: number): number {
  const floor = Math.max(30, Math.round(base * 0.6));
  return Math.max(floor, Math.round(current - Math.max(3, Math.round(current * 0.15))));
}
