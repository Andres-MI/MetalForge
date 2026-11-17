/** Reads and writes the course data of the profile (no Phaser): the scenes call these. Time is passed in. */
import type { InstrumentId } from '../model/instrument';
import type { ProfileStore } from '../profile/store';
import { readMastery } from '../game/progressBlob';
import type { Mastery } from '../progress';
import { markReviewDone, setManual, setPlacement, markTuner, writeLevel, writeStep, writeTurbo, readTurbo, type Placement, type TurboRecord } from './blob';
import { courseFor } from './data';
import { bossPassed, meanStars, turboRecord, type Flow } from './flow';
import { deriveCourse, newlyCompleted, newlyUnlocked, type CourseState } from './progress';
import type { CourseModule } from './types';

export interface Loaded {
  instrument: InstrumentId;
  blob: unknown;
  state: CourseState;
  mastery: Mastery;
}

const instrumentOf = (store: ProfileStore): InstrumentId => store.profile.instrument ?? 'guitar';

export function derive(store: ProfileStore, blob: unknown): CourseState {
  return deriveCourse(courseFor(instrumentOf(store)), blob, { calibrated: store.profile.settings.latencyOffset !== undefined });
}

export async function load(store: ProfileStore): Promise<Loaded> {
  const instrument = instrumentOf(store);
  const blob = await store.getProgress(instrument);
  return { instrument, blob, state: derive(store, blob), mastery: readMastery(blob) };
}

async function update(store: ProfileStore, fn: (blob: unknown) => Record<string, unknown>): Promise<{ before: CourseState; after: CourseState; blob: Record<string, unknown> }> {
  const instrument = instrumentOf(store);
  const blob = await store.getProgress(instrument);
  const next = fn(blob);
  await store.saveProgress(instrument, next);
  return { before: derive(store, blob), after: derive(store, next), blob: next };
}

export interface Change {
  before: CourseState;
  after: CourseState;
  unlocked: CourseModule[];
  completed: CourseModule[];
}

const withChange = (r: { before: CourseState; after: CourseState }): Change => ({ ...r, unlocked: newlyUnlocked(r.before, r.after), completed: newlyCompleted(r.before, r.after) });

/** Stores the stars of a finished round and says what it opened. */
export async function recordLevel(store: ProfileStore, gameId: string, level: number, stars: number, now: number): Promise<Change> {
  return withChange(await update(store, (b) => writeLevel(b, gameId, level, stars, now)));
}

export async function recordPlacement(store: ProfileStore, placement: Placement): Promise<Change> {
  return withChange(await update(store, (b) => setPlacement(b, placement)));
}

export async function recordTuner(store: ProfileStore): Promise<void> {
  const blob = await store.getProgress(instrumentOf(store));
  if ((blob as { course?: { tuner?: boolean } } | undefined)?.course?.tuner === true) return;
  await update(store, (b) => markTuner(b));
}

export async function setModuleManual(store: ProfileStore, moduleId: string, on: boolean): Promise<void> {
  await update(store, (b) => setManual(b, moduleId, on));
}

/** Stores the result of a finished flow (boss or review step, daily review, Turbo run). */
export async function recordFlow(store: ProfileStore, flow: Flow, now: number): Promise<Change & { rank: number; record: TurboRecord | null }> {
  let rank = -1;
  let record: TurboRecord | null = null;
  const r = await update(store, (b) => {
    if (flow.kind === 'turbo') {
      record = turboRecord(flow, now);
      const w = writeTurbo(b, flow.turbo!.gameId, record);
      rank = w.rank;
      return w.blob;
    }
    const stars = meanStars(flow);
    if (flow.kind === 'boss') return writeStep(b, flow.id, bossPassed(flow) ? stars : Math.min(stars, 1.99), now);
    if (flow.id === 'daily') return markReviewDone(b, now);
    return writeStep(b, flow.id, stars, now);
  });
  return { ...withChange(r), rank, record };
}

export async function turboTable(store: ProfileStore, gameId: string): Promise<TurboRecord[]> {
  return readTurbo(await store.getProgress(instrumentOf(store)), gameId);
}
