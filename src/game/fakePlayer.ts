/**
 * Deterministic "player" for a session driven by a FakeInput: plays an exercise in virtual time. Used by
 * unit tests and, through `window.__metalforge.fake`, by browser automation.
 */
import { CHORDS, chordShape } from '../exercises/chords';
import type { Target } from '../model/exercise';
import { INSTRUMENTS, midiAt } from '../model/instrument';
import type { ChordKind } from '../scoring/chord';
import { fakeChord, fakePluck, type FakeInput } from './input';
import type { GameSession } from './session';

export interface FakePlayOptions {
  /** Every pluck lands this many ms after its ideal moment (negative = early). Default 0. */
  offsetMs?: number;
  /** Indices of targets that are NOT played. */
  skip?: number[];
  /** Per-target extra ms (index -> ms), added to `offsetMs`. */
  jitterMs?: Record<number, number>;
  /** Extra sounds that match no target, in beats (e.g. 0.5 between two quarters). */
  strayBeats?: number[];
  /** Stop advancing when this beat is reached (mid-play screenshots). Default: run until the round ends. */
  untilBeat?: number;
  /** Virtual time step in seconds. Default 0.02. */
  step?: number;
}

function midiFor(t: Target): number | undefined {
  const k = t.kind;
  if (k.type === 'note') return k.midi;
  if (k.type === 'anyOf') return k.midis[0];
  return undefined;
}

/** Injects the plucks for the exercise and advances virtual time. Starts the session if needed. */
export function playFake(session: GameSession, fake: FakeInput, opts: FakePlayOptions = {}): void {
  if (session.clock.state === 'idle') session.start();
  const clock = session.clock;
  const skip = new Set(opts.skip ?? []);
  let lastTime = clock.beatToTime(0);
  session.exercise.targets.forEach((t, i) => {
    const ideal = clock.beatToTime(t.beat ?? 0);
    lastTime = Math.max(lastTime, ideal);
    if (skip.has(i)) return;
    const time = ideal + ((opts.offsetMs ?? 0) + (opts.jitterMs?.[i] ?? 0)) / 1000;
    lastTime = Math.max(lastTime, time);
    fake.inject(t.kind.type === 'chord' ? fakeChord(time, t.kind) : fakePluck(time, midiFor(t)));
  });
  for (const b of opts.strayBeats ?? []) fake.inject(fakePluck(clock.beatToTime(b)));
  const end = opts.untilBeat !== undefined ? clock.beatToTime(opts.untilBeat) : lastTime + 3;
  const step = opts.step ?? 0.02;
  while (fake.now() < end && !(opts.untilBeat === undefined && session.finished)) fake.advance(step);
}

/** What `window.__metalforge.fake` exposes. */
export interface FakeControl {
  /** Current virtual time (context seconds). */
  now(): number;
  /** Current beat (fractional, negative in the count-in). */
  beat(): number;
  advance(seconds: number): void;
  advanceToBeat(beat: number): void;
  play(opts?: FakePlayOptions): void;
  /** Beats of the exercise's targets, to build custom plays. */
  targetBeats(): number[];
  /** Injects a pluck at a beat (+ms) without advancing. */
  pluckAt(beat: number, offsetMs?: number): void;
  bpm(): number;
  /** Injects a pluck of `midi` (a note the detector would report) `afterSeconds` from now, without advancing. */
  pluckNote(midi: number, afterSeconds?: number): void;
  /** Injects a pluck right now (+ `afterSec`) with a pitch, without advancing: advance ~0.1 s afterwards so it is heard. */
  pluck(midi?: number, afterSec?: number): void;
  /**
   * Strums a chord as the real detector would report it (`fakeChord`): the one the session waits for, or `name`.
   * `mutedStrings` = string indices of the shape that do not sound, `foreign` = MIDI notes of another chord that do.
   * Injected at now + `afterSec`, without advancing: advance ~0.3 s afterwards so the verdict arrives.
   */
  strum(opts?: { name?: string; mutedStrings?: number[]; foreign?: number[]; afterSec?: number }): void;
  /** Candidates the session gave the input for the chord it waits for ({required, contradicting} MIDI lists). */
  candidates(): { required: number[]; contradicting: number[] };
}

export function makeFakeControl(session: GameSession, fake: FakeInput): FakeControl {
  return {
    now: () => fake.now(),
    beat: () => session.clock.timeToBeat(fake.now()),
    advance: (s) => fake.advance(s),
    advanceToBeat(beat) {
      if (session.clock.state === 'idle') session.start();
      fake.advanceTo(session.clock.beatToTime(beat));
    },
    play: (o) => playFake(session, fake, o),
    targetBeats: () => session.exercise.targets.map((t) => t.beat ?? 0),
    pluckAt: (beat, ms = 0) => fake.inject(fakePluck(session.clock.beatToTime(beat) + ms / 1000)),
    bpm: () => session.clock.bpm,
    pluckNote: (midi, after = 0) => fake.inject(fakePluck(fake.now() + after, midi)),
    pluck: (midi, afterSec = 0) => fake.inject(fakePluck(fake.now() + afterSec, midi)),
    strum(opts = {}) {
      let chord: ChordKind | undefined;
      if (opts.name) {
        if (!CHORDS[opts.name]) throw new Error(`unknown chord ${opts.name}`);
        const shape = chordShape(opts.name);
        chord = { type: 'chord', name: opts.name, midis: shape.map((p) => midiAt(INSTRUMENTS.guitar, p)), shape };
      } else {
        const k = session.exercise.targets[session.currentIndex]?.kind;
        if (k?.type === 'chord') chord = k;
      }
      if (!chord) throw new Error('strum: the session is not waiting for a chord');
      const muted = (opts.mutedStrings ?? []).flatMap((s) => (chord!.shape ?? []).filter((p) => p.string === s).map((p) => midiAt(INSTRUMENTS[session.exercise.instrument], p)));
      // An untimed exercise ignores attacks before its start: never inject before the first moment the Judge listens.
      const earliest = session.exercise.timed ? -Infinity : session.clock.beat0Time + 0.05;
      fake.inject(fakeChord(Math.max(earliest, fake.now() + (opts.afterSec ?? 0)), chord, { muted, foreign: opts.foreign }));
    },
    candidates: () => ({ required: [...fake.chordCandidates.required], contradicting: [...fake.chordCandidates.contradicting] }),
  };
}
