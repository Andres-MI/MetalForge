/**
 * Adaptive time limit per enemy for Ninja (pure). The level fixes a base limit; during a run the limit shrinks
 * when the recent play was fast and clean and grows when it was slow or failed, always inside a band around the base.
 * Bass gets 20 % more time (low notes are recognised later).
 */
import type { InstrumentId } from '../../model/instrument';

export const SHIELD_TIME_FACTOR = 1.6;
export const BASS_TIME_FACTOR = 1.2;
export const RECENT_WINDOW = 4;

/** Seconds the player has per enemy at a level: 7.0 s at level 1 down to 3.85 s at level 10 (x1.2 for bass). */
export function baseLimit(level: number, instrument: InstrumentId): number {
  const lv = Math.min(10, Math.max(1, Math.round(level)));
  const s = 7 - 0.35 * (lv - 1);
  return Math.round(s * (instrument === 'guitar' ? 1 : BASS_TIME_FACTOR) * 100) / 100;
}

export interface LimitRange {
  min: number;
  max: number;
}

/** Band the limit moves in: from 60 % to 150 % of the base. */
export function limitRange(base: number): LimitRange {
  return { min: Math.round(base * 0.6 * 100) / 100, max: Math.round(base * 1.5 * 100) / 100 };
}

/**
 * Performance of one enemy, 0..1:
 *   timeout 0 · killed with reaction r of limit L: 1 - 0.6 * r/L (1 at once, 0.4 at the last moment)
 *   halved when a wrong fret was tried first.
 */
export function targetPerformance(reaction: number, limit: number, wrongs: number, timedOut: boolean): number {
  if (timedOut) return 0;
  const speed = 1 - 0.6 * Math.min(1, Math.max(0, reaction / limit));
  return wrongs > 0 ? speed * 0.5 : speed;
}

/**
 * Limit for the next enemy from the current one and the most recent performances (the last RECENT_WINDOW are used):
 *   mean >= 0.85 -> -6 %    >= 0.7 -> -2 %    0.5 .. 0.7 -> same    < 0.5 -> +8 %    < 0.25 -> +15 %
 * Stays inside `limitRange(base)` (a restart may leave it above the band; it is then never pushed up further, only down).
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
