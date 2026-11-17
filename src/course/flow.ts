/**
 * Flows: a sequence of existing games played back to back with a bridge screen between phases. Pure state; the
 * `flow` scene shows it and the results scene feeds it (see docs/JUEGOS.md, "Flujos").
 *
 *  - boss:   the fixed phases of a module's Jefe step; passed with the mean stars of its phases.
 *  - review: the rounds of a review plan (daily or module); the mean stars say how it went.
 *  - turbo:  an arcade at a rising level; every round is the next level (10 and then 10 again, the arcade's own
 *            adaptive pace tightens inside the round). The first round under two stars ends the run. This is the
 *            least invasive way to "tighten each round": no arcade scene knows Turbo exists.
 */
import { MAX_LEVEL } from '../exercises/common';
import { GAMES } from '../game/registry';
import type { PaletteKey } from '../ui/palette';
import type { TurboRecord } from './blob';
import type { BossStep, CourseModule } from './types';
import type { ReviewPlan } from './review';

export type FlowKind = 'boss' | 'review' | 'turbo';

export interface FlowPhase {
  gameId: string;
  level: number;
  seed?: number;
  /** Line under the phase name on the bridge screen. */
  note?: string;
}

export interface PhaseOutcome {
  gameId: string;
  level: number;
  stars: number;
  accuracy: number;
  /** Arcade points (null in learn games). */
  score: number | null;
}

export interface Flow {
  kind: FlowKind;
  /** "rhythm:boss", "daily", "rhythm:review", "turbo:salto". */
  id: string;
  title: string;
  accent: PaletteKey;
  moduleId?: string;
  phases: FlowPhase[];
  /** The phase being played (or about to be). */
  index: number;
  outcomes: PhaseOutcome[];
  over: boolean;
  startedAt: number;
  /** Review: every itemId the rounds were built for. */
  items?: string[];
  /** Turbo: the arcade and the level the ladder started at. */
  turbo?: { gameId: string; startLevel: number };
  /** Boss: stars needed. */
  passStars?: number;
}

/** Stars of a round to survive a Turbo round (a two-star round is "clean enough"). */
export const TURBO_SURVIVE_STARS = 2;

export function bossFlow(module: CourseModule, step: BossStep, now: number): Flow {
  return {
    kind: 'boss',
    id: `${module.id}:boss`,
    title: step.title,
    accent: module.accent,
    moduleId: module.id,
    phases: step.phases.map((p, i) => ({ gameId: p.game, level: p.level, note: i === step.phases.length - 1 ? 'Última fase' : undefined })),
    index: 0,
    outcomes: [],
    over: false,
    startedAt: now,
    passStars: step.passStars,
  };
}

export function reviewFlow(plan: ReviewPlan, id: string, title: string, accent: PaletteKey, now: number, moduleId?: string): Flow {
  return {
    kind: 'review',
    id,
    title,
    accent,
    moduleId,
    phases: plan.rounds.map((r) => ({ gameId: r.gameId, level: r.level, seed: r.seed, note: `${r.items.length} elementos flojos` })),
    index: 0,
    outcomes: [],
    over: false,
    startedAt: now,
    items: [...new Set(plan.rounds.flatMap((r) => r.items))],
  };
}

export function turboFlow(gameId: string, startLevel: number, now: number): Flow {
  const def = GAMES[gameId];
  const level = Math.max(1, Math.min(MAX_LEVEL, startLevel));
  return {
    kind: 'turbo',
    id: `turbo:${gameId}`,
    title: `TURBO ${def.title.toUpperCase()}`,
    accent: def.accent,
    phases: [{ gameId, level }],
    index: 0,
    outcomes: [],
    over: false,
    startedAt: now,
    turbo: { gameId, startLevel: level },
  };
}

/** Mean stars of the outcomes so far (0 with none). */
export function meanStars(flow: Flow): number {
  return flow.outcomes.length ? flow.outcomes.reduce((s, o) => s + o.stars, 0) / flow.outcomes.length : 0;
}

export function bossPassed(flow: Flow): boolean {
  return flow.kind === 'boss' && flow.over && meanStars(flow) >= (flow.passStars ?? 2);
}

/** Records the outcome of the phase in play and moves on. Returns a new flow (`over` when nothing is left). */
export function advance(flow: Flow, outcome: PhaseOutcome): Flow {
  const outcomes = [...flow.outcomes, outcome];
  if (flow.kind === 'turbo') {
    const survived = outcome.stars >= TURBO_SURVIVE_STARS;
    if (!survived) return { ...flow, outcomes, over: true };
    const nextLevel = Math.min(MAX_LEVEL, outcome.level + 1);
    return { ...flow, outcomes, phases: [...flow.phases, { gameId: flow.turbo!.gameId, level: nextLevel }], index: flow.index + 1 };
  }
  const index = flow.index + 1;
  return { ...flow, outcomes, index, over: index >= flow.phases.length };
}

/** The Turbo run as a record for the table (rounds survived, points of every round played). */
export function turboRecord(flow: Flow, now: number): TurboRecord {
  const survived = flow.outcomes.filter((o) => o.stars >= TURBO_SURVIVE_STARS);
  return {
    score: flow.outcomes.reduce((s, o) => s + (o.score ?? 0), 0),
    rounds: survived.length,
    startLevel: flow.turbo?.startLevel ?? 1,
    level: survived.length ? survived[survived.length - 1].level : flow.turbo?.startLevel ?? 1,
    at: now,
  };
}

/** Level a Turbo ladder starts at for a player: the highest level cleared (at least 1, at most 9 so there is a climb). */
export function turboStartLevel(highestCleared: number): number {
  return Math.max(1, Math.min(MAX_LEVEL - 1, highestCleared));
}
