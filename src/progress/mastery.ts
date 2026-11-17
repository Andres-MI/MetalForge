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

/** Weight multiplier when some attempts of the item failed in the same round. */
const FAILED_ROUND_PENALTY = 0.5;
/** Stability only grows when this fraction of the stability has elapsed since the item was last seen. */
/** Fraction of the missing strength one perfect round recovers (it was 0.35 per note when every note counted). */
const ROUND_GAIN = 0.5;
const SPACING_FRACTION = 0.5;
/** Growth factor (instead of 0.8) for a round that comes too soon after the previous one: practice, but barely memory. */
const UNSPACED_GROWTH = 0.1;

/**
 * One update for an item with ALL its results of a round: repetitions inside one round are practice, not spaced
 * review, so they count once, with the mean weight (halved if any attempt failed). A round with only failures
 * cuts strength and stability. Stability grows fully only after enough time (> 0.5 x stability; the very first round
 * always counts) and just a little otherwise, so cramming cannot reach a 90-day half-life.
 */
function applyItem(prev: ItemState | undefined, rs: ResultLike[], now: number): ItemState {
  const base: ItemState = prev ?? { strength: 0, stability: START_STABILITY, lastSeen: now, seen: 0, hits: 0, misses: 0 };
  const cur = currentStrength(base, now);
  const weights = rs.map(weightOf);
  const fails = weights.filter((w) => w === 0).length;
  const mean = weights.reduce((s, w) => s + w, 0) / rs.length;
  const seen = base.seen + rs.length;
  const hits = base.hits + rs.length - fails;
  const misses = base.misses + fails;
  if (mean > 0) {
    const w = fails > 0 ? mean * FAILED_ROUND_PENALTY : mean;
    const elapsedDays = Math.max(0, now - base.lastSeen) / DAY_MS;
    const spaced = base.seen === 0 || elapsedDays > SPACING_FRACTION * base.stability;
    return {
      strength: cur + (1 - cur) * ROUND_GAIN * w,
      stability: Math.min(MAX_STABILITY, base.stability * (1 + (spaced ? 0.8 : UNSPACED_GROWTH) * w)),
      lastSeen: now,
      seen,
      hits,
      misses,
    };
  }
  return {
    strength: cur * 0.55,
    stability: Math.max(MIN_STABILITY, base.stability * 0.6),
    lastSeen: now,
    seen,
    hits,
    misses,
  };
}

/**
 * Returns a new Mastery with the round's results applied: ONE update per itemId (see `applyItem`), in order of
 * first appearance.
 */
export function updateMastery(m: Mastery, results: ResultLike[], now: number): Mastery {
  const items = { ...m.items };
  const groups = new Map<string, ResultLike[]>();
  for (const r of results) {
    const g = groups.get(r.itemId);
    if (g) g.push(r);
    else groups.set(r.itemId, [r]);
  }
  for (const [id, rs] of groups) items[id] = applyItem(items[id], rs, now);
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
