/**
 * Course progress DERIVED from what the profile already stores: best stars per game+level (`levels`), the
 * course records (`course`), the arcade records of older profiles (`arcadeBest`) and the placement test.
 * Nothing here keeps state of its own, so an old blob without the new keys just reads as "start of the course".
 *
 * Stars of a level, in order of trust:
 *  - the stored best (`levels`), exact;
 *  - the placement test: levels up to the one passed count as two stars, in the learn and the arcade game;
 *  - a learn level is also met when the arcade of the same skill was cleared with two stars at that level or above.
 */
import { GAMES } from '../game/registry';
import { readBest } from '../game/progressBlob';
import { MAX_LEVEL } from '../exercises/common';
import { readCourse, readLevels, type CourseBlob } from './blob';
import type { BossStep, Course, CourseModule, PlayStep, Step } from './types';

export type UnlockReason = 'start' | 'requires' | 'placement' | 'manual';

export interface StepStatus {
  /** "rhythm:learn". */
  key: string;
  id: Step['id'];
  kind: Step['kind'];
  label: string;
  done: boolean;
  /** Can be started from the course screen. */
  open: boolean;
  /** 0..1: how much of the step is done (goals met / goals). */
  progress: number;
  /** Learn and practice: the level to play next (first goal not met, or the last one). */
  level?: number;
  game?: string;
}

export interface ModuleStatus {
  module: CourseModule;
  unlocked: boolean;
  reason: UnlockReason | null;
  /** Boss passed (or, for Preparación, tuned and calibrated). */
  complete: boolean;
  /** The practice step is done: this is what opens the next module. */
  practiceDone: boolean;
  steps: StepStatus[];
  /** 0..1 over the steps. */
  progress: number;
}

export interface NextStep {
  moduleId: string;
  stepId: Step['id'];
  /** "Ritmo · Practicar". */
  label: string;
  level?: number;
  game?: string;
}

export interface CourseState {
  course: Course;
  modules: ModuleStatus[];
  /** Ids of the modules that are open, in course order. */
  unlocked: string[];
  next: NextStep | null;
}

export interface CourseContext {
  /** The latency was measured (settings.latencyOffset is set). */
  calibrated: boolean;
  /** Development and test flag: every module counts as opened by hand. */
  open?: boolean;
}

const STEP_LABEL: Record<string, string> = { learn: 'Aprender', practice: 'Practicar', review: 'Repasar', boss: 'Jefe' };

/** Stars the profile credits at a level of a game (0 = nothing). */
export function starsAt(blob: unknown, gameId: string, level: number): number {
  const def = GAMES[gameId];
  if (!def) return 0;
  const stored = readLevels(blob)[`${gameId}:${level}`]?.stars ?? 0;
  const placed = readCourse(blob).placement?.skills[def.skill] ?? 0;
  const virtual = level <= placed ? 2 : 0;
  return Math.max(stored, virtual);
}

function goalsMet(blob: unknown, step: PlayStep): number {
  const arcade = Object.values(GAMES).find((g) => g.skill === GAMES[step.game]?.skill && g.mode === 'practice');
  let met = 0;
  for (const goal of step.goals) {
    let ok = starsAt(blob, step.game, goal.level) >= goal.minStars;
    if (!ok && step.kind === 'learn' && arcade) for (let l = goal.level; l <= MAX_LEVEL && !ok; l++) ok = starsAt(blob, arcade.id, l) >= 2;
    if (ok) met++;
  }
  return met;
}

function firstUnmetLevel(blob: unknown, step: PlayStep): number {
  const arcade = Object.values(GAMES).find((g) => g.skill === GAMES[step.game]?.skill && g.mode === 'practice');
  for (const goal of step.goals) {
    let ok = starsAt(blob, step.game, goal.level) >= goal.minStars;
    if (!ok && step.kind === 'learn' && arcade) for (let l = goal.level; l <= MAX_LEVEL && !ok; l++) ok = starsAt(blob, arcade.id, l) >= 2;
    if (!ok) return goal.level;
  }
  return step.goals[step.goals.length - 1].level;
}

function playedSkill(blob: unknown, mod: CourseModule): boolean {
  const levels = readLevels(blob);
  return Object.keys(levels).some((k) => GAMES[k.split(':')[0]]?.skill === mod.skill);
}

export function deriveCourse(course: Course, blob: unknown, ctx: CourseContext): CourseState {
  const rec: CourseBlob = readCourse(blob);
  const practiceDone = new Map<string, boolean>();
  for (const m of course.modules) {
    const p = m.steps.find((s): s is PlayStep => s.kind === 'practice');
    practiceDone.set(m.id, !!p && goalsMet(blob, p) === p.goals.length);
  }

  const fresh = !rec.tuner && Object.keys(readLevels(blob)).length === 0;
  const modules: ModuleStatus[] = course.modules.map((m) => {
    let reason: UnlockReason | null = null;
    if (m.requires.length === 0) reason = 'start';
    else if (m.requires.every((r) => practiceDone.get(r))) reason = 'requires';
    else if (m.skill && (rec.placement?.skills[m.skill] ?? 0) >= 1) reason = 'placement';
    else if (rec.manual.includes(m.id) || ctx.open) reason = 'manual';
    const unlocked = reason !== null;

    const steps: StepStatus[] = m.steps.map((s): StepStatus => {
      const key = `${m.id}:${s.id}`;
      if (s.kind === 'tool') {
        const done = s.id === 'tuner' ? rec.tuner : ctx.calibrated;
        return { key, id: s.id, kind: s.kind, label: s.label, done, open: true, progress: done ? 1 : 0 };
      }
      if (s.kind === 'learn' || s.kind === 'practice') {
        const met = goalsMet(blob, s);
        return { key, id: s.id, kind: s.kind, label: STEP_LABEL[s.id], done: met === s.goals.length, open: unlocked, progress: met / s.goals.length, level: firstUnmetLevel(blob, s), game: s.game };
      }
      if (s.kind === 'review') {
        const done = (rec.steps[key]?.stars ?? 0) >= s.minStars;
        const anyPlay = playedSkill(blob, m) || (m.skill !== null && (rec.placement?.skills[m.skill] ?? 0) > 0);
        return { key, id: s.id, kind: s.kind, label: STEP_LABEL.review, done, open: unlocked && anyPlay, progress: done ? 1 : 0 };
      }
      const done = (rec.steps[key]?.stars ?? 0) >= (s as BossStep).passStars;
      return { key, id: s.id, kind: s.kind, label: STEP_LABEL.boss, done, open: unlocked && !!practiceDone.get(m.id), progress: done ? 1 : 0 };
    });
    const complete = m.skill === null ? steps.every((s) => s.done) : !!steps.find((s) => s.id === 'boss')?.done;
    return { module: m, unlocked, reason, complete, practiceDone: !!practiceDone.get(m.id), steps, progress: steps.reduce((a, s) => a + s.progress, 0) / steps.length };
  });

  let next: NextStep | null = null;
  for (const ms of modules) {
    if (!ms.unlocked || ms.complete) continue;
    if (ms.module.skill === null && !fresh) continue;
    const st = ms.steps.find((s) => !s.done && s.open);
    if (!st) continue;
    next = { moduleId: ms.module.id, stepId: st.id, label: `${ms.module.title} · ${st.label}`, level: st.level, game: st.game };
    break;
  }
  return { course, modules, unlocked: modules.filter((m) => m.unlocked).map((m) => m.module.id), next };
}

/** Modules that are open in `after` and were not in `before` (what a result just unlocked). */
export function newlyUnlocked(before: CourseState, after: CourseState): CourseModule[] {
  return after.modules.filter((m) => m.unlocked && !before.unlocked.includes(m.module.id)).map((m) => m.module);
}

/** Modules whose boss was passed in `after` but not in `before`. */
export function newlyCompleted(before: CourseState, after: CourseState): CourseModule[] {
  return after.modules.filter((m) => m.complete && !before.modules.find((b) => b.module.id === m.module.id)?.complete).map((m) => m.module);
}

/** The skills of the open modules (what review and Turbo may draw from). */
export function unlockedSkills(state: CourseState): NonNullable<CourseModule['skill']>[] {
  return state.modules.filter((m) => m.unlocked && m.module.skill !== null).map((m) => m.module.skill!);
}

/** Highest level with stars in a game (0 = never played), counting placement credit. */
export function highestCleared(blob: unknown, gameId: string): number {
  let best = 0;
  for (let l = 1; l <= MAX_LEVEL; l++) if (starsAt(blob, gameId, l) >= 1) best = l;
  return best;
}

export interface GameBest {
  /** Highest level played, with its best stars. */
  level: number;
  stars: number;
  /** Best arcade score at that level (null for learn games or when none). */
  score: number | null;
}

/** What the hub shows for a game: the highest level played (stored records only) and its best stars and points. */
export function bestFor(blob: unknown, gameId: string): GameBest | null {
  const levels = readLevels(blob);
  let best: GameBest | null = null;
  for (let l = 1; l <= MAX_LEVEL; l++) {
    const rec = levels[`${gameId}:${l}`];
    const score = readBest(blob, gameId, l)?.score ?? null;
    if (!rec && score === null) continue;
    best = { level: l, stars: rec?.stars ?? 0, score };
  }
  return best;
}
