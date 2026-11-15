/**
 * Frets on one string (Luciérnagas / Ninja). Untimed.
 *
 * Levels (one new difficulty each):
 *  1-5  one string, frets 0-3, 0-5, 0-7, 0-9, 0-12
 *  6-8  two adjacent strings, the upper one growing 0-4, 0-7, 0-12
 *  9    same zone, big leaps allowed
 *  10   two strings that are not adjacent
 *
 * Pitch rule: in a two-string zone the lower string only uses frets below the interval between the
 * strings, so no pitch exists twice inside the zone.
 */
import { INSTRUMENTS, midiAt, type FretPos, type Instrument, type InstrumentId } from '../model/instrument';
import type { Exercise, Target } from '../model/exercise';
import { clampLevel, DEFAULT_LENGTH, exerciseId, makeRng, pick, pickInt, type GenerateOptions } from './common';

interface Spec {
  pair: boolean;
  /** Highest fret of the single string, or of the upper string of a pair. */
  maxFret: number;
  /** Strings apart in a pair (1 = adjacent). */
  apart: number;
  /** Largest pitch jump between consecutive targets, in semitones. */
  leap: number;
}

const SPECS: Spec[] = [
  { pair: false, maxFret: 3, apart: 0, leap: 4 },
  { pair: false, maxFret: 5, apart: 0, leap: 4 },
  { pair: false, maxFret: 7, apart: 0, leap: 5 },
  { pair: false, maxFret: 9, apart: 0, leap: 5 },
  { pair: false, maxFret: 12, apart: 0, leap: 5 },
  { pair: true, maxFret: 4, apart: 1, leap: 7 },
  { pair: true, maxFret: 7, apart: 1, leap: 7 },
  { pair: true, maxFret: 12, apart: 1, leap: 7 },
  { pair: true, maxFret: 12, apart: 1, leap: 99 },
  { pair: true, maxFret: 12, apart: 2, leap: 99 },
];

function buildZone(inst: Instrument, spec: Spec, r: () => number): FretPos[] {
  const n = inst.openStrings.length;
  const zone: FretPos[] = [];
  if (!spec.pair) {
    const string = pickInt(r, n);
    for (let fret = 0; fret <= Math.min(spec.maxFret, inst.frets); fret++) zone.push({ string, fret });
    return zone;
  }
  const lower = pickInt(r, n - spec.apart);
  const upper = lower + spec.apart;
  const gap = inst.openStrings[upper] - inst.openStrings[lower];
  for (let fret = 0; fret < gap; fret++) zone.push({ string: lower, fret });
  for (let fret = 0; fret <= Math.min(spec.maxFret, inst.frets); fret++) zone.push({ string: upper, fret });
  return zone;
}

/** Positions the exercise may ask for. Exported so tests can prove the pitch rule on it. */
export function fretsZone(instrument: InstrumentId, level: number, seed: number): FretPos[] {
  const lv = clampLevel(level);
  return buildZone(INSTRUMENTS[instrument], SPECS[lv - 1], makeRng(seed, 1));
}

export function generateFrets(opts: GenerateOptions): Exercise {
  const level = clampLevel(opts.level);
  const inst = INSTRUMENTS[opts.instrument];
  const spec = SPECS[level - 1];
  const r = makeRng(opts.seed, 1);
  const zone = buildZone(inst, spec, r);
  const length = opts.length ?? DEFAULT_LENGTH;
  const used = new Set<number>();
  const targets: Target[] = [];
  let prev: FretPos | undefined;
  for (let i = 0; i < length; i++) {
    const prevMidi = prev ? midiAt(inst, prev) : undefined;
    let cands = zone.filter((p) => prevMidi === undefined || (midiAt(inst, p) !== prevMidi && Math.abs(midiAt(inst, p) - prevMidi) <= spec.leap));
    if (!cands.length) cands = zone.filter((p) => midiAt(inst, p) !== prevMidi);
    // Prefer positions not asked yet, so a short exercise covers as much of the zone as it can.
    const fresh = cands.filter((p) => !used.has(p.string * 100 + p.fret));
    const p = pick(r, fresh.length ? fresh : cands);
    used.add(p.string * 100 + p.fret);
    targets.push({
      itemId: `frets:${inst.id}:s${p.string}:f${p.fret}`,
      kind: { type: 'note', midi: midiAt(inst, p), pos: p },
    });
    prev = p;
  }
  return { id: exerciseId('frets', inst.id, level, opts.seed), skill: 'frets', instrument: inst.id, timed: false, targets };
}
