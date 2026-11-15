/**
 * GameSession: the glue between an input (microphone or fake), the game clock, an Exercise, the Judge and a
 * scene. A scene only subscribes to typed events and reads `session.beat()` to draw.
 *
 * Time: the Judge works in "game seconds" = context seconds - `clock.beat0Time` (so beat 0 is time 0).
 * Detector events arrive in context seconds and are converted here. The calibrated latency goes to the
 * Judge as `latencyOffset`, so `ScoredTarget.delta` is already corrected.
 *
 * Life cycle: `new GameSession(...)` -> `on(...)` -> `start()` -> events -> `finished` (mastery saved) ->
 * `dispose()` (always call it when the scene shuts down; it closes the input).
 *
 * Games made of several rounds (Salto) chain sessions on the SAME input: `release()` the finished or abandoned
 * one (it keeps the input open) and `spawn(exercise)` the next; only the last one is `dispose()`d.
 */
import type { DetectorEvent } from '../detection/detector';
import type { Exercise } from '../model/exercise';
import { emptyMastery, updateMastery, type Mastery } from '../progress';
import { Judge } from '../scoring/judge';
import type { RoundSummary, ScoredTarget } from '../scoring/types';
import { GameClock } from './clock';
import { expectedMidis } from './expected';
import type { GameInput } from './input';
import { Metronome, AudioClickSink, type ClickSink } from './metronome';
import type { MasteryStore } from './progressBlob';

export interface SessionEvents {
  /** A count-in beat begins: 1..countInBeats. */
  countIn: (beat: number) => void;
  /** The count-in ended: beat 0 has arrived. */
  go: () => void;
  /** A target has its final result (hit, early, late, wrong or miss). */
  targetResolved: (r: ScoredTarget) => void;
  /** Untimed exercises: a wrong note was played; the target keeps waiting. */
  wrongAttempt: (r: ScoredTarget) => void;
  /** A detected sound matched no target (timed exercises). */
  stray: () => void;
  /** Every onset/note the detector reported, for visuals (`time` is on the context timeline). */
  heard: (e: DetectorEvent) => void;
  /** The round ended; mastery has been updated (and saved when a store was given). */
  finished: (summary: RoundSummary, results: ScoredTarget[]) => void;
}

type Listeners = { [K in keyof SessionEvents]?: SessionEvents[K][] };

export interface SessionOptions {
  exercise: Exercise;
  input: GameInput;
  /** Calibrated latency in seconds (settings.latencyOffset). Default 0. */
  latencyOffset?: number;
  /** Beats of count-in. Default 4 for timed exercises, 0 otherwise. */
  countInBeats?: number;
  /** Metronome on/volume; only audible with a real input. Default on, 0.6. */
  metronome?: { on?: boolean; volume?: number };
  /** Replace the click sound (tests). Default: Web Audio clicks when the input has a context. */
  clickSink?: ClickSink;
  mastery?: MasteryStore;
  /** Wall-clock milliseconds for mastery timestamps (not musical time). Default Date.now. */
  wallClock?: () => number;
  /** Real input only: how often the session ticks. Default 30 ms. A fake input ticks when it advances. */
  tickMs?: number;
}

export class GameSession {
  readonly exercise: Exercise;
  readonly input: GameInput;
  readonly clock: GameClock;
  readonly metronome: Metronome;
  private readonly judge: Judge;
  private readonly store?: MasteryStore;
  private readonly wall: () => number;
  private readonly listeners: Listeners = {};
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly tickMs: number;
  private readonly countInBeats: number;
  private readonly latency: number;
  private lastUpTo = -Infinity;
  private countInShown = 0;
  private wentSignalled = false;
  private strays = 0;
  private _finished = false;
  private _summary: RoundSummary | null = null;
  private disposed = false;
  private released = false;
  private readonly opts: SessionOptions;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.exercise = opts.exercise;
    this.input = opts.input;
    this.latency = opts.latencyOffset ?? 0;
    this.countInBeats = opts.countInBeats ?? (opts.exercise.timed ? 4 : 0);
    this.clock = new GameClock(opts.input);
    this.store = opts.mastery;
    this.wall = opts.wallClock ?? Date.now;
    this.tickMs = opts.tickMs ?? 30;
    this.judge = new Judge(opts.exercise, { startTime: 0, latencyOffset: this.latency });
    const sink = opts.clickSink ?? (opts.input.context ? new AudioClickSink(opts.input.context) : { click() {} });
    this.metronome = new Metronome(this.clock, sink, { volume: opts.metronome?.volume, muted: opts.metronome?.on === false });
  }

  on<K extends keyof SessionEvents>(event: K, fn: SessionEvents[K]): () => void {
    const list = (this.listeners[event] ??= []) as SessionEvents[K][];
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  private emit<K extends keyof SessionEvents>(event: K, ...args: Parameters<SessionEvents[K]>): void {
    for (const fn of [...((this.listeners[event] ?? []) as ((...a: unknown[]) => void)[])]) fn(...args);
  }

  get finished(): boolean {
    return this._finished;
  }
  get summary(): RoundSummary | null {
    return this._summary;
  }
  get calibratedLatency(): number {
    return this.latency;
  }

  /** Starts the clock (count-in first), the metronome and listening. */
  start(): void {
    if (this.clock.state !== 'idle') return;
    this.clock.start({ bpm: this.exercise.bpm ?? 60, countInBeats: this.countInBeats });
    this.unsubscribe = this.input.subscribe((events, upTo) => this.onInput(events, upTo));
    this.metronome.start();
    this.input.setExpected?.(expectedMidis(this.exercise));
    // A real input has no virtual driver: tick on a timer (it only polls; musical time comes from the clock).
    if (this.input.kind === 'audio') this.timer = setInterval(() => this.tick(), this.tickMs);
    this.tick();
  }

  pause(): void {
    this.clock.pause();
    this.metronome.stop();
  }

  resume(): void {
    if (this.clock.state !== 'paused') return;
    this.clock.resume();
    this.metronome.start();
  }

  /** Beat now, for drawing (frozen while paused; negative in the count-in). Compensates device output latency so
   *  the notes reach the hit line when the click is heard. */
  beat(): number {
    return this.clock.timeToBeat(this.clock.now() - this.input.outputLatency());
  }

  /**
   * A new, not started session on the same input, latency, mastery store and metronome setting (as it is now),
   * for the next round of a multi-round game. `release()` this one first.
   */
  spawn(exercise: Exercise, over: Partial<SessionOptions> = {}): GameSession {
    return new GameSession({
      ...this.opts,
      metronome: { on: !this.metronome.isMuted, volume: this.metronome.level },
      ...over,
      exercise,
      input: this.input,
    });
  }

  /** Stops this round (nothing more is judged or saved) but leaves the input open for a spawned session. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.metronome.stop();
    this.clock.stop();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Aborts the round without saving anything and closes the input. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.input.setExpected?.([]);
    this.input.stop();
  }

  private toGame(t: number): number {
    return this.clock.gameTime(t);
  }

  private onInput(events: DetectorEvent[], upTo: number): void {
    if (this._finished || this.clock.state !== 'running') return;
    this.lastUpTo = Math.max(this.lastUpTo, upTo);
    const mapped = events.map((e): DetectorEvent => {
      if (e.type === 'note') return { ...e, time: this.toGame(e.time), emittedAt: this.toGame(e.emittedAt) };
      return { ...e, time: this.toGame(e.time) };
    });
    for (const e of events) if (e.type !== 'pitch') this.emit('heard', e);
    this.handle(this.judge.push(mapped));
    this.countStrays();
    this.tick();
  }

  /** Polled by the timer (real input) or after every advance (fake input). Safe to call any time. */
  tick(): void {
    if (this._finished || this.clock.state !== 'running') return;
    const now = this.clock.now();
    // Count-in announcements.
    const beat = this.clock.timeToBeat(now);
    while (this.countInShown < this.countInBeats && beat >= -this.countInBeats + this.countInShown) {
      this.countInShown++;
      this.emit('countIn', this.countInShown);
    }
    if (!this.wentSignalled && beat >= 0) {
      this.wentSignalled = true;
      this.emit('go');
    }
    // Close silent targets: only as far as the audio has really been analysed (plus a little in case the
    // input stalls).
    const horizon = Math.min(now, this.lastUpTo + 0.5);
    this.handle(this.judge.advance(this.toGame(horizon)));
    this.countStrays();
    if (this.judge.done) void this.finish();
  }

  private handle(results: ScoredTarget[]): void {
    for (const r of results) this.emit(r.final ? 'targetResolved' : 'wrongAttempt', r);
  }

  private countStrays(): void {
    while (this.strays < this.judge.strayCount) {
      this.strays++;
      this.emit('stray');
    }
  }

  private finishing = false;

  private async finish(): Promise<void> {
    if (this.finishing || this._finished) return;
    this.finishing = true;
    this.handle(this.judge.finish());
    this.countStrays();
    const summary = this.judge.summary();
    const results = this.judge.results();
    this._summary = summary;
    try {
      if (this.store) {
        const before = await this.store.load().catch(() => emptyMastery() as Mastery);
        await this.store.save(updateMastery(before, results, this.wall()));
      }
    } finally {
      this._finished = true;
      this.metronome.stop();
      this.emit('finished', summary, results);
    }
  }
}
