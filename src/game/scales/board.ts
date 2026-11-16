/**
 * Pure helpers shared by Escalada and Torre: the fretboard layout of a scale position (the horizontal mapping of
 * Luciérnagas, see src/game/frets/board.ts, in a tighter vertical size because a position crosses every string) and the
 * free-play variant of an exercise.
 */
import type { Exercise } from '../../model/exercise';
import type { FretPos } from '../../model/instrument';
import { boardLayout, type BoardLayout } from '../frets/board';

export interface ScaleBoardOptions {
  /** Left edge and width of the area the strip may use (px). */
  x0: number;
  width: number;
  centerY: number;
  /** Distance between string lines. Default: smaller the more strings there are (13 px for six). */
  rowGap?: number;
}

/** Gap between string lines so that a strip of `strings` lines stays at most ~65 px tall. */
export function defaultRowGap(strings: number): number {
  return strings >= 6 ? 13 : strings === 5 ? 15 : strings === 4 ? 18 : 24;
}

/**
 * Same slot mapping as Luciérnagas (slot 0 = open string, left of the nut; slot k = fret k; highest-pitched string on
 * top), with the step chosen to fit `opts.width` and the strip placed at `opts.x0`.
 */
export function scaleBoardLayout(zone: readonly FretPos[], opts: ScaleBoardOptions): BoardLayout {
  const base = boardLayout(zone, opts.width, opts.centerY);
  const step = Math.min(24, Math.floor(opts.width / base.slots));
  const left = opts.x0 + Math.round((opts.width - base.slots * step) / 2);
  return {
    ...base,
    step,
    left,
    nutX: left + step,
    right: left + base.slots * step,
    rowGap: opts.rowGap ?? defaultRowGap(base.strings.length),
  };
}

/**
 * The same exercise as an UNTIMED improvisation: no beats, no tempo (or the given one, for the metronome of a boss
 * room), every target `anyOf` the scale. Used for the free round of Escalada and the boss rooms of Torre, also on the
 * timed level 10 (where the generator's free exercise is timed).
 */
export function improvisation(free: Exercise, bpm?: number): Exercise {
  return {
    ...free,
    id: `${free.id}:improv`,
    timed: false,
    bpm,
    targets: free.targets.map((t) => ({ itemId: t.itemId, kind: t.kind })),
  };
}
