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
