/**
 * Deterministic "player" for a session driven by a FakeInput: plays an exercise in virtual time. Used by
 * unit tests and, through `window.__metalforge.fake`, by browser automation.
 */
import type { Target } from '../model/exercise';
import { fakePluck, type FakeInput } from './input';
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
    fake.inject(fakePluck(time, midiFor(t)));
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
  };
}
