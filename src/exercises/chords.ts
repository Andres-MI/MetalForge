/**
 * Chords and chord changes (Forja / Hechicero).
 *
 * Guitar: one `chord` target per chord, with its shape as a FretPos list (played strings only).
 * Bass: a bass has no chords, so it plays the ROOT of each one: individual `note` targets root, fifth, octave (and
 * fifth again in the four-note pattern), always the closed 1-5-8 shape (root at fret r on string s, fifth and octave at
 * fret r+2 on the next two strings) with its own level plan, BASS_SPECS below. Bass chord names are root names ("E",
 * "A", "D"...), with no major/minor split, so musically identical content has one itemId.
 *
 * Guitar levels (ONE new difficulty each; levelLabel has the same table):
 *  1 Em and Am   2 + E, A   3 + D   4 + G   5 + C      (single chords: each one is played 2-4 times in a row
 *                                                       before moving to the next, so the first levels are about
 *                                                       the SHAPE and the changes are slow)
 *  6 changes between two chords (a pair from the progressive list PAIRS, the easiest ones by seed)
 *  7 changes among the open chords   8 + F barre   9 power chords   10 timed progression (one chord per bar)
 *
 * Bass levels (levelLabel has the same table):
 *  1 E and A (open roots)   2 + D, G, C (closed shape)   3 change between two roots (progressive pairs)
 *  4 four-note pattern root-fifth-octave-fifth   5 position shifts: every root on the A string (E at 7, D at 5, G at 10...)
 *  6 changes among all roots   7 + F   8 changes with the four-note pattern   9 roots in the low or the A-string register, mixed
 *  10 timed bass line: I-IV-V-I in a key chosen by seed, one chord per bar, four-note pattern
 *
 * itemIds: "chords:Em" for a chord on its own, "chords:Em>Am" for the change into Am.
 */
import { INSTRUMENTS, midiAt, type FretPos, type Instrument } from '../model/instrument';
import type { Exercise, Target } from '../model/exercise';
import { clampLevel, DEFAULT_LENGTH, exerciseId, makeRng, pick, pickInt, shuffle, type GenerateOptions } from './common';

interface ChordDef {
  name: string;
  rootPc: number;
  /** Fret per string of a standard 6-string guitar, lowest first; -1 = not played. */
  frets: number[];
}

const def = (name: string, rootPc: number, frets: number[]): ChordDef => ({ name, rootPc, frets });

export const CHORDS: Record<string, ChordDef> = {
  Em: def('Em', 4, [0, 2, 2, 0, 0, 0]),
  Am: def('Am', 9, [-1, 0, 2, 2, 1, 0]),
  E: def('E', 4, [0, 2, 2, 1, 0, 0]),
  A: def('A', 9, [-1, 0, 2, 2, 2, 0]),
  D: def('D', 2, [-1, -1, 0, 2, 3, 2]),
  G: def('G', 7, [3, 2, 0, 0, 0, 3]),
  C: def('C', 0, [-1, 3, 2, 0, 1, 0]),
  F: def('F', 5, [1, 3, 3, 2, 1, 1]),
  E5: def('E5', 4, [0, 2, 2, -1, -1, -1]),
  G5: def('G5', 7, [3, 5, 5, -1, -1, -1]),
  A5: def('A5', 9, [5, 7, 7, -1, -1, -1]),
  C5: def('C5', 0, [8, 10, 10, -1, -1, -1]),
  D5: def('D5', 2, [10, 12, 12, -1, -1, -1]),
};

const OPEN = ['Em', 'Am', 'E', 'A', 'D', 'G', 'C'];
const POWER = ['E5', 'G5', 'A5', 'C5', 'D5'];

/** Pairs for the "change between two chords" level, from the easiest change to harder ones (seeds pick among the first PAIR_LEVELS). */
export const PAIRS: [string, string][] = [['Em', 'Am'], ['Am', 'E'], ['E', 'A'], ['A', 'D'], ['D', 'G'], ['G', 'C'], ['C', 'Am']];
const EASY_PAIRS = 5;

interface Spec {
  mode: 'single' | 'changes';
  /** Single chords played in runs: each chord is repeated 2-4 times before the next one. */
  runs?: boolean;
  pool: string[];
  /** Chords that must appear (the new ones of this level). */
  required: string[];
  /** Start with the first required chord. */
  startWithRequired?: boolean;
  /** The pairs a "change between two chords" level picks from (by seed). */
  pair?: [string, string][];
  timed?: boolean;
  /** Bass: where the root is played. 'near' = the lowest fret (open roots first), 'A' = always on the A string, 'mixed' = a seeded mix of both. */
  register?: 'near' | 'A' | 'mixed';
  /** Bass timed level: a I-IV-V-I progression in a key chosen by seed. */
  progression?: boolean;
  bassPattern: ('root' | 'fifth' | 'octave')[];
}

const BASS = ['root', 'fifth', 'octave'] as const;
const BASS4 = ['root', 'fifth', 'octave', 'fifth'] as const;
const mk = (s: Omit<Spec, 'bassPattern'> & { bassPattern?: Spec['bassPattern'] }): Spec => ({ bassPattern: [...BASS], ...s });

const SPECS: Spec[] = [
  mk({ mode: 'single', runs: true, pool: ['Em', 'Am'], required: ['Em', 'Am'] }),
  mk({ mode: 'single', runs: true, pool: ['Em', 'Am', 'E', 'A'], required: ['E', 'A'] }),
  mk({ mode: 'single', runs: true, pool: ['Em', 'Am', 'E', 'A', 'D'], required: ['D'] }),
  mk({ mode: 'single', runs: true, pool: ['Em', 'Am', 'E', 'A', 'D', 'G'], required: ['G'] }),
  mk({ mode: 'single', runs: true, pool: OPEN, required: ['C'] }),
  mk({ mode: 'changes', pool: OPEN, required: [], pair: PAIRS.slice(0, EASY_PAIRS) }),
  mk({ mode: 'changes', pool: OPEN, required: [] }),
  mk({ mode: 'changes', pool: [...OPEN, 'F'], required: ['F'], startWithRequired: true }),
  mk({ mode: 'changes', pool: POWER, required: ['E5'], startWithRequired: true, bassPattern: [...BASS4] }),
  mk({ mode: 'changes', pool: [...OPEN.filter((c) => c !== 'E' && c !== 'A'), 'F'], required: [], timed: true, bassPattern: [...BASS4] }),
];

const BASS_ROOTS = ['E', 'A', 'D', 'G', 'C'];
/** Bass pairs, easiest change first (seeds pick among the first BASS_EASY_PAIRS). */
export const BASS_PAIRS: [string, string][] = [['E', 'A'], ['A', 'D'], ['D', 'G'], ['G', 'C'], ['A', 'E']];
const BASS_EASY_PAIRS = 4;
/** Keys of the bass line level whose I, IV and V all exist as bass roots. */
const BASS_KEYS: [string, string, string][] = [['A', 'D', 'E'], ['D', 'G', 'A'], ['G', 'C', 'D'], ['C', 'F', 'G']];

const BASS_SPECS: Spec[] = [
  mk({ mode: 'single', runs: true, pool: ['E', 'A'], required: ['E', 'A'] }),
  mk({ mode: 'single', runs: true, pool: BASS_ROOTS, required: ['D', 'G', 'C'] }),
  mk({ mode: 'changes', pool: BASS_ROOTS, required: [], pair: BASS_PAIRS.slice(0, BASS_EASY_PAIRS) }),
  mk({ mode: 'single', runs: true, pool: BASS_ROOTS, required: [], bassPattern: [...BASS4] }),
  mk({ mode: 'changes', pool: BASS_ROOTS, required: [], register: 'A' }),
  mk({ mode: 'changes', pool: BASS_ROOTS, required: [] }),
  mk({ mode: 'changes', pool: [...BASS_ROOTS, 'F'], required: ['F'], startWithRequired: true }),
  mk({ mode: 'changes', pool: [...BASS_ROOTS, 'F'], required: [], bassPattern: [...BASS4] }),
  mk({ mode: 'changes', pool: [...BASS_ROOTS, 'F'], required: [], bassPattern: [...BASS4], register: 'mixed' }),
  mk({ mode: 'changes', pool: BASS_ROOTS, required: [], timed: true, progression: true, bassPattern: [...BASS4] }),
];

/** Shape of a guitar chord as played positions (muted strings are left out). */
export function chordShape(name: string): FretPos[] {
  const out: FretPos[] = [];
  CHORDS[name].frets.forEach((fret, string) => {
    if (fret >= 0) out.push({ string, fret });
  });
  return out;
}

/**
 * Root, fifth and octave of a chord on a bass in the closed 1-5-8 shape: root at fret r of string s, fifth and octave at
 * fret r+2 of the next two strings (a compact hand, span 2). `register` 'near' takes the lowest root fret, so an open
 * root is chosen exactly when it keeps the shape compact (E and A open; D at 5 on the A string; G at 3; C at 3 on the A
 * string; F at 1); 'A' puts the root on the A string (E at 7, D at 5, G at 10, C at 3, F at 8). Only the four upper
 * strings (E A D G) are used, also on a five-string bass.
 */
export function bassNotes(inst: Instrument, name: string, register: 'near' | 'A' = 'near'): { kind: 'root' | 'fifth' | 'octave'; midi: number; pos: FretPos }[] {
  const off = Math.max(0, inst.openStrings.length - 4);
  const rootPc = CHORDS[name].rootPc;
  const fretOn = (s: number) => (((rootPc - inst.openStrings[off + s]) % 12) + 12) % 12;
  let s = 0;
  let fret = fretOn(0);
  if (register === 'A') {
    s = 1;
    fret = fretOn(1);
  } else if (fret >= 5) {
    // the same pitch one string up is 5 frets lower, so it is never worse
    s = 1;
    fret -= 5;
  }
  const pos = [
    { string: off + s, fret },
    { string: off + s + 1, fret: fret + 2 },
    { string: off + s + 2, fret: fret + 2 },
  ];
  const kinds = ['root', 'fifth', 'octave'] as const;
  return pos.map((p, i) => ({ kind: kinds[i], midi: midiAt(inst, p), pos: p }));
}

/** Runs of one chord: new chords first (shuffled), then random ones from the pool; each repeated 2-4 times. */
function buildRuns(spec: Spec, length: number, r: () => number): string[] {
  const seq: string[] = [];
  const queue = shuffle(r, spec.required);
  // With few targets (placement probes) runs are capped so that at least two different chords appear.
  const maxRun = Math.max(2, Math.min(4, Math.floor(length / 2)));
  while (seq.length < length) {
    const prev = seq[seq.length - 1];
    const next = queue.length ? queue.shift()! : pick(r, spec.pool.filter((c) => c !== prev));
    // keep two slots for each new chord still waiting
    const reps = Math.max(1, Math.min(2 + pickInt(r, maxRun - 1), length - seq.length - 2 * queue.length));
    for (let k = 0; k < reps && seq.length < length; k++) seq.push(next);
  }
  return seq;
}

function buildSequence(spec: Spec, length: number, r: () => number): string[] {
  if (spec.pair) {
    const two = [...spec.pair![pickInt(r, spec.pair!.length)]];
    return Array.from({ length }, (_, i) => two[i % 2]);
  }
  if (spec.runs) return buildRuns(spec, length, r);
  const seq: string[] = [];
  const queue = shuffle(r, spec.required);
  if (spec.startWithRequired && queue.length) seq.push(queue.shift()!);
  while (seq.length < length) {
    const prev = seq[seq.length - 1];
    // Place pending required chords early enough to fit.
    const mustPlace = queue.length > 0 && length - seq.length <= queue.length + 1;
    const next = mustPlace ? queue.shift()! : pick(r, spec.pool.filter((c) => c !== prev));
    if (next === prev) continue;
    const qi = queue.indexOf(next);
    if (qi >= 0) queue.splice(qi, 1);
    seq.push(next);
  }
  return seq;
}

export function generateChords(opts: GenerateOptions): Exercise {
  const level = clampLevel(opts.level);
  const inst = INSTRUMENTS[opts.instrument];
  const isBass = inst.id !== 'guitar';
  const spec = (isBass ? BASS_SPECS : SPECS)[level - 1];
  const r = makeRng(opts.seed, 4);
  const length = spec.timed ? 4 : opts.length ?? DEFAULT_LENGTH;
  let seq = buildSequence(spec, length, r);
  if (spec.timed && spec.progression) {
    const [one, four, five] = BASS_KEYS[pickInt(r, BASS_KEYS.length)];
    seq = [one, four, five, one];
  } else if (spec.timed) seq = shuffle(r, spec.pool).slice(0, 4);
  // Bass: the register of each chord's root (see bassNotes), drawn after the sequence so earlier draws keep their stream.
  const registers = seq.map(() => (spec.register === 'mixed' ? (r() < 0.5 ? 'A' : 'near') : spec.register ?? 'near') as 'near' | 'A');

  const targets: Target[] = [];
  seq.forEach((name, i) => {
    const itemId = spec.mode === 'single' || i === 0 ? `chords:${name}` : `chords:${seq[i - 1]}>${name}`;
    if (!isBass) {
      const shape = chordShape(name);
      const t: Target = {
        itemId,
        kind: { type: 'chord', name, midis: shape.map((p) => midiAt(inst, p)), shape },
        chord: i,
      };
      if (spec.timed) t.beat = i * 4;
      targets.push(t);
    } else {
      const notes = bassNotes(inst, name, registers[i]);
      spec.bassPattern.forEach((role, k) => {
        const n = notes.find((x) => x.kind === role)!;
        const t: Target = { itemId, kind: { type: 'note', midi: n.midi, pos: n.pos }, chord: i };
        if (spec.timed) t.beat = i * 4 + k;
        targets.push(t);
      });
    }
  });

  return {
    id: exerciseId('chords', inst.id, level, opts.seed),
    skill: 'chords',
    instrument: inst.id,
    timed: !!spec.timed,
    bpm: spec.timed ? 60 : undefined,
    targets,
  };
}
