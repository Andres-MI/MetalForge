/**
 * What to tell the player after a strum, from the spectral verdict (`ScoredTarget.chord`). Pure text and data.
 * Shared by Forja (learn) and, in short form, by Hechicero.
 */
import { noteName } from '../../model/instrument';
import type { ChordAnalysis } from '../../scoring/chord';
import { chordDiagram, missingMessage, missingStrings, type MissingNote } from './diagram';
import { chordLabel, lookAlike } from './names';

/** A strum counts as clean (critical hit, hot ingot) from this cleanliness. Tunable. */
export const CLEAN_THRESHOLD = 0.6;

export interface ChordFeedback {
  /** The chord was accepted. */
  ok: boolean;
  clean: boolean;
  cleanliness: number;
  /** Tones that did not sound, with the strings of the shape that should play them. */
  missing: MissingNote[];
  /** Strings (0 = lowest) of the shape whose tone sounded, and whose tone is missing. */
  presentStrings: number[];
  missingStringIdx: number[];
  /** Notes of other chords that sounded (names). */
  foreign: string[];
  /** Chord of the list that the foreign notes point to, if any. */
  lookAlike: string | null;
  /** Message lines, most important first (empty when everything is right). */
  missingText: string;
  foreignText: string;
}

export function foreignMessage(name: string, foreign: number[], present: number[]): { text: string; look: string | null } {
  if (!foreign.length) return { text: '', look: null };
  const notes = [...new Set(foreign.map((m) => noteName(m)))];
  const look = lookAlike(name, foreign, present);
  const heard = notes.length === 1 ? `Suena un ${notes[0]}` : `Suenan ${notes.slice(0, -1).join(', ')} y ${notes[notes.length - 1]}`;
  if (!look) return { text: `${heard} que no es de este acorde`, look: null };
  const long = `${heard}: ¿es ${chordLabel(look)} en vez de ${chordLabel(name)}?`;
  return { text: long.length <= 50 ? long : `${heard}: ¿es ${look} en vez de ${name}?`, look };
}

/** Reads a chord verdict; `analysis` undefined (pitch-only judging) gives a plain result. */
export function chordFeedback(name: string, analysis: ChordAnalysis | undefined, ok: boolean): ChordFeedback {
  const a = analysis;
  const missing = a ? missingStrings(name, a.missing) : [];
  const diagram = chordDiagram(name);
  const presentStrings = a ? diagram.strings.filter((s) => s.midi !== null && a.present.includes(s.midi)).map((s) => s.string) : [];
  const missingStringIdx = missing.flatMap((m) => m.strings);
  const f = a ? foreignMessage(name, a.contradicted, a.present) : { text: '', look: null };
  return {
    ok,
    clean: !!a && ok && a.cleanliness >= CLEAN_THRESHOLD,
    cleanliness: a?.cleanliness ?? (ok ? 1 : 0),
    missing,
    presentStrings,
    missingStringIdx,
    foreign: a ? [...new Set(a.contradicted.map((m) => noteName(m)))] : [],
    lookAlike: f.look,
    missingText: a ? missingMessage(name, a.missing) : '',
    foreignText: f.text,
  };
}
