/**
 * What Escalada and Torre need to know about a scales Exercise, read from the exercise itself (pure): which scale it is,
 * where its root is, which zone notes are roots, and the route of "holds" a climber draws for it.
 * The generator (src/exercises/scales.ts) names every target `scales:<scale>:p<position>:...`, so that is where the
 * scale and the position come from; the roots are the same as the generator's (A for the minor pentatonic, C for major).
 */
import type { Exercise } from '../../model/exercise';
import { noteName } from '../../model/instrument';

export type ScaleKind = 'pent-min' | 'major';

export interface ScaleInfo {
  kind: ScaleKind;
  /** Pitch class (0..11) of the root. */
  rootPc: number;
  /** 1-based position number within the scale. */
  position: number;
  /** Semitones above the root of each scale degree. */
  intervals: number[];
}

const KINDS: Record<ScaleKind, { rootPc: number; intervals: number[] }> = {
  'pent-min': { rootPc: 9, intervals: [0, 3, 5, 7, 10] },
  major: { rootPc: 0, intervals: [0, 2, 4, 5, 7, 9, 11] },
};

export function scaleInfo(exercise: Exercise): ScaleInfo {
  const m = /^scales:(pent-min|major):p(\d+)/.exec(exercise.targets[0]?.itemId ?? '');
  if (!m) throw new Error('scaleInfo: not a scales exercise');
  const kind = m[1] as ScaleKind;
  return { kind, rootPc: KINDS[kind].rootPc, position: Number(m[2]), intervals: KINDS[kind].intervals };
}

export const isRoot = (info: ScaleInfo, midi: number): boolean => (((midi - info.rootPc) % 12) + 12) % 12 === 0;

export function inScale(info: ScaleInfo, midi: number): boolean {
  return info.intervals.includes((((midi - info.rootPc) % 12) + 12) % 12);
}

/** "La menor pentatónica", "Do mayor". */
export function scaleName(info: ScaleInfo): string {
  const root = noteName(info.rootPc);
  return info.kind === 'major' ? `${root} mayor` : `${root} menor pentatónica`;
}

/** MIDI of the target notes of an ordered exercise (anyOf targets give their first note). */
export function targetMidis(exercise: Exercise): number[] {
  return exercise.targets.map((t) => (t.kind.type === 'note' ? t.kind.midi : t.kind.type === 'anyOf' ? t.kind.midis[0] : -1));
}

/** Every distinct MIDI note of the exercise's zone: the notes of an `anyOf` target, or the notes of an ordered run. */
export function zoneMidis(exercise: Exercise): number[] {
  const set = new Set<number>();
  for (const t of exercise.targets) {
    if (t.kind.type === 'anyOf') t.kind.midis.forEach((m) => set.add(m));
    else if (t.kind.type === 'note') set.add(t.kind.midi);
  }
  return [...set].sort((a, b) => a - b);
}

export interface Hold {
  index: number;
  midi: number;
  /** 0 = lowest note of the run, 1 = highest. */
  height: number;
  /** Wall column (0 or 1): holds alternate so neighbours are never stacked. */
  column: 0 | 1;
}

/** One hold per target of a run: higher pitch = higher on the wall; going down the scale comes back down the wall. */
export function routeHolds(midis: readonly number[]): Hold[] {
  const valid = midis.filter((m) => m >= 0);
  const lo = Math.min(...valid);
  const hi = Math.max(...valid);
  return midis.map((midi, index) => ({ index, midi, height: hi === lo ? 0 : (midi - lo) / (hi - lo), column: (index % 2) as 0 | 1 }));
}

export interface Phase {
  /** Index of its first and last target. */
  start: number;
  end: number;
  dir: 'up' | 'down';
}

/**
 * The ascent and the descent of a run: a run that goes up and comes back down (updown) has two phases split at its
 * highest note; a run that only climbs (up, thirds) has one. A phase played with no wrong note and no skip is "clean".
 */
export function runPhases(midis: readonly number[]): Phase[] {
  const n = midis.length;
  if (n === 0) return [];
  let peak = 0;
  midis.forEach((m, i) => {
    if (m > midis[peak]) peak = i;
  });
  const down = n - 1 - peak;
  if (down >= 3 && peak >= 1) return [{ start: 0, end: peak, dir: 'up' }, { start: peak + 1, end: n - 1, dir: 'down' }];
  return [{ start: 0, end: n - 1, dir: 'up' }];
}

/**
 * Free-mode bookkeeping (Escalada): which different notes of the scale the player has visited and which notes outside
 * the scale were tried. Pure: the scene feeds it what the Judge reports.
 */
export class FreeLog {
  readonly visited = new Set<number>();
  readonly outside = new Map<number, number>();
  plays = 0;
  /** Last note played and whether it was inside the scale. */
  last: { midi: number; inside: boolean } | null = null;

  constructor(readonly scale: readonly number[]) {}

  get total(): number {
    return this.scale.length;
  }
  get visitedCount(): number {
    return this.visited.size;
  }
  get complete(): boolean {
    return this.visited.size >= this.scale.length;
  }

  /** A note of the scale was played. Returns true when it is the first time (a new position lit up). */
  inside(midi: number): boolean {
    this.plays++;
    this.last = { midi, inside: true };
    const fresh = !this.visited.has(midi);
    this.visited.add(midi);
    return fresh;
  }

  /** A note outside the scale was played. */
  stray(midi: number): void {
    this.plays++;
    this.last = { midi, inside: false };
    this.outside.set(midi, (this.outside.get(midi) ?? 0) + 1);
  }
}
