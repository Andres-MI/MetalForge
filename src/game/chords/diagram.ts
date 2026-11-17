/**
 * Chord box as guitarists read it (pure data; `scenes/chordsDraw.ts` draws it).
 *
 * Strings run left to right from the lowest-pitched, the nut is on top and each row is a fret. Open strings get an "o",
 * muted ones an "x". When the shape sits high on the neck (power chords up the neck) the box starts at its lowest fret and
 * the first row is labelled with that fret number. The fingering is the usual one for the chords of the list.
 */
import { CHORDS } from '../../exercises/chords';
import { INSTRUMENTS, midiAt, noteName } from '../../model/instrument';
import { stringNumber } from './names';

export const DIAGRAM_ROWS = 4;

export interface DiagramString {
  /** String index, 0 = lowest-pitched. */
  string: number;
  state: 'open' | 'muted' | 'fret';
  fret: number;
  /** Finger 1 (index) .. 4 (little), when the chord has a usual fingering. */
  finger?: number;
  /** Row of the box (0 = first) for a fretted string, -1 otherwise. */
  row: number;
  midi: number | null;
}

export interface ChordDiagram {
  name: string;
  strings: DiagramString[];
  /** Fret shown on the first row (1 = the box starts at the nut). */
  baseFret: number;
  /** Barre across the box, drawn as a bar. */
  barre?: { fret: number; row: number; from: number; to: number; finger: number };
}

/** Usual fingers per string index (0 = lowest string); 0 = no finger (open or muted). */
const FINGERS: Record<string, number[]> = {
  Em: [0, 2, 3, 0, 0, 0],
  Am: [0, 0, 2, 3, 1, 0],
  E: [0, 2, 3, 1, 0, 0],
  A: [0, 0, 1, 2, 3, 0],
  D: [0, 0, 0, 1, 3, 2],
  G: [3, 2, 0, 0, 0, 4],
  C: [0, 3, 2, 0, 1, 0],
  F: [1, 4, 3, 2, 1, 1],
  E5: [0, 1, 2, 0, 0, 0],
  G5: [1, 3, 4, 0, 0, 0],
  A5: [1, 3, 4, 0, 0, 0],
  C5: [1, 3, 4, 0, 0, 0],
  D5: [1, 3, 4, 0, 0, 0],
};

const BARRES: Record<string, { fret: number; from: number; to: number; finger: number }> = {
  F: { fret: 1, from: 0, to: 5, finger: 1 },
};

export function chordDiagram(name: string): ChordDiagram {
  const def = CHORDS[name];
  if (!def) throw new Error(`unknown chord ${name}`);
  const fretted = def.frets.filter((f) => f > 0);
  const high = fretted.length ? Math.max(...fretted) : 0;
  const baseFret = high <= DIAGRAM_ROWS ? 1 : Math.min(...fretted);
  const guitar = INSTRUMENTS.guitar;
  const strings: DiagramString[] = def.frets.map((fret, string) => {
    const finger = FINGERS[name]?.[string] || undefined;
    if (fret < 0) return { string, state: 'muted', fret: -1, row: -1, midi: null };
    if (fret === 0) return { string, state: 'open', fret: 0, row: -1, midi: midiAt(guitar, { string, fret }) };
    return { string, state: 'fret', fret, finger, row: fret - baseFret, midi: midiAt(guitar, { string, fret }) };
  });
  const b = BARRES[name];
  return { name, strings, baseFret, barre: b ? { ...b, row: b.fret - baseFret } : undefined };
}

/** The strings of the chord's shape that play a MIDI note (usually one). */
export function stringsPlaying(name: string, midi: number): number[] {
  return chordDiagram(name).strings.filter((s) => s.midi === midi).map((s) => s.string);
}

export interface MissingNote {
  midi: number;
  note: string;
  /** String indices (0 = lowest) of the shape that play it. */
  strings: number[];
}

/** Maps the MIDI notes the verifier missed back to the strings of the shape that should play them. */
export function missingStrings(name: string, missing: number[]): MissingNote[] {
  return missing.map((midi) => ({ midi, note: noteName(midi), strings: stringsPlaying(name, midi) }));
}

const join = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

/** "Falta el Sol: revisa la cuerda 3" / "Faltan Sol y Si: revisa las cuerdas 3 y 2". Strings counted as players do (1 = thinnest). */
export function missingMessage(name: string, missing: number[]): string {
  if (!missing.length) return '';
  const info = missingStrings(name, missing);
  const notes = [...new Set(info.map((m) => m.note))];
  const nums = [...new Set(info.flatMap((m) => m.strings.map((s) => stringNumber('guitar', s))))];
  const where = nums.length ? `: revisa ${nums.length === 1 ? 'la cuerda' : 'las cuerdas'} ${join(nums.map(String))}` : '';
  return `${notes.length === 1 ? 'Falta el' : 'Faltan'} ${join(notes)}${where}`;
}
