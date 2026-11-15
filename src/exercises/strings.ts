/**
 * String changes and skips (Telar / Portero).
 *
 * Levels:
 *  1 open strings, adjacent        2 + skipping one string      3 + any distance
 *  4 fixed fret (2)                5 open and fretted mixed
 *  6 alternate-picking pattern a-b-a-b (untimed)
 *  7 same, timed (quarters, 60 bpm)  8 inside pattern a-b-c-b (66 bpm)
 *  9 skip patterns a-c-a-c / a-c-b-c (72 bpm)  10 eighths at 80 bpm
 *
 * Pitch rule: only open strings and fret 2 are used. Strings are at least a major third apart, so
 * open[i] + 2 never equals open[j]: every position of the zone sounds different.
 */
import { INSTRUMENTS, midiAt, type FretPos, type InstrumentId } from '../model/instrument';
import type { Exercise, Target } from '../model/exercise';
import { clampLevel, DEFAULT_LENGTH, exerciseId, makeRng, pick, pickInt, type GenerateOptions } from './common';

export const FIXED_FRET = 2;

type Kind = 'adj' | 'skip' | 'fret' | 'mix' | 'alt';
type Pattern = 'ab' | 'abcb' | 'acac-acbc';

interface Spec {
  maxDist: number;
  fretMode: 'open' | 'fixed' | 'mixed';
  pattern?: Pattern;
  bpm?: number;
  spacing?: number;
  /** Force at least one transition of distance >= 2. */
  needSkip?: boolean;
  /** Force at least one transition of distance >= 3 (when the instrument has the strings). */
  needFar?: boolean;
}

const SPECS: Spec[] = [
  { maxDist: 1, fretMode: 'open' },
  { maxDist: 2, fretMode: 'open', needSkip: true },
  { maxDist: 9, fretMode: 'open', needSkip: true, needFar: true },
  { maxDist: 9, fretMode: 'fixed' },
  { maxDist: 9, fretMode: 'mixed' },
  { maxDist: 1, fretMode: 'mixed', pattern: 'ab' },
  { maxDist: 1, fretMode: 'mixed', pattern: 'ab', bpm: 60, spacing: 1 },
  { maxDist: 2, fretMode: 'mixed', pattern: 'abcb', bpm: 66, spacing: 1 },
  { maxDist: 2, fretMode: 'mixed', pattern: 'acac-acbc', bpm: 72, spacing: 1 },
  { maxDist: 2, fretMode: 'mixed', pattern: 'acac-acbc', bpm: 80, spacing: 0.5 },
];

/** Every position this level can ask for (all strings, open and/or fret 2). */
export function stringsZone(instrument: InstrumentId, level: number): FretPos[] {
  const spec = SPECS[clampLevel(level) - 1];
  const frets = spec.fretMode === 'open' ? [0] : spec.fretMode === 'fixed' ? [FIXED_FRET] : [0, FIXED_FRET];
  const zone: FretPos[] = [];
  INSTRUMENTS[instrument].openStrings.forEach((_, string) => frets.forEach((fret) => zone.push({ string, fret })));
  return zone;
}

function patternStrings(p: Pattern, base: number, r: () => number): number[] {
  switch (p) {
    case 'ab':
      return [base, base + 1, base, base + 1];
    case 'abcb':
      return [base, base + 1, base + 2, base + 1];
    case 'acac-acbc':
      return r() < 0.5 ? [base, base + 2, base, base + 2] : [base, base + 2, base + 1, base + 2];
  }
}

function patternSpan(p: Pattern): number {
  return p === 'ab' ? 2 : 3;
}

export function generateStrings(opts: GenerateOptions): Exercise {
  const level = clampLevel(opts.level);
  const inst = INSTRUMENTS[opts.instrument];
  const spec = SPECS[level - 1];
  const n = inst.openStrings.length;
  const r = makeRng(opts.seed, 2);
  const length = opts.length ?? DEFAULT_LENGTH;

  // 1. Sequence of strings.
  const seq: number[] = [];
  if (spec.pattern) {
    const span = patternSpan(spec.pattern);
    while (seq.length < length) {
      let group: number[] = [];
      for (let tries = 0; tries < 8; tries++) {
        group = patternStrings(spec.pattern, pickInt(r, n - span + 1), r);
        if (!seq.length || group[0] !== seq[seq.length - 1]) break;
      }
      seq.push(...group);
    }
    seq.length = length;
  } else {
    seq.push(pickInt(r, n));
    for (let i = 1; i < length; i++) {
      const cur = seq[i - 1];
      const maxD = Math.min(spec.maxDist, n - 1);
      const forceFar = spec.needFar && maxD >= 3 && i === 3;
      const forceSkip = forceFar || (spec.needSkip && maxD >= 2 && i % 2 === 0);
      const options: number[] = [];
      for (let to = 0; to < n; to++) {
        const d = Math.abs(to - cur);
        if (d === 0 || d > maxD) continue;
        if (forceSkip && d < (forceFar ? 3 : 2)) continue;
        options.push(to);
      }
      if (!options.length) options.push(cur === 0 ? 1 : cur - 1);
      seq.push(pick(r, options));
    }
  }

  // 2. Fretting: constant per group of four in patterns, per note otherwise.
  const memo: number[] = [];
  const fretFor = (i: number): number => {
    if (spec.fretMode === 'open') return 0;
    if (spec.fretMode === 'fixed') return FIXED_FRET;
    if (spec.pattern) {
      const g = Math.floor(i / 4);
      if (memo[g] === undefined) memo[g] = r() < 0.5 ? 0 : FIXED_FRET;
      return memo[g];
    }
    return r() < 0.5 ? 0 : FIXED_FRET;
  };

  const kindOf = (d: number): Kind => {
    if (spec.pattern) return 'alt';
    if (spec.fretMode === 'fixed') return 'fret';
    if (spec.fretMode === 'mixed') return 'mix';
    return d >= 2 ? 'skip' : 'adj';
  };

  const targets: Target[] = seq.map((string, i) => {
    const pos: FretPos = { string, fret: fretFor(i) };
    const itemId =
      i === 0
        ? `strings:start:${string}`
        : `strings:${kindOf(Math.abs(string - seq[i - 1]))}:${seq[i - 1]}>${string}`;
    const t: Target = { itemId, kind: { type: 'note', midi: midiAt(inst, pos), pos } };
    if (spec.bpm) t.beat = i * (spec.spacing ?? 1);
    return t;
  });

  return {
    id: exerciseId('strings', inst.id, level, opts.seed),
    skill: 'strings',
    instrument: inst.id,
    timed: spec.bpm !== undefined,
    bpm: spec.bpm,
    targets,
  };
}
