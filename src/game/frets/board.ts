/**
 * Layout of the fretboard strip shared by Luciérnagas and Ninja (pure: no Phaser). Same left-to-right mapping in
 * both games, so a fret learnt in one is found in the other: slot 0 (open string) sits left of the nut, slot k is
 * fret k. One row per string of the exercise zone, the highest-pitched string on top (as in a tab upside down:
 * the thinnest string is the top line).
 */
import { midiAt, type FretPos, type Instrument } from '../../model/instrument';

export const INLAYS = [3, 5, 7, 9, 12];

export interface BoardLayout {
  /** Strings of the zone, highest-pitched first (row 0 is drawn at the top). */
  strings: number[];
  maxFret: number;
  slots: number;
  step: number;
  /** x of the left edge of slot 0 and of the nut (right edge of slot 0). */
  left: number;
  nutX: number;
  right: number;
  /** y of the centre of the strip and distance between string lines. */
  centerY: number;
  rowGap: number;
  /** Frets present on each string of the zone. */
  frets: Map<number, Set<number>>;
}

export function boardLayout(zone: readonly FretPos[], width = 320, centerY = 84): BoardLayout {
  const frets = new Map<number, Set<number>>();
  for (const p of zone) {
    if (!frets.has(p.string)) frets.set(p.string, new Set());
    frets.get(p.string)!.add(p.fret);
  }
  const strings = [...frets.keys()].sort((a, b) => b - a);
  const maxFret = Math.max(...zone.map((p) => p.fret));
  const slots = maxFret + 1;
  const step = Math.min(24, Math.floor(296 / slots));
  const left = Math.round((width - slots * step) / 2);
  return { strings, maxFret, slots, step, left, nutX: left + step, right: left + slots * step, centerY, rowGap: strings.length > 1 ? 32 : 0, frets };
}

export function slotX(l: BoardLayout, fret: number): number {
  return l.left + fret * l.step + Math.floor(l.step / 2);
}

export function rowY(l: BoardLayout, string: number): number {
  const row = l.strings.indexOf(string);
  return Math.round(l.centerY + (row - (l.strings.length - 1) / 2) * l.rowGap);
}

/** Frets apart between two positions (what the ninja crosses in a dash). */
export function dashDistance(a: FretPos, b: FretPos): number {
  return Math.abs(a.fret - b.fret);
}

export interface Played {
  /** Where the note would be on the zone (the zone string the target is on first), or null when it is off the board. */
  pos: FretPos | null;
  /** 'high': played note is above anything shown; 'low': below. */
  off: 'high' | 'low' | null;
}

/** Where a heard MIDI note sits on the board: first a zone position with that pitch, then any zone string's fret in range. */
export function playedOnBoard(l: BoardLayout, inst: Instrument, midi: number, prefer?: FretPos): Played {
  const order = [...l.strings].sort((a, b) => (a === prefer?.string ? -1 : b === prefer?.string ? 1 : 0));
  for (const s of order) {
    const fret = midi - inst.openStrings[s];
    if (fret >= 0 && fret <= l.maxFret) return { pos: { string: s, fret }, off: null };
  }
  const top = Math.max(...l.strings.map((s) => midiAt(inst, { string: s, fret: l.maxFret })));
  return { pos: null, off: midi > top ? 'high' : 'low' };
}

/** Which way to move along the neck: a heard note lower than the target means going up the neck. */
export function directionHint(heard: number, target: number): { dir: 'up' | 'down'; text: string } {
  return heard < target ? { dir: 'up', text: 'más agudo →' } : { dir: 'down', text: '← más grave' };
}
