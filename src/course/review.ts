/**
 * Daily review ("Repaso de hoy") and the module review step: pure planning, the clock is always passed in.
 *
 * How it picks, in order:
 *  1. Items: `pickForReview` (src/progress) over the mastery of each open skill: the weakest CURRENT strength first
 *     (strength fades with time, so "most forgotten" and "weakest" are the same ranking), below a 0.85 threshold.
 *  2. Rounds: one round per skill, most urgent skill first (sum of 1 - strength of its picked items); when there are
 *     fewer rounds than `minRounds`, the skills with items left over get a second round with the leftovers.
 *     Never more than `maxRounds`, and rounds stop being added once the estimated time passes `budgetSeconds`.
 *  3. Game: items that are still weak (mean strength under 0.5) go to the sober LEARN game of their skill
 *     (no clock, no punishment); items that are fairly strong go to the ARCADE (pressure keeps them sharp).
 *  4. Exercise: the generators cannot target items, so for each round every (level, seed) the player may play is
 *     generated (levels 1..cap, seeds 1..SEEDS) and the one containing the most of the chosen itemIds wins
 *     (ties: lower level, then lower seed). The scene then launches that level with that seed.
 */
import { generate } from '../exercises';
import { GAMES } from '../game/registry';
import { currentStrength, pickForReview, type Mastery } from '../progress';
import type { InstrumentId } from '../model/instrument';
import type { SkillId } from '../model/exercise';
import type { GameDef } from '../game/types';

export const REVIEW_THRESHOLD = 0.85;
export const SEEDS = 16;
const ITEMS_PER_ROUND = 8;
/** Estimated seconds a round of each game takes (learn rounds are shorter than arcade runs). */
export const ROUND_SECONDS: Record<string, number> = {
  pulso: 60, salto: 110, fireflies: 60, ninja: 100, telar: 60, portero: 100, forge: 70, wizard: 100, climb: 90, tower: 150,
};

export interface ReviewRound {
  skill: SkillId;
  gameId: string;
  mode: 'learn' | 'practice';
  level: number;
  seed: number;
  /** The weak items this round was built for, and how many of them its exercise really contains. */
  items: string[];
  covered: number;
  /** Mean current strength of `items` when planned. */
  strength: number;
  seconds: number;
}

export interface ReviewPlan {
  rounds: ReviewRound[];
  seconds: number;
  /** Items below the threshold across the open skills (before limits). */
  due: number;
}

export interface ReviewOptions {
  now: number;
  instrument: InstrumentId;
  mastery: Mastery;
  /** Skills the player has open. */
  skills: SkillId[];
  /** Highest level the player may be given per skill (default 2). */
  levelCap?: Partial<Record<SkillId, number>>;
  maxRounds?: number;
  minRounds?: number;
  budgetSeconds?: number;
  /** Module review: a skill that must have a round even when nothing is weak, played at `level` with the learn game. */
  must?: { skill: SkillId; level: number };
  /** Learn at or under this mean strength, arcade above it. */
  learnBelow?: number;
}

const gameOf = (skill: SkillId, mode: 'learn' | 'practice'): GameDef | undefined => Object.values(GAMES).find((g) => g.skill === skill && g.mode === mode && g.scene);

export function skillOfItem(id: string): SkillId | null {
  const p = id.split(':')[0];
  return Object.values(GAMES).some((g) => g.skill === p) ? (p as SkillId) : null;
}

/** The (level, seed) up to `cap` whose exercise contains the most of `items`. */
export function bestExercise(skill: SkillId, instrument: InstrumentId, items: string[], cap: number, length: number): { level: number; seed: number; covered: number } {
  const want = new Set(items);
  let best = { level: Math.max(1, Math.min(cap, 1)), seed: 1, covered: -1 };
  for (let level = 1; level <= cap; level++) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ex = generate(skill, { instrument, level, seed, length });
      const got = new Set<string>();
      for (const t of ex.targets) if (want.has(t.itemId)) got.add(t.itemId);
      if (got.size > best.covered) best = { level, seed, covered: got.size };
    }
  }
  return best;
}

export function planReview(o: ReviewOptions): ReviewPlan {
  const maxRounds = o.maxRounds ?? 5;
  const minRounds = Math.min(maxRounds, o.minRounds ?? 3);
  const budget = o.budgetSeconds ?? 600;
  const learnBelow = o.learnBelow ?? 0.5;
  const cap = (s: SkillId) => Math.max(1, Math.min(10, o.levelCap?.[s] ?? 2));

  interface Pool { skill: SkillId; items: string[]; urgency: number }
  const pools: Pool[] = [];
  let due = 0;
  for (const skill of o.skills) {
    const all = pickForReview(o.mastery, o.now, 1000, { prefix: `${skill}:`, threshold: REVIEW_THRESHOLD });
    due += all.length;
    if (all.length) pools.push({ skill, items: all, urgency: all.slice(0, ITEMS_PER_ROUND * 2).reduce((s, id) => s + 1 - currentStrength(o.mastery.items[id], o.now), 0) });
  }
  pools.sort((a, b) => b.urgency - a.urgency || (a.skill < b.skill ? -1 : 1));

  const rounds: ReviewRound[] = [];
  let seconds = 0;
  const add = (skill: SkillId, items: string[], forceLearnLevel?: number): boolean => {
    const strength = items.length ? items.reduce((s, id) => s + currentStrength(o.mastery.items[id], o.now), 0) / items.length : 0;
    const mode: 'learn' | 'practice' = forceLearnLevel !== undefined || strength < learnBelow ? 'learn' : 'practice';
    const def = gameOf(skill, mode) ?? gameOf(skill, mode === 'learn' ? 'practice' : 'learn');
    if (!def) return false;
    const secs = ROUND_SECONDS[def.id] ?? 90;
    if (rounds.length > 0 && seconds + secs > budget) return false;
    let level = forceLearnLevel ?? 1;
    let seed = 1;
    let covered = 0;
    if (items.length) ({ level, seed, covered } = bestExercise(skill, o.instrument, items, cap(skill), def.length));
    rounds.push({ skill, gameId: def.id, mode: def.mode, level, seed, items, covered, strength, seconds: secs });
    seconds += secs;
    return true;
  };

  // The module review's own skill goes first even when nothing is weak.
  if (o.must) {
    const own = pools.find((p) => p.skill === o.must!.skill);
    if (own) add(own.skill, own.items.slice(0, ITEMS_PER_ROUND));
    else add(o.must.skill, [], o.must.level);
  }
  const taken = new Map<SkillId, number>();
  if (o.must && rounds.length) taken.set(o.must.skill, rounds[0].items.length);
  for (const p of pools) {
    if (rounds.length >= maxRounds) break;
    if (taken.has(p.skill)) continue;
    if (!add(p.skill, p.items.slice(0, ITEMS_PER_ROUND))) break;
    taken.set(p.skill, Math.min(p.items.length, ITEMS_PER_ROUND));
  }
  // Too few rounds: the skills with items left get another round with them (repeat until `minRounds`).
  for (let pass = 0; pass < 4 && rounds.length < minRounds && rounds.length < maxRounds; pass++) {
    let added = false;
    for (const p of pools) {
      if (rounds.length >= minRounds || rounds.length >= maxRounds) break;
      const used = taken.get(p.skill) ?? 0;
      const left = p.items.slice(used, used + ITEMS_PER_ROUND);
      if (left.length === 0) continue;
      if (add(p.skill, left)) {
        taken.set(p.skill, used + left.length);
        added = true;
      }
    }
    if (!added) break;
  }
  return { rounds, seconds, due };
}

export interface ReviewSummary {
  items: number;
  improved: number;
  meanBefore: number;
  meanAfter: number;
  bySkill: { skill: string; before: number; after: number }[];
}

/** What a finished review changed: the same items before and after, at the same moment. */
export function summarizeReview(before: Mastery, after: Mastery, items: string[], now: number): ReviewSummary {
  const ids = [...new Set(items)];
  const per = ids.map((id) => ({ id, b: currentStrength(before.items[id], now), a: currentStrength(after.items[id], now) }));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const skills = [...new Set(ids.map((i) => i.split(':')[0]))];
  return {
    items: ids.length,
    improved: per.filter((p) => p.a > p.b + 0.01).length,
    meanBefore: mean(per.map((p) => p.b)),
    meanAfter: mean(per.map((p) => p.a)),
    bySkill: skills.map((s) => ({ skill: s, before: mean(per.filter((p) => p.id.startsWith(`${s}:`)).map((p) => p.b)), after: mean(per.filter((p) => p.id.startsWith(`${s}:`)).map((p) => p.a)) })),
  };
}

/** Skills with items that are due, for the hub's blinking cabinets: `count` weak items per skill. */
export function dueBySkill(mastery: Mastery, now: number, skills: SkillId[]): Partial<Record<SkillId, number>> {
  const out: Partial<Record<SkillId, number>> = {};
  for (const s of skills) {
    const n = pickForReview(mastery, now, 1000, { prefix: `${s}:`, threshold: DUE_THRESHOLD }).length;
    if (n > 0) out[s] = n;
  }
  return out;
}

/** An item blinks the hub when its current strength falls under this (it was known once and is fading). */
export const DUE_THRESHOLD = 0.5;
