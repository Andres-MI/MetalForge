/**
 * Helpers shared by Telar and Portero (pure): which string a heard note belongs to, how to name a string
 * and what to tell the player after a wrong note. Strings are indexes into `Instrument.openStrings`
 * (0 = lowest-pitched = bottom of the screen).
 */
import { stringsZone } from '../exercises';
import { INSTRUMENTS, midiAt, noteName, noteNameWithOctave, type FretPos, type InstrumentId } from '../model/instrument';
import type { Exercise } from '../model/exercise';

/** The position of every target of a strings exercise. */
export function targetPositions(exercise: Exercise): FretPos[] {
  return exercise.targets.map((t) => {
    if (t.kind.type !== 'note' || !t.kind.pos) throw new Error('strings exercise: target without a position');
    return t.kind.pos;
  });
}

/** Where a heard note sits in the level's zone; if it is outside it, the nearest open string (fret null) when close enough. */
export function locateHeard(instrument: InstrumentId, level: number, midi: number): { string: number; fret: number | null } | null {
  const inst = INSTRUMENTS[instrument];
  const hit = stringsZone(instrument, level).find((p) => midiAt(inst, p) === midi);
  if (hit) return { string: hit.string, fret: hit.fret };
  let best = 0;
  inst.openStrings.forEach((o, i) => {
    if (Math.abs(midi - o) < Math.abs(midi - inst.openStrings[best])) best = i;
  });
  return Math.abs(midi - inst.openStrings[best]) <= 4 ? { string: best, fret: null } : null;
}

/** Conventional string number: 1 is the highest-pitched. */
export const stringNumber = (instrument: InstrumentId, string: number): number => INSTRUMENTS[instrument].openStrings.length - string;

/** "6 Mi": string number and the note name of the open string. */
export function stringLabel(instrument: InstrumentId, string: number): string {
  return `${stringNumber(instrument, string)} ${noteName(INSTRUMENTS[instrument].openStrings[string])}`;
}

export const fretWords = (fret: number): string => (fret === 0 ? 'al aire' : `traste ${fret}`);

export interface WrongHint {
  /** Spanish text for the screen. */
  text: string;
  /** Where to go from the string heard: +1 toward higher-pitched strings (up on screen), -1 down, 0 same string. */
  direction: -1 | 0 | 1;
  /** Strings between the heard one and the target (0 for the same string). */
  distance: number;
  heardString: number | null;
}

/** What to say when `heardMidi` was played and `target` was expected. */
export function wrongHint(instrument: InstrumentId, level: number, target: FretPos, heardMidi: number): WrongHint {
  const heard = locateHeard(instrument, level, heardMidi);
  if (!heard) return { text: `Sonó ${noteNameWithOctave(heardMidi)}: no es de este nivel`, direction: 0, distance: 0, heardString: null };
  if (heard.string === target.string) {
    return { text: `Cuerda correcta, pero toca ${fretWords(target.fret)}`, direction: 0, distance: 0, heardString: heard.string };
  }
  const direction = target.string > heard.string ? 1 : -1;
  const distance = Math.abs(target.string - heard.string);
  return {
    text: `Sonó la ${stringLabel(instrument, heard.string)}: ve a la ${stringLabel(instrument, target.string)} ${direction > 0 ? '↑' : '↓'}`,
    direction,
    distance,
    heardString: heard.string,
  };
}

/** "Saltas 2 cuerdas ↑" for the transition from string `a` to `b`, or null when they are adjacent or equal. */
export function skipText(a: number, b: number): string | null {
  const d = Math.abs(b - a) - 1;
  return d >= 1 ? `Saltas ${d} ${d === 1 ? 'cuerda' : 'cuerdas'} ${b > a ? '↑' : '↓'}` : null;
}
