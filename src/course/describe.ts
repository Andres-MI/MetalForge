/** What a neutral screen shows for a target of any skill (placement test): text only, no game art. Pure. */
import { CHORDS } from '../exercises/chords';
import { BASS_ROLE_ES, bassRoles, chordLabel, groupChords, stringNumber } from '../game/chords/names';
import type { Exercise } from '../model/exercise';
import { INSTRUMENTS, noteNameWithOctave } from '../model/instrument';

export interface TargetInfo {
  /** Big line: "La2", "Mi menor". */
  big: string;
  /** Small line: where to play it. */
  small: string;
  /** MIDI notes the player has to sound (empty for a rhythm attack). */
  midis: number[];
  /** Chord name for a guitar chord target. */
  chord: string | null;
}

export function describeTarget(ex: Exercise, index: number): TargetInfo {
  const t = ex.targets[index];
  const k = t.kind;
  const inst = INSTRUMENTS[ex.instrument];
  if (k.type === 'attack') return { big: 'Toca', small: 'En cada golpe, a tiempo', midis: [], chord: null };
  if (k.type === 'anyOf') return { big: 'Libre', small: 'Cualquier nota de la escala', midis: k.midis, chord: null };
  if (k.type === 'pitchClass') return { big: String(k.pc), small: '', midis: [], chord: null };
  if (k.type === 'chord') {
    const frets = inst.openStrings.map((_, s) => {
      const p = (k.shape ?? []).find((x) => x.string === s);
      return p ? String(p.fret) : 'x';
    });
    return { big: chordLabel(k.name), small: `Cuerdas (grave a aguda): ${frets.join(' ')}`, midis: k.midis, chord: k.name };
  }
  const where = k.pos ? `Cuerda ${stringNumber(ex.instrument, k.pos.string)} · traste ${k.pos.fret}` : '';
  if (ex.skill === 'chords') {
    // Bass: root, fifth and octave of a chord are consecutive note targets.
    const groups = groupChords(ex);
    const g = [...groups].reverse().find((x) => index >= x.first);
    if (g && CHORDS[g.name]) {
      const role = bassRoles(g.count)[index - g.first];
      return { big: `${noteNameWithOctave(k.midi)} (${BASS_ROLE_ES[role]})`, small: `${chordLabel(g.name)} · ${where}`, midis: [k.midi], chord: null };
    }
  }
  return { big: noteNameWithOctave(k.midi), small: where, midis: [k.midi], chord: null };
}
