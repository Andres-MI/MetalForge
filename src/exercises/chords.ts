/**
 * Chords and chord changes (Forja / Hechicero).
 *
 * Guitar: one `chord` target per chord, with its shape as a FretPos list (played strings only).
 * Bass: the same chords as individual `note` targets: root, fifth, octave (from level 8: root, fifth,
 * octave, fifth).
 *
 * Guitar levels (ONE new difficulty each; levelLabel has the same table):
 *  1 Em and Am   2 + E, A   3 + D   4 + G   5 + C      (single chords: each one is played 2-4 times in a row
 *                                                       before moving to the next, so the first levels are about
 *                                                       the SHAPE and the changes are slow)
 *  6 changes between two chords (a pair from the progressive list PAIRS, the easiest ones by seed)
 *  7 changes among the open chords   8 + F barre   9 power chords   10 timed progression (one chord per bar)
 *
 * itemIds: "chords:Em" for a chord on its own, "chords:Em>Am" for the change into Am.
 */
import { INSTRUMENTS, midiAt, positionsFor, type FretPos, type Instrument } from '../model/instrument';
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
  pair?: boolean;
  timed?: boolean;
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
  mk({ mode: 'changes', pool: OPEN, required: [], pair: true }),
  mk({ mode: 'changes', pool: OPEN, required: [] }),
  mk({ mode: 'changes', pool: [...OPEN, 'F'], required: ['F'], startWithRequired: true }),
  mk({ mode: 'changes', pool: POWER, required: ['E5'], startWithRequired: true, bassPattern: [...BASS4] }),
  mk({ mode: 'changes', pool: [...OPEN.filter((c) => c !== 'E' && c !== 'A'), 'F'], required: [], timed: true, bassPattern: [...BASS4] }),
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
 * Root, fifth and octave of a chord on a bass, choosing the fingering with the smallest hand span.
 * The root lives in the octave of the low E (E1..D#2 on a standard bass).
 */
export function bassNotes(inst: Instrument, name: string): { kind: 'root' | 'fifth' | 'octave'; midi: number; pos: FretPos }[] {
  const base = inst.openStrings[Math.max(0, inst.openStrings.length - 4)];
  const rootPc = CHORDS[name].rootPc;
  const root = base + ((rootPc - (base % 12) + 12) % 12);
  const midis = [root, root + 7, root + 12];
  const kinds = ['root', 'fifth', 'octave'] as const;
  const options = midis.map((m) => positionsFor(inst, m, 0, 12));
  let best: FretPos[] | null = null;
  let bestCost = Infinity;
  for (const a of options[0])
    for (const b of options[1])
      for (const c of options[2]) {
        const fretted = [a, b, c].map((p) => p.fret).filter((f) => f > 0);
        const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
        const cost = span * 10 + (fretted.length ? Math.min(...fretted) : 0);
        if (cost < bestCost) {
          bestCost = cost;
          best = [a, b, c];
        }
      }
  const picked = best ?? options.map((o) => o[0]);
  return picked.map((pos, i) => ({ kind: kinds[i], midi: midis[i], pos }));
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
    const reps = 2 + pickInt(r, maxRun - 1);
    for (let k = 0; k < reps && seq.length < length; k++) seq.push(next);
  }
  return seq;
}

function buildSequence(spec: Spec, length: number, r: () => number): string[] {
  if (spec.pair) {
    const two = [...PAIRS[pickInt(r, EASY_PAIRS)]];
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
  const spec = SPECS[level - 1];
  const r = makeRng(opts.seed, 4);
  const isBass = inst.id !== 'guitar';
  const length = spec.timed ? 4 : opts.length ?? DEFAULT_LENGTH;
  let seq = buildSequence(spec, length, r);
  if (spec.timed) seq = shuffle(r, spec.pool).slice(0, 4);

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
      const notes = bassNotes(inst, name);
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
