/**
 * The per-instrument progress blob in the profile is opaque to `src/profile`. Games own the key
 * `mastery` inside it (a `MasteryJSON`); other keys are preserved untouched so later features can add theirs.
 */
import type { InstrumentId } from '../model/instrument';
import { emptyMastery, fromJSON, toJSON, type Mastery } from '../progress';
import type { ProfileStore } from '../profile/store';

export function readMastery(blob: unknown): Mastery {
  const m = blob && typeof blob === 'object' ? (blob as { mastery?: unknown }).mastery : undefined;
  return m ? fromJSON(m) : emptyMastery();
}

export function writeMastery(blob: unknown, mastery: Mastery): Record<string, unknown> {
  const base = blob && typeof blob === 'object' ? { ...(blob as Record<string, unknown>) } : {};
  base.mastery = toJSON(mastery);
  return base;
}

/** Where a session loads and saves mastery. */
export interface MasteryStore {
  load(): Promise<Mastery>;
  save(m: Mastery): Promise<void>;
}

export function profileMasteryStore(store: ProfileStore, instrument: InstrumentId): MasteryStore {
  return {
    async load() {
      return readMastery(await store.getProgress(instrument));
    },
    async save(m) {
      await store.saveProgress(instrument, writeMastery(await store.getProgress(instrument), m));
    },
  };
}

/** Best arcade run per game+level, under the key `arcadeBest` of the same blob: `{ "salto:3": { score, bestCombo } }`. */
export interface ArcadeBest {
  score: number;
  bestCombo: number;
}

const bestKey = (gameId: string, level: number) => `${gameId}:${level}`;

export function readBest(blob: unknown, gameId: string, level: number): ArcadeBest | null {
  const all = blob && typeof blob === 'object' ? (blob as { arcadeBest?: unknown }).arcadeBest : undefined;
  const e = all && typeof all === 'object' ? (all as Record<string, unknown>)[bestKey(gameId, level)] : undefined;
  if (!e || typeof e !== 'object') return null;
  const { score, bestCombo } = e as Record<string, unknown>;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return { score, bestCombo: typeof bestCombo === 'number' && Number.isFinite(bestCombo) ? bestCombo : 0 };
}

/** Returns the blob with the run stored if it beats the stored score (other keys untouched), and what was there. */
export function writeBest(blob: unknown, gameId: string, level: number, run: ArcadeBest): { blob: Record<string, unknown>; previousBest: number; newBest: boolean } {
  const base = blob && typeof blob === 'object' ? { ...(blob as Record<string, unknown>) } : {};
  const previous = readBest(base, gameId, level);
  const previousBest = previous?.score ?? 0;
  const newBest = run.score > previousBest;
  if (newBest) {
    const all = base.arcadeBest && typeof base.arcadeBest === 'object' ? { ...(base.arcadeBest as Record<string, unknown>) } : {};
    all[bestKey(gameId, level)] = { score: run.score, bestCombo: run.bestCombo };
    base.arcadeBest = all;
  }
  return { blob: base, previousBest, newBest };
}

/** Stores the run in the instrument's progress blob when it is a new best. */
export async function saveArcadeBest(store: ProfileStore, instrument: InstrumentId, gameId: string, level: number, run: ArcadeBest): Promise<{ previousBest: number; newBest: boolean }> {
  const r = writeBest(await store.getProgress(instrument), gameId, level, run);
  if (r.newBest) await store.saveProgress(instrument, r.blob);
  return { previousBest: r.previousBest, newBest: r.newBest };
}
