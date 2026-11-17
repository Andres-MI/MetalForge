/** The course as data: modules, their steps and what opens them. Pure types, no behaviour. */
import type { SkillId } from '../model/exercise';
import type { PaletteKey } from '../ui/palette';

/** A level of a game the player has to clear with at least `minStars` stars. */
export interface LevelGoal {
  level: number;
  minStars: number;
}

/** Aprender and Practicar: one game, a few levels. The step is done when every goal is met. */
export interface PlayStep {
  id: 'learn' | 'practice';
  kind: 'learn' | 'practice';
  /** Key in `GAMES`; its `mode` must equal `kind` and its `skill` the module's. */
  game: string;
  goals: LevelGoal[];
}

/** Repasar: a short mixed round (see review.ts) over this module and the ones before it. */
export interface ReviewStep {
  id: 'review';
  kind: 'review';
  /** Rounds in the module review (2-3: it lasts about three minutes). */
  rounds: number;
  /** Mean stars of the rounds needed to count it as done. */
  minStars: number;
}

export interface BossPhase {
  /** Key in `GAMES`. */
  game: string;
  level: number;
}

/** Jefe: a fixed sequence of phases, each one an existing game at a set level; passed with a combined result. */
export interface BossStep {
  id: 'boss';
  kind: 'boss';
  /** Name on the title card, e.g. "EL METRÓNOMO FURIOSO". */
  title: string;
  phases: BossPhase[];
  /** Mean stars over the phases needed to pass (and complete the module). */
  passStars: number;
}

/** Preparación: tools instead of games. */
export interface ToolStep {
  id: 'tuner' | 'calibration';
  kind: 'tool';
  label: string;
  /** Scene to open. */
  scene: string;
}

export type Step = PlayStep | ReviewStep | BossStep | ToolStep;

export interface CourseModule {
  id: string;
  /** Spanish name, e.g. "Ritmo". */
  title: string;
  /** Null for Preparación. */
  skill: SkillId | null;
  /** Hub cabinet (HUB_GAMES[].id) that lights up when the module is open. */
  cabinet: string;
  accent: PaletteKey;
  /** The module opens when the PRACTICE step of each of these is complete (empty = open from the start). */
  requires: string[];
  /** Short line for the course screen. */
  blurb: string;
  steps: Step[];
}

export interface Course {
  /** 'guitar' for the guitar, 'bass' for both basses. */
  family: 'guitar' | 'bass';
  modules: CourseModule[];
}

/** One probe of the placement test: an exercise small enough for ~30 s. */
export interface PlacementProbe {
  skill: SkillId;
  level: number;
  /** Targets or beats (see GenerateOptions.length). */
  length: number;
}
