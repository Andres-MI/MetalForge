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

export type ChordKind = Extract<TargetKind, { type: 'chord' }>;

export interface ChordHearing {
  /** Seconds, the attack of the strum. */
  onsetTime: number;
  /** MIDI notes the detector reported for that attack (may be empty). */
  notes: number[];
}

/** ok = compatible with the chord, wrong = clearly something else, unknown = nothing to judge by. */
export type ChordVerdict = 'ok' | 'wrong' | 'unknown';

export interface ChordVerifier {
  verify(chord: ChordKind, heard: ChordHearing): ChordVerdict;
}

export const pitchChordVerifier: ChordVerifier = {
  verify(chord, heard) {
    if (!heard.notes.length) return 'unknown';
    const tones = new Set(chord.midis.map((m) => ((m % 12) + 12) % 12));
    return heard.notes.some((m) => tones.has(((m % 12) + 12) % 12)) ? 'ok' : 'wrong';
  },
};
