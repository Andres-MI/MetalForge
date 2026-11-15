/** Instruments, tunings and note maths. Everything else depends on this, never the other way round. */

export type InstrumentId = 'guitar' | 'bass4' | 'bass5';

export interface Instrument {
  id: InstrumentId;
  label: string;
  /** MIDI note of each open string, from the lowest-pitched string to the highest. */
  openStrings: number[];
  frets: number;
  /** Analysis window (samples at 48 kHz) the detector needs for this instrument's lowest note. */
  windowSize: number;
}

export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  guitar: { id: 'guitar', label: 'Guitarra', openStrings: [40, 45, 50, 55, 59, 64], frets: 22, windowSize: 2048 },
  bass4: { id: 'bass4', label: 'Bajo de 4 cuerdas', openStrings: [28, 33, 38, 43], frets: 20, windowSize: 4096 },
  bass5: { id: 'bass5', label: 'Bajo de 5 cuerdas', openStrings: [23, 28, 33, 38, 43], frets: 20, windowSize: 4096 },
};

const NOTE_NAMES_ES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq: number, a4 = 440): number {
  return 69 + 12 * Math.log2(freq / a4);
}

/** Cents between a frequency and the nearest equal-tempered note (-50..50). */
export function centsOff(freq: number): number {
  const m = freqToMidi(freq);
  return (m - Math.round(m)) * 100;
}

export function noteName(midi: number): string {
  return NOTE_NAMES_ES[((midi % 12) + 12) % 12];
}

export function noteNameWithOctave(midi: number): string {
  return `${noteName(midi)}${Math.floor(midi / 12) - 1}`;
}

/** A position on the fretboard. `string` is an index into `openStrings` (0 = lowest-pitched). */
export interface FretPos {
  string: number;
  fret: number;
}

export function midiAt(inst: Instrument, pos: FretPos): number {
  return inst.openStrings[pos.string] + pos.fret;
}

/** Every fretboard position that sounds a given MIDI note, optionally limited to a fret range. */
export function positionsFor(inst: Instrument, midi: number, minFret = 0, maxFret = inst.frets): FretPos[] {
  const out: FretPos[] = [];
  inst.openStrings.forEach((open, string) => {
    const fret = midi - open;
    if (fret >= minFret && fret <= maxFret) out.push({ string, fret });
  });
  return out;
}

/** Frequency range the detector should search for an instrument (with a margin of two semitones). */
export function pitchRange(inst: Instrument): { fmin: number; fmax: number } {
  const lo = Math.min(...inst.openStrings);
  const hi = Math.max(...inst.openStrings) + inst.frets;
  return { fmin: midiToFreq(lo - 2), fmax: midiToFreq(hi + 2) };
}
