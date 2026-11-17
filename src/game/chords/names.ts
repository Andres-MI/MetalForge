/**
 * Names and groups for the chord games (Forja / Hechicero). Pure: no Phaser, no audio.
 *
 * A guitar chord is ONE `chord` target; on a bass the same chord is 3 or 4 consecutive `note` targets (root, fifth,
 * octave, fifth) that share one itemId. `groupChords` hides that difference: every game works with chord GROUPS.
 */
import { CHORDS, chordShape } from '../../exercises/chords';
import type { Exercise } from '../../model/exercise';
import { INSTRUMENTS, midiAt, noteName, type InstrumentId } from '../../model/instrument';

/** One chord of an exercise: the chord target (guitar) or the run of note targets (bass) that make it up. */
export interface ChordGroup {
  /** Chord name as in CHORDS ("Em", "F", "E5"). */
  name: string;
  /** Name of the chord played just before it in the exercise ('' for the first). */
  from: string;
  /** Index of its first target in the exercise and how many targets it owns (1 on guitar, 3-4 on bass). */
  first: number;
  count: number;
  /** Beat of its first target (timed exercises). */
  beat?: number;
}

/** "chords:Em" -> "Em"; "chords:Em>Am" -> "Am" (the chord a target belongs to). */
export function chordNameOf(itemId: string): string {
  const rest = itemId.replace(/^chords:/, '');
  const i = rest.lastIndexOf('>');
  return i >= 0 ? rest.slice(i + 1) : rest;
}

/** "chords:Em>Am" -> "Em" (the chord before), '' for a chord on its own. */
export function changeFromOf(itemId: string): string {
  const rest = itemId.replace(/^chords:/, '');
  const i = rest.lastIndexOf('>');
  return i >= 0 ? rest.slice(0, i) : '';
}

/**
 * Splits an exercise's targets into chords: by the `chord` ordinal of each target when the generator gives it; otherwise
 * every `chord` target is a chord of its own (a chord may be repeated) and a run of note targets with the same itemId is one.
 */
export function groupChords(exercise: Exercise): ChordGroup[] {
  const groups: ChordGroup[] = [];
  let prevName = '';
  exercise.targets.forEach((t, i) => {
    const last = groups[groups.length - 1];
    const same = t.chord !== undefined ? exercise.targets[last?.first ?? 0]?.chord === t.chord : t.kind.type !== 'chord' && exercise.targets[last?.first ?? 0]?.itemId === t.itemId;
    if (last && same) {
      last.count++;
      return;
    }
    const name = chordNameOf(t.itemId);
    groups.push({ name, from: prevName, first: i, count: 1, beat: t.beat });
    prevName = name;
  });
  return groups;
}

/** Index of the group a target belongs to. */
export function groupIndexOf(groups: ChordGroup[], targetIndex: number): number {
  for (let g = groups.length - 1; g >= 0; g--) if (targetIndex >= groups[g].first) return g;
  return 0;
}

/** Spanish name of a chord: "Mi menor", "Sol mayor", "Mi 5" (power chord). */
export function chordLabel(name: string): string {
  const def = CHORDS[name];
  if (!def) return name;
  const root = noteName(def.rootPc);
  if (/5$/.test(name)) return `${root} 5`;
  if (/m$/.test(name)) return `${root} menor`;
  return `${root} mayor`;
}

/** Note names of a chord, lowest tone first, without repeats ("Mi", "Si", "Sol"). Guitar tones. */
export function chordToneNames(name: string): string[] {
  const pcs: number[] = [];
  for (const p of chordShape(name)) {
    const m = midiAt(INSTRUMENTS.guitar, p) % 12;
    if (!pcs.includes(m)) pcs.push(m);
  }
  return pcs.map((pc) => noteName(pc));
}

/** What a bass target is for the chord. */
export const BASS_ROLE_ES = { root: 'fundamental', fifth: 'quinta', octave: 'octava' } as const;

/** Roles of the notes of a bass chord in playing order (3 or 4 steps), from how many there are. */
export function bassRoles(count: number): ('root' | 'fifth' | 'octave')[] {
  return count >= 4 ? ['root', 'fifth', 'octave', 'fifth'] : ['root', 'fifth', 'octave'];
}

/** String number as players count it (1 = thinnest string). The font has no ordinal sign, so text says "cuerda 3". */
export function stringNumber(instrument: InstrumentId, string: number): number {
  return INSTRUMENTS[instrument].openStrings.length - string;
}

/**
 * The chord of the list a player probably strummed when these notes (MIDI) sounded although they are not in `name`:
 * the other chord that contains all of them and whose tones best match what was heard (`present` = the chord's own
 * tones that sounded plus the foreign ones). null when no chord of the list explains them.
 */
export function lookAlike(name: string, foreign: number[], present: number[]): string | null {
  if (!foreign.length) return null;
  const heard = new Set([...present, ...foreign]);
  let best: string | null = null;
  let bestCost = Infinity;
  for (const other of Object.keys(CHORDS)) {
    if (other === name) continue;
    const midis = new Set(chordShape(other).map((p) => midiAt(INSTRUMENTS.guitar, p)));
    if (!foreign.every((m) => midis.has(m))) continue;
    let cost = 0;
    for (const m of midis) if (!heard.has(m)) cost += 1;
    for (const m of heard) if (!midis.has(m)) cost += 1;
    if (cost < bestCost) {
      bestCost = cost;
      best = other;
    }
  }
  return best;
}
