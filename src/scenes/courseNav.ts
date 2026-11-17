/**
 * Glue between the course data and the scenes: starting a step of the course, the daily review, a boss or a
 * Turbo run, and feeding a finished round to the flow that is running (see src/course/flow.ts).
 */
import type Phaser from 'phaser';
import type { Flow, PhaseOutcome } from '../course/flow';
import { advance, bossFlow, reviewFlow, turboFlow, turboStartLevel } from '../course/flow';
import { dueBySkill, planReview, type ReviewPlan } from '../course/review';
import { highestCleared, unlockedSkills } from '../course/progress';
import { load, recordFlow, recordLevel } from '../course/service';
import type { BossStep, PlayStep, ReviewStep } from '../course/types';
import { profileStore } from '../engine/kit';
import { launchGame } from '../game/launch';
import { GAMES } from '../game/registry';
import type { ResultsData } from '../game/scene';
import type { SkillId } from '../model/exercise';
import type { Mastery } from '../progress';

export const FLOW_KEY = 'flow';
export const FLOW_BEFORE_KEY = 'flowBefore';
/** Ids of the modules the rounds of the running flow have opened so far. */
export const FLOW_UNLOCKED_KEY = 'flowUnlocked';

export const getFlow = (scene: Phaser.Scene): Flow | undefined => scene.registry.get(FLOW_KEY) as Flow | undefined;
export const clearFlow = (scene: Phaser.Scene): void => {
  scene.registry.remove(FLOW_KEY);
  scene.registry.remove(FLOW_BEFORE_KEY);
  scene.registry.remove(FLOW_UNLOCKED_KEY);
};

/** Puts a flow in the registry and opens its title card. */
export function beginFlow(scene: Phaser.Scene, flow: Flow, before?: Mastery): void {
  scene.registry.set(FLOW_KEY, flow);
  scene.registry.set(FLOW_UNLOCKED_KEY, []);
  if (before) scene.registry.set(FLOW_BEFORE_KEY, before);
  else scene.registry.remove(FLOW_BEFORE_KEY);
  scene.scene.start('flow', { stage: 'intro' });
}

/** The highest level a review may draw from per skill: the highest one the player has played (at least 2), never a step beyond. */
function levelCaps(blob: unknown, skills: SkillId[]): Partial<Record<SkillId, number>> {
  const caps: Partial<Record<SkillId, number>> = {};
  for (const skill of skills) {
    const games = Object.values(GAMES).filter((g) => g.skill === skill);
    caps[skill] = Math.max(2, Math.min(10, Math.max(...games.map((g) => highestCleared(blob, g.id)))));
  }
  return caps;
}

/** The plan of "Repaso de hoy" for the open skills of the player. */
export async function dailyPlan(scene: Phaser.Scene, now = Date.now()): Promise<{ plan: ReviewPlan; mastery: Mastery }> {
  const l = await load(profileStore(scene));
  const skills = unlockedSkills(l.state);
  return { plan: planReview({ now, instrument: l.instrument, mastery: l.mastery, skills, levelCap: levelCaps(l.blob, skills), maxRounds: 5, minRounds: 3, budgetSeconds: 600 }), mastery: l.mastery };
}

/** Starts the daily review. Resolves to false when there is nothing to review (the caller says so). */
export async function startDailyReview(scene: Phaser.Scene): Promise<boolean> {
  const now = Date.now();
  const { plan, mastery } = await dailyPlan(scene, now);
  if (!scene.scene.isActive() || plan.rounds.length === 0) return false;
  beginFlow(scene, reviewFlow(plan, 'daily', 'REPASO DE HOY', 'cyan', now), mastery);
  return true;
}

/** Number of weak items per skill and in total (hub badge). */
export async function dueSummary(scene: Phaser.Scene, now = Date.now()): Promise<{ total: number; bySkill: Partial<Record<SkillId, number>> }> {
  const l = await load(profileStore(scene));
  const skills = unlockedSkills(l.state);
  const bySkill = dueBySkill(l.mastery, now, skills);
  return { total: Object.values(bySkill).reduce((s, n) => s + (n ?? 0), 0), bySkill };
}

/** Opens a step of a module: tool, game level, module review or boss. Returns an error message to show, or null. */
export async function startStep(scene: Phaser.Scene, moduleId: string, stepId: string): Promise<string | null> {
  const store = profileStore(scene);
  const l = await load(store);
  const ms = l.state.modules.find((m) => m.module.id === moduleId);
  const st = ms?.module.steps.find((s) => s.id === stepId);
  const status = ms?.steps.find((s) => s.id === stepId);
  if (!ms || !st || !status) return null;
  if (!status.open) return 'Todavía no: antes hay que avanzar en el curso.';
  const now = Date.now();
  if (st.kind === 'tool') {
    scene.scene.start(st.scene, {});
    return null;
  }
  if (st.kind === 'learn' || st.kind === 'practice') {
    return launchGame(scene, { gameId: (st as PlayStep).game, level: status.level ?? 1 });
  }
  if (st.kind === 'boss') {
    beginFlow(scene, bossFlow(ms.module, st as BossStep, now), l.mastery);
    return null;
  }
  const review = st as ReviewStep;
  const idx = l.state.modules.findIndex((m) => m.module.id === moduleId);
  const skills = l.state.modules
    .slice(0, idx + 1)
    .filter((m) => m.unlocked && m.module.skill !== null)
    .map((m) => m.module.skill!);
  const own = ms.module.steps.find((s): s is PlayStep => s.kind === 'learn')!;
  const plan = planReview({
    now,
    instrument: l.instrument,
    mastery: l.mastery,
    skills,
    levelCap: levelCaps(l.blob, skills),
    maxRounds: review.rounds,
    minRounds: review.rounds,
    budgetSeconds: 400,
    must: { skill: ms.module.skill!, level: own.goals[own.goals.length - 1].level },
  });
  if (plan.rounds.length === 0) return 'No hay nada que repasar todavía.';
  beginFlow(scene, reviewFlow(plan, `${moduleId}:review`, `REPASO DE ${ms.module.title.toUpperCase()}`, ms.module.accent, now, moduleId), l.mastery);
  return null;
}

/** Starts a Turbo run on an arcade. */
export async function startTurbo(scene: Phaser.Scene, gameId: string, startLevel?: number): Promise<void> {
  const l = await load(profileStore(scene));
  const level = startLevel ?? turboStartLevel(highestCleared(l.blob, gameId));
  beginFlow(scene, turboFlow(gameId, level, Date.now()), l.mastery);
}

/** Does this result belong to the phase the running flow is waiting for? */
export function isFlowResult(scene: Phaser.Scene, data: ResultsData): boolean {
  const flow = getFlow(scene);
  if (!flow || flow.over) return false;
  const phase = flow.phases[flow.index];
  return !!phase && phase.gameId === data.params.gameId && phase.level === data.level;
}

export function outcomeOf(data: ResultsData): PhaseOutcome {
  return { gameId: data.params.gameId, level: data.level, stars: data.summary.stars, accuracy: data.summary.accuracy, score: data.arcade ? data.arcade.score : null };
}

/**
 * A round of the flow ended: stores the stars of the level, moves the flow on (and, when it is over, stores its
 * result) and opens the bridge screen. Called by the results scene instead of showing its own screen.
 */
export async function completePhase(scene: Phaser.Scene, data: ResultsData): Promise<void> {
  const store = profileStore(scene);
  const flow = getFlow(scene)!;
  const now = Date.now();
  const outcome = outcomeOf(data);
  const played = await recordLevel(store, outcome.gameId, outcome.level, outcome.stars, now);
  const opened = [...new Set([...((scene.registry.get(FLOW_UNLOCKED_KEY) as string[] | undefined) ?? []), ...played.unlocked.map((m) => m.id)])];
  scene.registry.set(FLOW_UNLOCKED_KEY, opened);
  const next = advance(flow, outcome);
  scene.registry.set(FLOW_KEY, next);
  if (!next.over) {
    scene.scene.start('flow', { stage: 'between', last: outcome });
    return;
  }
  const change = await recordFlow(store, next, now);
  scene.scene.start('flow', { stage: 'final', last: outcome, change, opened: [...new Set([...opened, ...change.unlocked.map((m) => m.id)])] });
}
