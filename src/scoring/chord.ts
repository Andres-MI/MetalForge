/**
 * Chord verification seam.
 *
 * The detector only reports one pitch per attack, so a chord cannot be transcribed. For now the Judge
 * asks a ChordVerifier whether what was heard is compatible with the chord. The default verifier
 * (`pitchChordVerifier`) accepts when any detected note is a chord tone (by pitch class).
 *
 * LATER PHASE: a spectral verifier (energy at each expected chord tone, from the audio of the strum)
 * implements this same interface. It can read extra data added to `ChordHearing` (e.g. an audio
 * snapshot) without changing the Judge.
 */
import type { TargetKind } from '../model/exercise';
import { chordSet } from './chordSet';

export type ChordKind = Extract<TargetKind, { type: 'chord' }>;

export interface ChordHearing {
  /** Seconds, the attack of the strum. */
  onsetTime: number;
  /** MIDI notes the detector reported for that attack (may be empty). */
  notes: number[];
  /** What the spectral check of that strum found (the detector's `strum` event), when it arrived. */
  strum?: { strengths: Record<number, number>; shadowed?: number[] };
}

/** ok = compatible with the chord, wrong = clearly something else, unknown = nothing to judge by. */
export type ChordVerdict = 'ok' | 'wrong' | 'unknown';

/** What the spectral check says about one strum. */
export interface ChordAnalysis {
  verdict: ChordVerdict;
  /** Required notes that did not sound (a muted or unfretted string), ascending. Shadowed ones are never listed. */
  missing: number[];
  /** Notes of another chord that did sound. */
  contradicted: number[];
  /** Required notes that did sound. */
  present: number[];
  /** 0..1: all tones even and strong, no foreign notes. The arcade games can reward >= 0.85 as a critical hit. */
  cleanliness: number;
}

export interface ChordVerifier {
  verify(chord: ChordKind, heard: ChordHearing): ChordVerdict;
  /** Optional detail of the verdict (missing tones, cleanliness); the Judge attaches it to the result. */
  analyze?(chord: ChordKind, heard: ChordHearing): ChordAnalysis | null;
}

export const pitchChordVerifier: ChordVerifier = {
  verify(chord, heard) {
    if (!heard.notes.length) return 'unknown';
    const tones = new Set(chord.midis.map((m) => ((m % 12) + 12) % 12));
    return heard.notes.some((m) => tones.has(((m % 12) + 12) % 12)) ? 'ok' : 'wrong';
  },
};

/**
 * Thresholds of the spectral verifier. Strengths are relative (1 = as clear as the 2nd strongest candidate,
 * 0 = 30 dB below it, see detection/chord.ts), so these are fractions of that scale. TUNE THEM on a real guitar.
 */
export const CHORD_THRESHOLDS = {
  /** A required tone counts as sounding from this strength (0.5 = 15 dB under the reference). */
  present: 0.5,
  /** A contradicting note counts as sounding from this strength. */
  contradicting: 0.6,
  /** Required tones allowed to be missing. 0 = all of them; the design's fallback is "root plus two more tones". */
  maxMissing: 0,
};

/** Reads the detector's strengths against a chord. Returns null when the strum event did not arrive. */
export function analyzeChord(chord: ChordKind, heard: ChordHearing, th = CHORD_THRESHOLDS): ChordAnalysis | null {
  if (!heard.strum) return null;
  const { strengths } = heard.strum;
  const shadowed = new Set(heard.strum.shadowed ?? []);
  const set = chordSet(chord);
  const s = (m: number) => strengths[m] ?? 0;
  const judged = set.required.filter((m) => !shadowed.has(m));
  const present = set.required.filter((m) => s(m) >= th.present);
  const missing = judged.filter((m) => s(m) < th.present);
  const contradicted = set.contradicting.filter((m) => !shadowed.has(m) && s(m) >= th.contradicting);
  const verdict: ChordVerdict = missing.length <= th.maxMissing && contradicted.length === 0 ? 'ok' : 'wrong';
  const vals = (judged.length ? judged : set.required).map(s);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const worstForeign = Math.max(0, ...set.contradicting.filter((m) => !shadowed.has(m)).map(s));
  const cleanliness = Math.max(0, Math.min(1, (0.5 * mean + 0.5 * Math.min(...vals)) * (1 - worstForeign)));
  return { verdict, missing, contradicted, present, cleanliness };
}

/** Spectral when the strum's analysis is available, by pitch class otherwise. */
export const spectralChordVerifier: ChordVerifier = {
  verify(chord, heard) {
    return analyzeChord(chord, heard)?.verdict ?? pitchChordVerifier.verify(chord, heard);
  },
  analyze: (chord, heard) => analyzeChord(chord, heard),
};
