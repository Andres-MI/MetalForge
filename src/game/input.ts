/**
 * GameInput: where a GameSession gets detector events and the time from. Two implementations:
 * the real microphone (`openAudioInput`) and `FakeInput`, a virtual-time source that tests and browser
 * automation drive by hand. Events are always DetectorEvents with times on the "context timeline".
 */
import type { DetectorEvent } from '../detection/detector';
import type { Instrument } from '../model/instrument';
import type { ChordKind } from '../scoring/chord';
import { chordSet } from '../scoring/chordSet';
import { startInput, type InputHandle } from '../audio/input';
import type { TimeSource } from './clock';

export type InputListener = (events: DetectorEvent[], upTo: number) => void;

export interface GameInput extends TimeSource {
  readonly kind: 'audio' | 'fake';
  /** AudioContext for the metronome; null for the fake. */
  readonly context: AudioContext | null;
  /** Context time of the first captured sample (null if unknown). Calibration aligns its beats to it. */
  captureStart(): number | null;
  /** Calls back with the events found since the last call and `upTo` (all audio before it was analysed). */
  subscribe(cb: InputListener): () => void;
  /** Seconds to subtract from `now()` to get what the player currently HEARS (device output latency); 0 if unknown. */
  outputLatency(): number;
  /** Tells the detector which MIDI notes the exercise uses (last-resort help); empty clears it. */
  setExpected?(midis: number[]): void;
  /**
   * Chord to check after every attack (tones + notes of other chords); the input then delivers `strum` events.
   * Its presence means "this input can verify chords spectrally": the session then waits for them.
   */
  setChordCandidates?(required: number[], contradicting: number[]): void;
  /** Audio chain diagnostics (seconds), real input only. */
  info?(): { lag: number; base: number; output: number };
  stop(): void;
}

export async function openAudioInput(inst: Instrument): Promise<GameInput> {
  const listeners = new Set<InputListener>();
  let stopped = false;
  let buffer: DetectorEvent[] = [];
  const handle: InputHandle = await startInput(
    inst,
    (e) => buffer.push(e),
    (upTo) => {
      const events = buffer;
      buffer = [];
      listeners.forEach((l) => l(events, upTo));
    },
  );
  return {
    kind: 'audio',
    context: handle.context,
    now: () => handle.context.currentTime,
    captureStart: () => handle.captureStart(),
    outputLatency: () => {
      const l = handle.latencies();
      return l.output || l.base;
    },
    info: () => ({ lag: handle.lag(), ...handle.latencies() }),
    setExpected: (midis) => handle.setExpected(midis),
    setChordCandidates: (required, contradicting) => handle.setChordCandidates(required, contradicting),
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    // Idempotent: the sessions of a multi-round game share one input and each may close it.
    stop: () => {
      if (stopped) return;
      stopped = true;
      handle.stop();
    },
  };
}

/**
 * Virtual-time input. Nothing advances until `advance`/`advanceTo` is called. Events are given with their
 * own `time`; they are delivered when the virtual time reaches `emittedAt` (notes) or `time`.
 */
export class FakeInput implements GameInput {
  readonly kind = 'fake' as const;
  readonly context = null;
  private t = 0;
  private readonly listeners = new Set<InputListener>();
  private pending: DetectorEvent[] = [];
  /** Last expected notes the session set (tests read it). */
  expected: number[] = [];
  setExpected(midis: number[]): void {
    this.expected = [...midis];
  }
  /** Last chord candidates the session set (tests read it). */
  chordCandidates: { required: number[]; contradicting: number[] } = { required: [], contradicting: [] };
  setChordCandidates(required: number[], contradicting: number[]): void {
    this.chordCandidates = { required: [...required], contradicting: [...contradicting] };
  }

  now(): number {
    return this.t;
  }
  captureStart(): number | null {
    return 0;
  }
  outputLatency(): number {
    return 0;
  }
  subscribe(cb: InputListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  stop(): void {
    this.listeners.clear();
  }

  /** Queues events to be delivered once virtual time reaches them. */
  inject(events: DetectorEvent[]): void {
    this.pending.push(...events);
    this.pending.sort((a, b) => deliveredAt(a) - deliveredAt(b));
  }

  /** Forgets queued events not delivered yet (a round was abandoned). */
  clearPending(): void {
    this.pending = [];
  }

  /** Moves virtual time forward (never back), delivering what is due. */
  advanceTo(time: number): void {
    if (time < this.t) return;
    // Deliver in order, stopping the virtual clock at each event so listeners see consistent times.
    while (this.pending.length && deliveredAt(this.pending[0]) <= time) {
      const e = this.pending.shift()!;
      this.t = Math.max(this.t, deliveredAt(e));
      this.emit([e]);
    }
    this.t = time;
    this.emit([]);
  }

  advance(seconds: number): void {
    this.advanceTo(this.t + seconds);
  }

  private emit(events: DetectorEvent[]): void {
    this.listeners.forEach((l) => l(events, this.t));
  }
}

function deliveredAt(e: DetectorEvent): number {
  return e.type === 'note' || e.type === 'strum' ? e.emittedAt : e.time;
}

/** An onset (and optionally the note that follows) at a context time, shaped like the real detector's output. */
export function fakePluck(time: number, midi?: number, opts: { rms?: number; detectionDelay?: number } = {}): DetectorEvent[] {
  const out: DetectorEvent[] = [{ type: 'onset', time, rms: opts.rms ?? 0.3 }];
  if (midi !== undefined) {
    out.push({ type: 'note', time, emittedAt: time + (opts.detectionDelay ?? 0.04), freq: 440 * Math.pow(2, (midi - 69) / 12), midi, clarity: 0.95 });
  }
  return out;
}

/**
 * The events of a strummed chord as the real detector would report them: the attack, the chord's first note and the
 * `strum` event with a strength per candidate. `muted` lists tones that did not sound, `foreign` notes of another chord
 * that did. `level` (default 1) is the strength of the tones that do sound: 0.5-0.85 gives a chord that is accepted but not clean.
 * Without `muted`/`foreign` it is a perfect strum.
 */
export function fakeChord(time: number, chord: ChordKind, opts: { muted?: number[]; foreign?: number[]; rms?: number; detectionDelay?: number; level?: number } = {}): DetectorEvent[] {
  const set = chordSet(chord);
  const strengths: Record<number, number> = {};
  for (const m of set.required) strengths[m] = opts.muted?.includes(m) ? 0 : opts.level ?? 1;
  for (const m of set.contradicting) strengths[m] = opts.foreign?.includes(m) ? 1 : 0;
  const first = fakePluck(time, chord.midis[0], { rms: opts.rms });
  return [...first, { type: 'strum', time, emittedAt: time + (opts.detectionDelay ?? 0.23), strengths, shadowed: [] }];
}
