/**
 * Which notes to listen to for a chord: its tones (required) and the notes that would turn it into a
 * different chord (contradicting). Derived from the game's own chord list, so a new chord there is covered
 * without touching this file.
 *
 * Contradicting notes of a chord:
 *  - the other third: every third of the chord moved one semitone (major to minor and back: E/Em, A/Am, D/Dm).
 *    Chords without a third (power chords) have none from this rule;
 *  - for every OTHER chord of the list that shares 2 or more pitch classes with it, the notes that chord plays
 *    whose pitch class is not in this one (C against Am gives A; G against Em gives E; E5 against Em gives G).
 * Notes that are also required are never contradicting.
 */
import { CHORDS, chordShape } from '../exercises/chords';
import type { Exercise } from '../model/exercise';
import { INSTRUMENTS, midiAt } from '../model/instrument';
import type { ChordKind } from './chord';

export interface ChordSet {
  /** The chord's own notes, unique, ascending. */
  required: number[];
  /** Notes whose presence says "this is another chord", unique, ascending, disjoint from `required`. */
  contradicting: number[];
  /** required + contradicting: what the detector is asked about. */
  candidates: number[];
}

const pc = (m: number) => ((m % 12) + 12) % 12;
const uniqSorted = (a: Iterable<number>) => [...new Set(a)].sort((x, y) => x - y);

/** Guitar notes of every chord of the list, by name (the shapes are guitar shapes). */
const LIST: { name: string; midis: number[]; pcs: Set<number> }[] = Object.keys(CHORDS).map((name) => {
  const midis = chordShape(name).map((p) => midiAt(INSTRUMENTS.guitar, p));
  return { name, midis, pcs: new Set(midis.map(pc)) };
});

const cache = new Map<string, ChordSet>();

export function chordSet(chord: ChordKind): ChordSet {
  const key = `${chord.name}:${chord.midis.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const required = uniqSorted(chord.midis);
  const pcs = new Set(required.map(pc));
  const contra = new Set<number>();

  // The other third.
  const root = CHORDS[chord.name]?.rootPc ?? pc(required[0]);
  const major = pcs.has((root + 4) % 12);
  const minor = pcs.has((root + 3) % 12);
  if (major !== minor) {
    const thirdPc = major ? (root + 4) % 12 : (root + 3) % 12;
    for (const m of required) if (pc(m) === thirdPc) contra.add(major ? m - 1 : m + 1);
  }

  // Neighbours in the list.
  for (const other of LIST) {
    if (other.name === chord.name) continue;
    let shared = 0;
    for (const p of other.pcs) if (pcs.has(p)) shared++;
    if (shared < 2) continue;
    for (const m of other.midis) if (!pcs.has(pc(m))) contra.add(m);
  }

  for (const m of required) contra.delete(m);
  const contradicting = uniqSorted(contra);
  const set = { required, contradicting, candidates: uniqSorted([...required, ...contradicting]) };
  cache.set(key, set);
  return set;
}

/** Candidates the detector should check while this target is the one being waited for ([] for non-chords). */
export function chordCandidatesFor(exercise: Exercise, index: number): number[] {
  const k = exercise.targets[index]?.kind;
  return k && k.type === 'chord' ? chordSet(k).candidates : [];
}
