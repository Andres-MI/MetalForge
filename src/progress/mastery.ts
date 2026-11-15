/**
 * Mastery per itemId with spaced repetition. Pure: time is always passed in (milliseconds), nothing here
 * reads the clock and nothing touches storage (the profile layer saves `toJSON(...)`).
 *
 * Model: each item has a `strength` (0..1, measured at `lastSeen`) and a `stability` (half-life in days).
 * Strength decays with time as strength * 0.5^(days / stability). A success raises strength and grows
 * stability (the longer an item has been remembered, the slower it fades); a failure cuts both.
 */
import type { TargetResult } from '../model/exercise';

export const DAY_MS = 86_400_000;

export interface ItemState {
  strength: number;
  /** Half-life in days. */
  stability: number;
  lastSeen: number;
  seen: number;
  hits: number;
  misses: number;
}

export interface Mastery {
  items: Record<string, ItemState>;
}

export interface MasteryJSON {
  version: 1;
  items: Record<string, ItemState>;
}

const START_STABILITY = 0.5;
const MIN_STABILITY = 0.25;
const MAX_STABILITY = 90;

export function emptyMastery(): Mastery {
  return { items: {} };
}

export function currentStrength(item: ItemState | undefined, now: number): number {
  if (!item) return 0;
  const days = Math.max(0, now - item.lastSeen) / DAY_MS;
  return item.strength * Math.pow(0.5, days / item.stability);
}

/** Result with optional `wrongAttempts` (a ScoredTarget from the Judge works as is). */
export type ResultLike = TargetResult & { wrongAttempts?: number };

function weightOf(r: ResultLike): number {
  switch (r.judgement) {
    case 'hit':
      return (r.wrongAttempts ?? 0) > 0 ? 0.3 : 1;
    case 'early':
    case 'late':
      return (r.wrongAttempts ?? 0) > 0 ? 0.2 : 0.6;
    default:
      return 0;
  }
}

function applyOne(prev: ItemState | undefined, r: ResultLike, now: number): ItemState {
  const base: ItemState = prev ?? { strength: 0, stability: START_STABILITY, lastSeen: now, seen: 0, hits: 0, misses: 0 };
  const cur = currentStrength(base, now);
  const w = weightOf(r);
  if (w > 0) {
    return {
      strength: cur + (1 - cur) * 0.35 * w,
      stability: Math.min(MAX_STABILITY, base.stability * (1 + 0.8 * w)),
      lastSeen: now,
      seen: base.seen + 1,
      hits: base.hits + 1,
      misses: base.misses,
    };
  }
  return {
    strength: cur * 0.55,
    stability: Math.max(MIN_STABILITY, base.stability * 0.6),
    lastSeen: now,
    seen: base.seen + 1,
    hits: base.hits,
    misses: base.misses + 1,
  };
}

/** Returns a new Mastery with the round's results applied in order. */
export function updateMastery(m: Mastery, results: ResultLike[], now: number): Mastery {
  const items = { ...m.items };
  for (const r of results) items[r.itemId] = applyOne(items[r.itemId], r, now);
  return { items };
}

export interface ReviewOptions {
  /** Also consider these ids even if never seen (they count as strength 0). Default: only seen items. */
  candidates?: string[];
  /** Only items whose current strength is below this are worth reviewing. Default 0.85. */
  threshold?: number;
  /** Only ids starting with this prefix, e.g. "frets:". */
  prefix?: string;
}

/** The `n` items most in need of review: weakest current strength first, then least recently seen. */
export function pickForReview(m: Mastery, now: number, n: number, opts: ReviewOptions = {}): string[] {
  const threshold = opts.threshold ?? 0.85;
  const ids = new Set<string>(opts.candidates ?? Object.keys(m.items));
  if (opts.candidates) for (const id of Object.keys(m.items)) if (opts.candidates.includes(id)) ids.add(id);
  return [...ids]
    .filter((id) => !opts.prefix || id.startsWith(opts.prefix))
    .map((id) => ({ id, s: currentStrength(m.items[id], now), seen: m.items[id]?.lastSeen ?? -Infinity }))
    .filter((x) => x.s < threshold)
    .sort((a, b) => a.s - b.s || a.seen - b.seen || (a.id < b.id ? -1 : 1))
    .slice(0, n)
    .map((x) => x.id);
}

/** Mean current strength of a group of items (unseen ones count as 0), e.g. a whole module. */
export function groupStrength(m: Mastery, ids: string[], now: number): number {
  if (!ids.length) return 0;
  return ids.reduce((s, id) => s + currentStrength(m.items[id], now), 0) / ids.length;
}

export function toJSON(m: Mastery): MasteryJSON {
  return { version: 1, items: JSON.parse(JSON.stringify(m.items)) as Record<string, ItemState> };
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Tolerant reader: anything unusable becomes an empty mastery, bad fields fall back to safe values. */
export function fromJSON(data: unknown): Mastery {
  const items: Record<string, ItemState> = {};
  const raw = data && typeof data === 'object' ? (data as { items?: unknown }).items : undefined;
  if (raw && typeof raw === 'object') {
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const o = v as Record<string, unknown>;
      items[id] = {
        strength: Math.min(1, Math.max(0, num(o.strength, 0))),
        stability: Math.min(MAX_STABILITY, Math.max(MIN_STABILITY, num(o.stability, START_STABILITY))),
        lastSeen: num(o.lastSeen, 0),
        seen: Math.max(0, num(o.seen, 0)),
        hits: Math.max(0, num(o.hits, 0)),
        misses: Math.max(0, num(o.misses, 0)),
      };
    }
  }
  return { items };
}
