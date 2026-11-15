/**
 * Adaptive speed for the arcade modes (pure). The level fixes a base tempo; the game may move inside a
 * sensible band around it: faster when the recent accuracy is high, slower when it is low.
 */

export interface BpmRange {
  min: number;
  max: number;
}

/** Band a level may be played in: from 25 % under its base tempo to 35 % over it (never under 40 bpm). */
export function bpmRange(baseBpm: number): BpmRange {
  return { min: Math.max(40, Math.round(baseBpm * 0.75)), max: Math.max(41, Math.round(baseBpm * 1.35)) };
}

export function clampBpm(bpm: number, baseBpm: number): number {
  const r = bpmRange(baseBpm);
  return Math.min(r.max, Math.max(r.min, Math.round(bpm)));
}

/**
 * Tempo of the next round from the current one and the recent accuracy (0..1, as `RoundSummary.accuracy`:
 * a clean hit counts 1, early/late 0.5).
 *   >= 0.9  -> +8 %      >= 0.8 -> +4 %      0.6 .. 0.8 -> same      < 0.6 -> -8 %      < 0.4 -> -15 %
 * Always moves at least 2 bpm when it moves, and stays inside `bpmRange(baseBpm)` (below it only if it already was).
 */
export function nextBpm(currentBpm: number, recentAccuracy: number, baseBpm: number): number {
  const a = Math.min(1, Math.max(0, recentAccuracy));
  const factor = a >= 0.9 ? 0.08 : a >= 0.8 ? 0.04 : a >= 0.6 ? 0 : a >= 0.4 ? -0.08 : -0.15;
  const r = bpmRange(baseBpm);
  // A retry may have gone under the band (see restartBpm): never push it back up by clamping alone.
  const lo = Math.min(r.min, Math.round(currentBpm));
  const step = factor === 0 ? 0 : Math.sign(factor) * Math.max(2, Math.round(Math.abs(factor) * currentBpm));
  return Math.min(r.max, Math.max(lo, Math.round(currentBpm + step)));
}

/**
 * Tempo after losing every heart: 15 % slower (at least 3 bpm). A retry may go under the normal band, down to
 * 60 % of the base tempo, so that it is always really slower until that floor.
 */
export function restartBpm(currentBpm: number, baseBpm: number): number {
  const floor = Math.max(36, Math.round(baseBpm * 0.6));
  return Math.max(floor, Math.round(currentBpm - Math.max(3, Math.round(currentBpm * 0.15))));
}
