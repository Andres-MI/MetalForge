/**
 * Chord bench (part of bench-lib): strums of every chord of the game's list, checked against the expected
 * chord with the real Detector + spectral verifier. Re-exported from bench-lib.ts.
 *
 * Per chord: (a) the right chord, (b) the same chord with one string left out, (c) each nearest wrong chord.
 * Strums: 8-15 ms between strings, down and up, soft and hard, +-10 cents of detune per string, white noise in
 * some, and in some the previous chord (a different one) still ringing.
 */
import { Detector, type DetectorEvent } from '../src/detection/detector';
import { CHORDS } from '../src/exercises/chords';
import { INSTRUMENTS, pitchRange } from '../src/model/instrument';
import { analyzeChord, type ChordAnalysis, type ChordKind } from '../src/scoring/chord';
import { chordSet } from '../src/scoring/chordSet';
import { renderPlucks, rng, type PluckedNote } from '../src/synth/karplus';

const SR = 48000;
const GUITAR = INSTRUMENTS.guitar;

/** Chords the game does not have but are the natural wrong neighbour of one it has (minor twins of D and F). */
const EXTRA_SHAPES: Record<string, number[]> = { Dm: [-1, -1, 0, 2, 3, 1], Fm: [1, 3, 3, 1, 1, 1] };

/** Guitar notes of a chord of the list (or of an extra bench shape), one per played string. */
export function shapeOf(name: string): { string: number; midi: number }[] {
  const frets = CHORDS[name]?.frets ?? EXTRA_SHAPES[name];
  const out: { string: number; midi: number }[] = [];
  frets.forEach((f, string) => {
    if (f >= 0) out.push({ string, midi: GUITAR.openStrings[string] + f });
  });
  return out;
}

const pcOf = (m: number) => ((m % 12) + 12) % 12;

/** Chords a player could strum instead of `name`: the list's chords sharing 2+ pitch classes, plus the minor twin of D and F. */
export function nearestWrong(name: string): string[] {
  const mine = new Set(shapeOf(name).map((n) => pcOf(n.midi)));
  const out: string[] = [];
  for (const other of Object.keys(CHORDS)) {
    if (other === name) continue;
    const theirs = new Set(shapeOf(other).map((n) => pcOf(n.midi)));
    let shared = 0;
    for (const p of theirs) if (mine.has(p)) shared++;
    const sameSet = theirs.size === mine.size && [...theirs].every((p) => mine.has(p));
    if (shared >= 2 && !sameSet) out.push(other);
  }
  if (name === 'D') out.push('Dm');
  if (name === 'F') out.push('Fm');
  return [...new Set(out)];
}

export type ChordCase = 'correct' | 'muted' | 'wrong';

export interface ChordTrial {
  chord: string;
  kind: ChordCase;
  /** Chord that was actually strummed. */
  played: string;
  /** For `muted`: the string left out and its note. */
  mutedString?: number;
  mutedMidi?: number;
  /** The muted note's pitch class also sounds on another string of the shape (an octave double: it cannot be told missing). */
  doubled?: boolean;
  variant: string;
  noise: number;
  plucks: PluckedNote[];
  /** Time of the first pluck of the strum under test. */
  at: number;
  duration: number;
}

interface StrumStyle {
  down: boolean;
  hard: boolean;
  ringing: string | null;
  noise: number;
}

function strumPlucks(name: string, at: number, style: Pick<StrumStyle, 'down' | 'hard'>, rand: () => number, omit?: number): PluckedNote[] {
  let shape = shapeOf(name).filter((n) => n.string !== omit);
  if (!style.down) shape = [...shape].reverse();
  let t = at;
  return shape.map((n, i) => {
    if (i > 0) t += 0.008 + rand() * 0.007;
    const base = style.hard ? 0.9 : 0.45;
    return { time: t, midi: n.midi, string: n.string, detune: (rand() * 2 - 1) * 10, velocity: base * (0.85 + 0.3 * rand()) };
  });
}

function styleFor(v: number, others: string[]): StrumStyle {
  return { down: v % 2 === 0, hard: (v >> 1) % 2 === 1, ringing: (v >> 2) % 2 === 1 ? others[v % others.length] : null, noise: (v >> 3) % 2 === 1 ? 0.006 : 0 };
}

const describeStyle = (s: StrumStyle) => `${s.down ? 'bajada' : 'subida'}, ${s.hard ? 'fuerte' : 'suave'}${s.ringing ? `, suena ${s.ringing}` : ''}${s.noise ? ', ruido' : ''}`;

/** All the chord trials: per chord, the right strum, one string muted at a time, and each nearest wrong chord. */
export function chordTrials(perCase = 16): ChordTrial[] {
  const trials: ChordTrial[] = [];
  const names = Object.keys(CHORDS);
  names.forEach((chord, ci) => {
    const others = names.filter((n) => n !== chord);
    const make = (kind: ChordCase, played: string, v: number, omit?: number): ChordTrial => {
      const rand = rng(1000 * (ci + 1) + 37 * v + (omit ?? 0) * 5 + played.length * 3 + (kind === 'wrong' ? 99 : 0));
      const style = styleFor(v, others);
      // The previous chord rings for 0.5 s (a quick change) or 1.3 s before this strum.
      const at = style.ringing ? 0.3 + (v % 3 === 0 ? 0.5 : 1.3) : 0.5;
      const plucks: PluckedNote[] = [];
      if (style.ringing) plucks.push(...strumPlucks(style.ringing, 0.3, { down: true, hard: true }, rand));
      const strum = strumPlucks(played, at, style, rand, omit);
      plucks.push(...strum);
      const muted = omit === undefined ? undefined : shapeOf(played).find((n) => n.string === omit)!;
      return {
        chord,
        kind,
        played,
        mutedString: omit,
        mutedMidi: muted?.midi,
        doubled: muted ? shapeOf(played).some((n) => pcOf(n.midi) === pcOf(muted.midi) && n.string !== omit) : undefined,
        variant: describeStyle(style),
        noise: style.noise,
        plucks,
        at: strum[0].time,
        duration: at + 0.9,
      };
    };
    for (let v = 0; v < perCase; v++) trials.push(make('correct', chord, v));
    const strings = shapeOf(chord).map((n) => n.string);
    strings.forEach((s, k) => {
      for (let v = 0; v < Math.max(2, Math.round(perCase / 4)); v++) trials.push(make('muted', chord, v * 5 + k * 3, s));
    });
    const wrongs = nearestWrong(chord);
    wrongs.forEach((w, k) => {
      for (let v = 0; v < Math.max(4, Math.round((perCase * 2) / Math.max(1, wrongs.length))); v++) trials.push(make('wrong', w, v + k * 3));
    });
  });
  return trials;
}

export interface ChordOutcome {
  trial: ChordTrial;
  analysis: ChordAnalysis | null;
  /** Milliseconds from the first pluck of the strum to the `strum` event. */
  latencyMs: number | null;
  strengths: Record<number, number> | null;
}

export function chordKind(name: string): ChordKind {
  return { type: 'chord', name, midis: shapeOf(name).map((n) => n.midi) };
}

export function runChordTrial(trial: ChordTrial, chunk = 128): ChordOutcome {
  const audio = renderPlucks(trial.plucks, { sampleRate: SR, duration: trial.duration, noise: trial.noise, seed: 7 });
  const kind = chordKind(trial.chord);
  const det = new Detector({ sampleRate: SR, windowSize: GUITAR.windowSize, ...pitchRange(GUITAR) });
  det.setExpected(kind.midis);
  const set = chordSet(kind);
  det.setChordCandidates(set.required, set.contradicting);
  let strum: Extract<DetectorEvent, { type: 'strum' }> | null = null;
  for (let i = 0; i < audio.length; i += chunk) {
    for (const e of det.process(audio.subarray(i, i + chunk))) {
      if (e.type === 'strum' && Math.abs(e.time - trial.at) < 0.04) strum = strum ?? e;
    }
  }
  if (!strum) return { trial, analysis: null, latencyMs: null, strengths: null };
  const analysis = analyzeChord(kind, { onsetTime: strum.time, notes: [], strum });
  return { trial, analysis, latencyMs: (strum.emittedAt - trial.at) * 1000, strengths: strum.strengths };
}

export interface ChordRow {
  chord: string;
  correct: { n: number; accepted: number };
  wrong: { n: number; rejected: number };
  /** n: all muted-string cases; nUnique: those whose note is not doubled (by pitch class) on another string. */
  muted: { n: number; rejected: number; identified: number; nUnique: number; identifiedUnique: number; nDoubled: number; identifiedDoubled: number };
  latency: { mean: number; p95: number; max: number };
}

export function runChordBench(perCase = 16): { rows: ChordRow[]; outcomes: ChordOutcome[] } {
  const outcomes = chordTrials(perCase).map((t) => runChordTrial(t));
  const rows: ChordRow[] = [];
  for (const chord of Object.keys(CHORDS)) {
    const mine = outcomes.filter((o) => o.trial.chord === chord);
    const correct = mine.filter((o) => o.trial.kind === 'correct');
    const wrong = mine.filter((o) => o.trial.kind === 'wrong');
    const muted = mine.filter((o) => o.trial.kind === 'muted');
    const unique = muted.filter((o) => !o.trial.doubled);
    const identified = (o: ChordOutcome) => !!o.analysis && o.analysis.verdict === 'wrong' && o.analysis.missing.includes(o.trial.mutedMidi!);
    const lat = mine.map((o) => o.latencyMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
    rows.push({
      chord,
      correct: { n: correct.length, accepted: correct.filter((o) => o.analysis?.verdict === 'ok').length },
      wrong: { n: wrong.length, rejected: wrong.filter((o) => o.analysis?.verdict === 'wrong').length },
      muted: {
        n: muted.length,
        rejected: muted.filter((o) => o.analysis && o.analysis.verdict === 'wrong').length,
        identified: muted.filter(identified).length,
        nUnique: unique.length,
        identifiedUnique: unique.filter(identified).length,
        nDoubled: muted.length - unique.length,
        identifiedDoubled: muted.filter((o) => o.trial.doubled).filter(identified).length,
      },
      latency: { mean: lat.reduce((a, b) => a + b, 0) / (lat.length || 1), p95: lat[Math.floor(lat.length * 0.95)] ?? NaN, max: lat[lat.length - 1] ?? NaN },
    });
  }
  return { rows, outcomes };
}
