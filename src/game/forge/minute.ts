/**
 * Forja's second part at change levels (5-9): "un minuto de cambios". The player alternates between the two chords of
 * the change and counts CLEAN changes in 60 s. Pure: the time is injected (`now`, seconds of the session/input clock).
 *
 * The first accepted chord is the starting position and starts the minute (it is not a change). From then on every
 * accepted chord is a change; it counts as clean when the strum was clean (`CLEAN_THRESHOLD`). A wrong strum counts
 * nothing and the same chord is asked again. The best count per chord pair is kept in the instrument's progress blob
 * under `changeBest` (backwards compatible: older blobs simply have no such key).
 */
import type { Exercise, Target } from '../../model/exercise';
import type { InstrumentId } from '../../model/instrument';
import type { ProfileStore } from '../../profile/store';
import { groupChords } from '../chords/names';

export const MINUTE_SECONDS = 60;
/** The minute round is offered from the first level with changes. */
export const MINUTE_FROM_LEVEL = 5;
/** Alternations generated for the minute round (never reached: 60 s at one change per second would be 60). */
const REPEATS = 40;

export type MinuteEvent = 'start' | 'clean' | 'sloppy';

export class MinuteRound {
  startedAt: number | null = null;
  /** Accepted changes (after the first chord) and the clean ones among them. */
  changes = 0;
  clean = 0;
  wrongs = 0;

  constructor(
    readonly pair: [string, string],
    readonly duration = MINUTE_SECONDS,
  ) {}

  get started(): boolean {
    return this.startedAt !== null;
  }

  /** Seconds left (the full minute before the first chord, 0 when over). */
  remaining(now: number): number {
    return this.startedAt === null ? this.duration : Math.max(0, this.startedAt + this.duration - now);
  }

  over(now: number): boolean {
    return this.startedAt !== null && now >= this.startedAt + this.duration;
  }

  /** The awaited chord was accepted. Returns what it was; after the minute nothing counts (returns null). */
  accept(now: number, clean: boolean): MinuteEvent | null {
    if (this.over(now)) return null;
    if (this.startedAt === null) {
      this.startedAt = now;
      return 'start';
    }
    this.changes++;
    if (clean) this.clean++;
    return clean ? 'clean' : 'sloppy';
  }

  wrong(now: number): void {
    if (this.started && !this.over(now)) this.wrongs++;
  }
}

/** Key of a pair in the best table: order does not matter. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/**
 * The exercise of the minute round: the first two chords of a change level's round, alternated many times (guitar: one
 * chord target each; bass: its note targets). itemIds are "chords:A>B" / "chords:B>A". Null when the round has no two
 * different chords, or for levels without changes (below 5) and the timed one.
 */
export function minuteExercise(base: Exercise, level: number): { exercise: Exercise; pair: [string, string] } | null {
  if (base.timed || level < MINUTE_FROM_LEVEL) return null;
  const groups = groupChords(base);
  if (groups.length < 2 || groups[0].name === groups[1].name) return null;
  const [a, b] = groups;
  const take = (g: typeof a): Target[] => base.targets.slice(g.first, g.first + g.count);
  const ta = take(a);
  const tb = take(b);
  const targets: Target[] = [];
  for (let i = 0; i < REPEATS; i++) {
    for (const [src, from, to] of [[ta, b.name, a.name], [tb, a.name, b.name]] as const) {
      for (const t of src) targets.push({ ...t, beat: undefined, itemId: `chords:${from}>${to}` });
    }
  }
  return { exercise: { ...base, id: `${base.id}:minute`, timed: false, bpm: undefined, targets }, pair: [a.name, b.name] };
}

// ---------- best per pair, in the progress blob ----------

export function readChangeBest(blob: unknown, a: string, b: string): number {
  const all = blob && typeof blob === 'object' ? (blob as { changeBest?: unknown }).changeBest : undefined;
  const v = all && typeof all === 'object' ? (all as Record<string, unknown>)[pairKey(a, b)] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Returns the blob with the count stored when it beats the stored one (other keys untouched), and what was there. */
export function writeChangeBest(blob: unknown, a: string, b: string, count: number): { blob: Record<string, unknown>; previous: number; newBest: boolean } {
  const base = blob && typeof blob === 'object' ? { ...(blob as Record<string, unknown>) } : {};
  const previous = readChangeBest(base, a, b);
  const newBest = count > previous;
  if (newBest) {
    const all = base.changeBest && typeof base.changeBest === 'object' ? { ...(base.changeBest as Record<string, unknown>) } : {};
    all[pairKey(a, b)] = count;
    base.changeBest = all;
  }
  return { blob: base, previous, newBest };
}

/** Stores the count in the instrument's progress blob when it is a new best. */
export async function saveChangeBest(store: ProfileStore, instrument: InstrumentId, a: string, b: string, count: number): Promise<{ previous: number; newBest: boolean }> {
  const r = writeChangeBest(await store.getProgress(instrument), a, b, count);
  if (r.newBest) await store.saveProgress(instrument, r.blob);
  return { previous: r.previous, newBest: r.newBest };
}
