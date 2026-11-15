/** Shared pieces of every generator: options, deterministic randomness and small helpers. */
import { INSTRUMENTS, midiAt, type FretPos, type Instrument, type InstrumentId } from '../model/instrument';
import { rng } from '../synth/karplus';

export const MAX_LEVEL = 10;

export interface GenerateOptions {
  instrument: InstrumentId;
  /** 1..10. Each level adds ONE new difficulty over the previous one. */
  level: number;
  /** Same seed + same options = same exercise. */
  seed: number;
  /**
   * Approximate number of targets (rhythm: number of beats, rounded up to whole 4/4 bars; chords: number
   * of chords). Scales ignore it unless given: the default is the whole run (thirds are capped at 16).
   * Default 8.
   */
  length?: number;
  /** Scales only: free play inside the scale (`anyOf` targets) instead of an ordered run. */
  free?: boolean;
}

export const DEFAULT_LENGTH = 8;

export function clampLevel(level: number): number {
  return Math.min(MAX_LEVEL, Math.max(1, Math.round(level)));
}

export function instrumentOf(id: InstrumentId): Instrument {
  return INSTRUMENTS[id];
}

/** Random stream for one generator; `salt` keeps different skills from sharing a stream. */
export function makeRng(seed: number, salt: number): () => number {
  const r = rng(((seed | 0) * 2654435761 + salt * 40503) >>> 0);
  r();
  return r;
}

export function pickInt(r: () => number, n: number): number {
  return Math.min(n - 1, Math.floor(r() * n));
}

export function pick<T>(r: () => number, items: readonly T[]): T {
  return items[pickInt(r, items.length)];
}

export function shuffle<T>(r: () => number, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = pickInt(r, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function exerciseId(skill: string, instrument: InstrumentId, level: number, seed: number, free = false): string {
  return `${skill}:${instrument}:L${level}:s${seed}${free ? ':free' : ''}`;
}

/** True when no two distinct positions of the list sound the same pitch. */
export function hasUniquePitches(inst: Instrument, zone: FretPos[]): boolean {
  const seen = new Set<number>();
  for (const p of zone) {
    const m = midiAt(inst, p);
    if (seen.has(m)) return false;
    seen.add(m);
  }
  return true;
}
