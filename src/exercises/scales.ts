/**
 * Scales (Escalada / Torre).
 *
 * Levels:
 *  1 A minor pentatonic, first position, ascending     2 up and down
 *  3 C major scale (open position), up and down        4 thirds on the pentatonic
 *  5 thirds on the major scale                         6 pentatonic, second position
 *  7 pentatonic, a position chosen by seed (3-5)       8 major scale, position at fret 7
 *  9 thirds in a position chosen by seed (2-5)         10 timed eighths at 80 bpm (second position, already known:
 *    time is the only new thing, the random positions stay in 7 and 9)
 *
 * The ordered run always starts and ends on the tonic (A for the pentatonic, C for the major): it climbs from the
 * lowest tonic of the position to a higher tonic (one octave for levels 1-3 and for thirds, at most two octaves
 * otherwise) and comes back down to the starting tonic. A position with a single tonic climbs from it to the highest
 * note of the position and comes back. Thirds are the same climb in steps of a third (they end on the upper tonic).
 *
 * `free: true` turns every target into `anyOf` the notes of the level's position.
 *
 * Pitch rule: a position lists each pitch once (the lowest-string occurrence), so two itemIds never
 * share a pitch. Positions span 4-5 frets, the stretch of one hand position.
 */
import { INSTRUMENTS, midiAt, type FretPos, type Instrument, type InstrumentId } from '../model/instrument';
import type { Exercise, Target } from '../model/exercise';
import { clampLevel, exerciseId, makeRng, pickInt, type GenerateOptions } from './common';

type ScaleId = 'pent-min' | 'major';
interface ScaleDef {
  id: ScaleId;
  rootPc: number;
  intervals: number[];
  /** Fret windows [lo, hi] of each position, relative to a standard-tuned low E string. */
  windows: [number, number][];
}

const SCALES: Record<ScaleId, ScaleDef> = {
  'pent-min': {
    id: 'pent-min',
    rootPc: 9,
    intervals: [0, 3, 5, 7, 10],
    windows: [[5, 8], [7, 10], [9, 13], [12, 15], [14, 17]],
  },
  major: { id: 'major', rootPc: 0, intervals: [0, 2, 4, 5, 7, 9, 11], windows: [[0, 3], [7, 10]] },
};

type Pattern = 'up' | 'updown' | 'thirds';
interface Spec {
  scale: ScaleId;
  /** Fixed position index, or a [min, max] range chosen by seed. */
  pos: number | [number, number];
  pattern: Pattern;
  timed?: boolean;
}

const SPECS: Spec[] = [
  { scale: 'pent-min', pos: 0, pattern: 'up' },
  { scale: 'pent-min', pos: 0, pattern: 'updown' },
  { scale: 'major', pos: 0, pattern: 'updown' },
  { scale: 'pent-min', pos: 0, pattern: 'thirds' },
  { scale: 'major', pos: 0, pattern: 'thirds' },
  { scale: 'pent-min', pos: 1, pattern: 'updown' },
  { scale: 'pent-min', pos: [2, 4], pattern: 'updown' },
  { scale: 'major', pos: 1, pattern: 'updown' },
  { scale: 'pent-min', pos: [1, 4], pattern: 'thirds' },
  { scale: 'pent-min', pos: 1, pattern: 'updown', timed: true },
];

export interface ScaleNote {
  pos: FretPos;
  midi: number;
}

function ladder(inst: Instrument, scale: ScaleDef, posIndex: number): ScaleNote[] {
  // The window assumes the reference string is the low E; on a bass or guitar that is the lowest E string.
  const [lo, hi] = scale.windows[posIndex];
  const seen = new Set<number>();
  const notes: ScaleNote[] = [];
  inst.openStrings.forEach((_, string) => {
    for (let fret = lo; fret <= Math.min(hi, inst.frets); fret++) {
      const midi = midiAt(inst, { string, fret });
      const degree = (((midi - scale.rootPc) % 12) + 12) % 12;
      if (!scale.intervals.includes(degree) || seen.has(midi)) continue;
      seen.add(midi);
      notes.push({ pos: { string, fret }, midi });
    }
  });
  return notes.sort((a, b) => a.midi - b.midi);
}

/**
 * The ascending run of a position: lowest tonic up to the tonic `octaves` higher (or the highest one the position
 * has); with a single tonic, up to the highest note; with none (never in the current tables), the whole position.
 */
export function tonicRun(notes: ScaleNote[], rootPc: number, octaves: number): ScaleNote[] {
  const tonics = notes.filter((n) => (((n.midi - rootPc) % 12) + 12) % 12 === 0);
  if (tonics.length === 0) return notes;
  const lo = tonics[0].midi;
  const hi = tonics.length > 1 ? tonics[Math.min(tonics.length - 1, octaves)].midi : Infinity;
  return notes.filter((n) => n.midi >= lo && n.midi <= hi);
}

function resolvePos(spec: Spec, seed: number): number {
  if (typeof spec.pos === 'number') return spec.pos;
  const r = makeRng(seed, 5);
  return spec.pos[0] + pickInt(r, spec.pos[1] - spec.pos[0] + 1);
}

/** The notes (one position each) the exercise draws from. */
export function scalesZone(instrument: InstrumentId, level: number, seed: number): ScaleNote[] {
  const spec = SPECS[clampLevel(level) - 1];
  return ladder(INSTRUMENTS[instrument], SCALES[spec.scale], resolvePos(spec, seed));
}

export function generateScales(opts: GenerateOptions): Exercise {
  const level = clampLevel(opts.level);
  const inst = INSTRUMENTS[opts.instrument];
  const spec = SPECS[level - 1];
  const scale = SCALES[spec.scale];
  const posIndex = resolvePos(spec, opts.seed);
  const notes = ladder(inst, scale, posIndex);
  const prefix = `scales:${scale.id}:p${posIndex + 1}`;
  const bpm = spec.timed ? 80 : undefined;
  const spacing = 0.5;
  const base = { id: exerciseId('scales', inst.id, level, opts.seed, opts.free), skill: 'scales' as const, instrument: inst.id, timed: !!spec.timed, bpm };

  if (opts.free) {
    const midis = notes.map((n) => n.midi);
    const count = opts.length ?? 8;
    const targets: Target[] = Array.from({ length: count }, (_, i) => {
      const t: Target = { itemId: `${prefix}:free`, kind: { type: 'anyOf', midis } };
      if (spec.timed) t.beat = i * spacing * 2;
      return t;
    });
    return { ...base, bpm: spec.timed ? 60 : undefined, targets };
  }

  const run = tonicRun(notes, scale.rootPc, level <= 3 || spec.pattern === 'thirds' ? 1 : 2);
  let seq: ScaleNote[];
  if (spec.pattern === 'up') seq = run;
  else if (spec.pattern === 'updown') seq = [...run, ...run.slice(0, -1).reverse()];
  else {
    seq = [];
    for (let i = 0; i + 2 < run.length; i++) seq.push(run[i], run[i + 2]);
  }
  const cap = opts.length ?? (spec.pattern === 'thirds' ? 16 : Infinity);
  seq = seq.slice(0, cap);

  const targets: Target[] = seq.map((n, i) => {
    const t: Target = { itemId: `${prefix}:m${n.midi}`, kind: { type: 'note', midi: n.midi, pos: n.pos } };
    if (spec.timed) t.beat = i * spacing;
    return t;
  });
  return { ...base, targets };
}
