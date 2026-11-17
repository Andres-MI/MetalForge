/**
 * What the course stores in the instrument's progress blob, next to `mastery` and `arcadeBest` (which belong to
 * src/game/progressBlob.ts). All of it is optional: an old blob without these keys reads as "nothing yet".
 *
 *   levels:  { "salto:3": { stars: 2, plays: 4, at: 1712345678901 } }   best stars per game+level
 *   course:  { placement?, manual: string[], steps: { "rhythm:boss": { stars, at } }, tuner?: true, review?: {...} }
 *   turbo:   { "salto": [ { score, rounds, startLevel, level, at } ] }  top records per arcade
 *
 * Every writer is pure: it takes the blob and returns a new one with the other keys untouched.
 */

export interface LevelRecord {
  stars: number;
  plays: number;
  at: number;
}

export interface Placement {
  at: number;
  /** True when the player chose to start from zero (nothing was tested). */
  skipped: boolean;
  /** Highest level passed per skill id (0 = failed the easy probe). Only the skills that were tested. */
  skills: Record<string, number>;
}

export interface StepRecord {
  stars: number;
  at: number;
}

export interface CourseBlob {
  /** The arcade records from before the course existed were turned into level records (see `migrateLegacy`). */
  migrated?: boolean;
  placement?: Placement;
  /** Module ids opened by hand from the settings. */
  manual: string[];
  /** Module step records ("rhythm:review", "rhythm:boss"). */
  steps: Record<string, StepRecord>;
  tuner: boolean;
  /** Daily review: when it was last finished and how many times. */
  review?: { lastAt: number; count: number };
}

export interface TurboRecord {
  score: number;
  /** Rounds survived. */
  rounds: number;
  startLevel: number;
  /** Level of the last round survived. */
  level: number;
  at: number;
}

export const TURBO_TABLE_SIZE = 5;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function clone(blob: unknown): Record<string, unknown> {
  return isObj(blob) ? { ...blob } : {};
}

// ---- levels -----------------------------------------------------------------------------------------------

export const levelKey = (gameId: string, level: number): string => `${gameId}:${level}`;

export function readLevels(blob: unknown): Record<string, LevelRecord> {
  const raw = isObj(blob) && isObj(blob.levels) ? blob.levels : {};
  const out: Record<string, LevelRecord> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!isObj(v)) continue;
    const stars = num(v.stars);
    if (stars === null) continue;
    out[k] = { stars: Math.min(3, Math.max(0, Math.round(stars))), plays: Math.max(0, Math.round(num(v.plays) ?? 1)), at: num(v.at) ?? 0 };
  }
  return out;
}

export function readLevel(blob: unknown, gameId: string, level: number): LevelRecord | null {
  return readLevels(blob)[levelKey(gameId, level)] ?? null;
}

/** Stores the stars of a finished round (keeps the best) and counts the play. */
export function writeLevel(blob: unknown, gameId: string, level: number, stars: number, now: number): Record<string, unknown> {
  const base = clone(blob);
  const levels = isObj(base.levels) ? { ...base.levels } : {};
  const prev = readLevel(base, gameId, level);
  levels[levelKey(gameId, level)] = { stars: Math.max(prev?.stars ?? 0, Math.min(3, Math.max(0, Math.round(stars)))), plays: (prev?.plays ?? 0) + 1, at: now };
  base.levels = levels;
  return base;
}

// ---- course -----------------------------------------------------------------------------------------------

export function emptyCourse(): CourseBlob {
  return { manual: [], steps: {}, tuner: false };
}

export function readCourse(blob: unknown): CourseBlob {
  const raw = isObj(blob) && isObj(blob.course) ? blob.course : {};
  const out = emptyCourse();
  if (Array.isArray(raw.manual)) out.manual = raw.manual.filter((x): x is string => typeof x === 'string');
  if (isObj(raw.steps)) {
    for (const [k, v] of Object.entries(raw.steps)) {
      if (isObj(v) && num(v.stars) !== null) out.steps[k] = { stars: num(v.stars)!, at: num(v.at) ?? 0 };
    }
  }
  out.tuner = raw.tuner === true;
  if (raw.migrated === true) out.migrated = true;
  if (isObj(raw.placement)) {
    const p = raw.placement;
    const skills: Record<string, number> = {};
    if (isObj(p.skills)) for (const [k, v] of Object.entries(p.skills)) if (num(v) !== null) skills[k] = Math.max(0, Math.min(10, Math.round(num(v)!)));
    out.placement = { at: num(p.at) ?? 0, skipped: p.skipped === true, skills };
  }
  if (isObj(raw.review) && num(raw.review.lastAt) !== null) out.review = { lastAt: num(raw.review.lastAt)!, count: Math.max(0, Math.round(num(raw.review.count) ?? 1)) };
  return out;
}

export function writeCourse(blob: unknown, patch: (c: CourseBlob) => CourseBlob): Record<string, unknown> {
  const base = clone(blob);
  base.course = patch(readCourse(base));
  return base;
}

export const setPlacement = (blob: unknown, placement: Placement): Record<string, unknown> => writeCourse(blob, (c) => ({ ...c, placement }));
export const markTuner = (blob: unknown): Record<string, unknown> => writeCourse(blob, (c) => ({ ...c, tuner: true }));
export const setManual = (blob: unknown, moduleId: string, on: boolean): Record<string, unknown> =>
  writeCourse(blob, (c) => ({ ...c, manual: on ? [...new Set([...c.manual, moduleId])] : c.manual.filter((m) => m !== moduleId) }));

/** Stores a module step result (review or boss), keeping the best stars. */
export function writeStep(blob: unknown, key: string, stars: number, now: number): Record<string, unknown> {
  return writeCourse(blob, (c) => ({ ...c, steps: { ...c.steps, [key]: { stars: Math.max(c.steps[key]?.stars ?? 0, stars), at: now } } }));
}

export function markReviewDone(blob: unknown, now: number): Record<string, unknown> {
  return writeCourse(blob, (c) => ({ ...c, review: { lastAt: now, count: (c.review?.count ?? 0) + 1 } }));
}

// ---- turbo ------------------------------------------------------------------------------------------------

export function readTurbo(blob: unknown, gameId: string): TurboRecord[] {
  const all = isObj(blob) && isObj(blob.turbo) ? blob.turbo : {};
  const list = Array.isArray(all[gameId]) ? (all[gameId] as unknown[]) : [];
  const out: TurboRecord[] = [];
  for (const v of list) {
    if (!isObj(v)) continue;
    const score = num(v.score);
    const rounds = num(v.rounds);
    if (score === null || rounds === null) continue;
    out.push({ score, rounds, startLevel: num(v.startLevel) ?? 1, level: num(v.level) ?? 1, at: num(v.at) ?? 0 });
  }
  return rank(out);
}

function rank(list: TurboRecord[]): TurboRecord[] {
  return [...list].sort((a, b) => b.score - a.score || b.rounds - a.rounds || a.at - b.at).slice(0, TURBO_TABLE_SIZE);
}

/** Adds a finished Turbo run to the table of an arcade; `rank` is its place (0 = best) or -1 when it did not enter. */
export function writeTurbo(blob: unknown, gameId: string, run: TurboRecord): { blob: Record<string, unknown>; rank: number } {
  const base = clone(blob);
  if (run.score <= 0) return { blob: base, rank: -1 };
  const before = readTurbo(base, gameId);
  const after = rank([...before, run]);
  const place = after.indexOf(run);
  const all = isObj(base.turbo) ? { ...base.turbo } : {};
  all[gameId] = after;
  base.turbo = all;
  return { blob: base, rank: place };
}

// ---- profiles from before the course --------------------------------------------------------------------------

/**
 * One-time migration, done the first time the course reads a profile: every arcade record of the old blob
 * (`arcadeBest["salto:3"]` with points) becomes a level record with two stars, so a player who got that far keeps
 * the modules it opens. After it, `course.migrated` is set and arcade records no longer count by themselves
 * (a new arcade run saves its record BEFORE its stars, which would otherwise open modules too early).
 */
export function migrateLegacy(blob: unknown): { blob: Record<string, unknown>; changed: boolean } {
  const base = clone(blob);
  if (readCourse(base).migrated) return { blob: base, changed: false };
  const levels = isObj(base.levels) ? { ...base.levels } : {};
  const best = isObj(base.arcadeBest) ? base.arcadeBest : {};
  for (const [k, v] of Object.entries(best)) {
    if (isObj(v) && (num(v.score) ?? 0) > 0 && !(k in levels)) levels[k] = { stars: 2, plays: 1, at: 0 };
  }
  if (Object.keys(levels).length) base.levels = levels;
  return { blob: writeCourse(base, (c) => ({ ...c, migrated: true })), changed: true };
}
