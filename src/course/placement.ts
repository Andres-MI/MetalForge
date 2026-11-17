/**
 * Placement test, pure part: which probe comes next and what the results mean for the course.
 *
 * Order and sizes are `PLACEMENT_PROBES` (data.ts). Each skill has an easy and a harder probe; the harder one is
 * only played when the easy one went well (so a beginner finishes in about two minutes and an experienced player
 * in about five). A probe is passed with two stars or more (score >= 0.65, the same bar as the arcades).
 *
 * Meaning: `skills[skill]` = level of the hardest probe passed (0 = the easy one failed). In progress.ts a
 * level up to that one counts as cleared with two stars in the learn game and the arcade of the skill, and a
 * module whose first probe was passed is open.
 */
import type { SkillId } from '../model/exercise';
import type { Placement } from './blob';
import { PLACEMENT_PROBES } from './data';
import type { PlacementProbe } from './types';

export const PROBE_PASS_STARS = 2;

export interface ProbeResult {
  skill: SkillId;
  level: number;
  stars: number;
}

export const probePassed = (r: ProbeResult): boolean => r.stars >= PROBE_PASS_STARS;

/** The next probe to play, or null when the test is over. */
export function nextProbe(done: ProbeResult[]): PlacementProbe | null {
  for (const group of PLACEMENT_PROBES) {
    for (let i = 0; i < group.length; i++) {
      const probe = group[i];
      const result = done.find((d) => d.skill === probe.skill && d.level === probe.level);
      if (!result) return probe;
      if (!probePassed(result)) break; // failed: the harder probes of this skill are skipped
    }
  }
  return null;
}

/** 1-based position of the probe about to be played and the most probes the test can have. */
export function probeProgress(done: ProbeResult[]): { index: number; max: number } {
  return { index: done.length + 1, max: PLACEMENT_PROBES.reduce((s, g) => s + g.length, 0) };
}

export function placementFromResults(done: ProbeResult[], now: number): Placement {
  const skills: Record<string, number> = {};
  for (const group of PLACEMENT_PROBES) {
    const skill = group[0].skill;
    if (!done.some((d) => d.skill === skill)) continue;
    let level = 0;
    for (const probe of group) {
      const r = done.find((d) => d.skill === skill && d.level === probe.level);
      if (r && probePassed(r)) level = probe.level;
      else break;
    }
    skills[skill] = level;
  }
  return { at: now, skipped: false, skills };
}

/** "Empezar desde cero": nothing tested, and the offer is not repeated. */
export const skippedPlacement = (now: number): Placement => ({ at: now, skipped: true, skills: {} });
