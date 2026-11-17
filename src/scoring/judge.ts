/**
 * Judge: consumes DetectorEvents incrementally and yields one final result per target.
 *
 * Timed: target i is expected at `startTime + beat * 60 / bpm` (+ the calibrated latency). An event
 * within `hit` seconds is a hit; between `hit` and `outer` it is early/late; farther away it matches
 * nothing. A wrong pitch inside the window makes that target 'wrong'. One event satisfies one target.
 *
 * Untimed: the Judge waits for the current target. A wrong note is reported ('wrong', not final, with
 * what was heard) and the target stays; the right note resolves it with the reaction time as delta.
 *
 * Which event each kind listens to: attack = onset; note/pitchClass/anyOf = note (pitch);
 * chord = onset + the notes that follow it (see ChordVerifier). With `spectralChords` the Judge waits for the
 * detector's `strum` event of that attack (the audio check of the chord, ~230 ms after it) and the verifier reads it;
 * if it never comes the verdict falls back to the pitches heard.
 */
import type { DetectorEvent } from '../detection/detector';
import type { Exercise, Judgement, Target } from '../model/exercise';
import type { InstrumentId } from '../model/instrument';
import { pitchChordVerifier, spectralChordVerifier, type ChordAnalysis, type ChordHearing, type ChordKind, type ChordVerifier } from './chord';
import { summarize } from './summary';
import type { RoundSummary, ScoredTarget } from './types';

export interface Windows {
  /** +/- seconds around the ideal moment that count as a hit. */
  hit: number;
  /** +/- seconds in which an event is still attributed to the target (early/late). */
  outer: number;
  /** Extra seconds after `outer` before a silent target is declared missed (detection lag). */
  grace: number;
  /** Seconds after a strum's attack in which its notes are collected. */
  chord: number;
}

export const WINDOWS_GUITAR: Windows = { hit: 0.09, outer: 0.2, grace: 0.25, chord: 0.25 };
/** Low notes take longer to recognise, so the bass gets wider windows. */
export const WINDOWS_BASS: Windows = { hit: 0.12, outer: 0.26, grace: 0.3, chord: 0.3 };

export function windowsFor(instrument: InstrumentId): Windows {
  return instrument === 'guitar' ? WINDOWS_GUITAR : WINDOWS_BASS;
}

/**
 * Floors of the clamp below. Detection needs at least about this much slack: the onset detector places an attack
 * within ~20-30 ms of the real one, so a hit window narrower than +/-0.04 s would fail on correct playing, and an
 * outer window narrower than +/-0.08 s would leave no room for "early/late" feedback.
 */
export const MIN_HIT_WINDOW = 0.04;
export const MIN_OUTER_WINDOW = 0.08;
/** Fractions of the smallest gap between consecutive timed targets: a window must never reach the neighbour. */
export const HIT_GAP_FRACTION = 0.3;
export const OUTER_GAP_FRACTION = 0.6;

/** Smallest time (s) between two consecutive timed targets, or Infinity when there is none (untimed, one target). */
export function minTargetGap(exercise: Exercise): number {
  if (!exercise.timed || !exercise.bpm) return Infinity;
  const beats = exercise.targets.map((t) => t.beat ?? 0).sort((a, b) => a - b);
  let gap = Infinity;
  for (let i = 1; i < beats.length; i++) {
    const d = beats[i] - beats[i - 1];
    if (d > 1e-6) gap = Math.min(gap, d);
  }
  return (gap * 60) / exercise.bpm;
}

/**
 * The default windows of the instrument, narrowed so that `hit <= 0.3 x minGap` and `outer <= 0.6 x minGap`
 * (sixteenths at 75 bpm are 0.20 s apart: the bass +/-0.12 s hit window used to swallow the neighbouring note).
 * Never below MIN_HIT_WINDOW / MIN_OUTER_WINDOW, and never wider than the base.
 */
export function clampWindows(base: Windows, exercise: Exercise): Windows {
  const gap = minTargetGap(exercise);
  if (!Number.isFinite(gap)) return base;
  const hit = Math.min(base.hit, Math.max(MIN_HIT_WINDOW, HIT_GAP_FRACTION * gap));
  const outer = Math.min(base.outer, Math.max(MIN_OUTER_WINDOW, OUTER_GAP_FRACTION * gap, hit));
  return { ...base, hit, outer };
}

export interface JudgeOptions {
  /** Seconds (detector clock) of beat 0 (timed) or of the moment the first target appears (untimed). Default 0. */
  startTime?: number;
  /** Calibrated input latency in seconds: events are expected this much later than the ideal moment. */
  latencyOffset?: number;
  windows?: Partial<Windows>;
  chordVerifier?: ChordVerifier;
  /** What a chord attack with no identifiable pitch counts as. Default 'hit' (benefit of the doubt). */
  unknownChord?: 'hit' | 'wrong';
  /**
   * The input delivers `strum` events (the detector was given chord candidates): a chord attempt waits for its strum
   * and the default verifier is the spectral one. Default false: chords are judged by the pitches heard, as before.
   */
  spectralChords?: boolean;
  /** Seconds after an attack that a chord attempt waits for its `strum` event (spectral mode only). Default `windows.chord + 0.15`. */
  strumWait?: number;
}

interface Attempt {
  time: number; // raw detector time of the attack
  notes: number[];
  open: boolean;
  strum?: ChordHearing['strum'];
}

/** Attacks closer than this to an open chord attempt are more strings of the same strum (spectral mode). */
const STRUM_MERGE = 0.1;

const PITCHED = new Set(['note', 'pitchClass', 'anyOf']);

function matchesPitch(target: Target, midi: number): boolean {
  const k = target.kind;
  if (k.type === 'note') return k.midi === midi;
  if (k.type === 'pitchClass') return (((midi % 12) + 12) % 12) === k.pc;
  if (k.type === 'anyOf') return k.midis.includes(midi);
  return false;
}

export class Judge {
  private readonly ex: Exercise;
  private readonly win: Windows;
  private readonly start: number;
  private readonly latency: number;
  private readonly verifier: ChordVerifier;
  private readonly unknownAs: 'hit' | 'wrong';
  private readonly spectral: boolean;
  private readonly strumWait: number;
  private readonly finals: (ScoredTarget | undefined)[];
  private readonly wrongs: number[];
  private readonly attempts: Attempt[] = [];
  private readonly hasChords: boolean;
  private clock = -Infinity;
  private cursor = 0; // untimed
  private appeared: number; // untimed
  private strays = 0;

  constructor(exercise: Exercise, options: JudgeOptions = {}) {
    this.ex = exercise;
    this.win = { ...clampWindows(windowsFor(exercise.instrument), exercise), ...options.windows };
    this.start = options.startTime ?? 0;
    this.latency = options.latencyOffset ?? 0;
    this.spectral = options.spectralChords ?? false;
    this.verifier = options.chordVerifier ?? (this.spectral ? spectralChordVerifier : pitchChordVerifier);
    this.strumWait = options.strumWait ?? this.win.chord + 0.15;
    this.unknownAs = options.unknownChord ?? 'hit';
    this.finals = exercise.targets.map(() => undefined);
    this.wrongs = exercise.targets.map(() => 0);
    this.appeared = this.start;
    this.hasChords = exercise.targets.some((t) => t.kind.type === 'chord');
  }

  /** True when every target has a final result. */
  get done(): boolean {
    return this.finals.every((f) => f !== undefined);
  }

  /** Detected sounds so far that matched no target (same number `summary().strays` ends with). */
  get strayCount(): number {
    return this.strays;
  }

  /** Index of the target waiting for the player (untimed), or the first unresolved one (timed). */
  get currentIndex(): number {
    return this.ex.timed ? this.finals.findIndex((f) => !f) : this.cursor;
  }

  /** Feeds detector events (any chunking). Returns what happened because of them. */
  push(events: DetectorEvent[]): ScoredTarget[] {
    const out: ScoredTarget[] = [];
    for (const e of events) {
      if (e.type === 'pitch') continue;
      this.clock = Math.max(this.clock, e.type === 'note' || e.type === 'strum' ? e.emittedAt : e.time);
      if (e.type === 'onset') this.onOnset(e.time, out);
      else if (e.type === 'strum') this.onStrum(e, out);
      else this.onNote(e.time, e.midi, out);
    }
    this.expire(out);
    return out;
  }

  /** Tells the Judge what time it is on the detector clock, so silent targets can be closed as misses. */
  advance(now: number): ScoredTarget[] {
    const out: ScoredTarget[] = [];
    this.clock = Math.max(this.clock, now);
    this.expire(out);
    return out;
  }

  /** Untimed: the player gives up on the current target. */
  skipCurrent(): ScoredTarget[] {
    const out: ScoredTarget[] = [];
    if (!this.ex.timed && this.cursor < this.finals.length) {
      this.settle(this.cursor, 'miss', 0, out);
    }
    return out;
  }

  /** Ends the round: open chord attempts are judged and everything unresolved becomes a miss. */
  finish(): ScoredTarget[] {
    const out: ScoredTarget[] = [];
    this.closeAttempts(out, true);
    this.finals.forEach((f, i) => {
      if (!f) this.settle(i, 'miss', 0, out);
    });
    return out;
  }

  /** Final results so far, in target order. */
  results(): ScoredTarget[] {
    return this.finals.filter((f): f is ScoredTarget => f !== undefined);
  }

  summary(): RoundSummary {
    return summarize(this.results(), this.ex.targets.length, this.ex.timed, this.strays);
  }

  // ---- internals ----

  private expected(i: number): number {
    const t = this.ex.targets[i];
    return this.start + ((t.beat ?? 0) * 60) / (this.ex.bpm ?? 60);
  }

  private judgeDelta(delta: number): Judgement {
    return Math.abs(delta) <= this.win.hit ? 'hit' : delta < 0 ? 'early' : 'late';
  }

  private settle(i: number, judgement: Judgement, delta: number, out: ScoredTarget[], heard?: number[], chord?: ChordAnalysis): void {
    const r: ScoredTarget = {
      itemId: this.ex.targets[i].itemId,
      judgement,
      delta,
      index: i,
      final: true,
      wrongAttempts: this.wrongs[i],
      heard,
    };
    if (chord) r.chord = chord;
    this.finals[i] = r;
    out.push(r);
    if (!this.ex.timed && i === this.cursor) {
      this.cursor = i + 1;
    }
  }

  /** Untimed: a resolved target makes the next one appear at that moment. */
  private resolved(rawTime: number): void {
    this.appeared = Math.max(this.appeared, rawTime);
  }

  private wrongAttempt(i: number, heard: number[], out: ScoredTarget[], chord?: ChordAnalysis): void {
    this.wrongs[i]++;
    const r: ScoredTarget = {
      itemId: this.ex.targets[i].itemId,
      judgement: 'wrong',
      delta: 0,
      index: i,
      final: false,
      wrongAttempts: this.wrongs[i],
      heard,
    };
    if (chord) r.chord = chord;
    out.push(r);
  }

  private timedCandidates(rawTime: number, accept: (t: Target) => boolean): { i: number; delta: number }[] {
    const t = rawTime - this.latency;
    const c: { i: number; delta: number }[] = [];
    this.ex.targets.forEach((target, i) => {
      if (this.finals[i] || !accept(target)) return;
      const delta = t - this.expected(i);
      if (Math.abs(delta) <= this.win.outer) c.push({ i, delta });
    });
    return c.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  }

  private onOnset(time: number, out: ScoredTarget[]): void {
    // A new attack ends any strum still collecting notes ("no other onset intervenes"). In spectral mode the strings of one
    // strum can trigger several attacks within ~80 ms: those belong to the strum already open.
    const sameStrum = this.spectral && this.attempts.some((a) => a.open && time - a.time < STRUM_MERGE);
    if (!sameStrum) {
      this.closeAttempts(out, true);
      if (this.hasChords) this.attempts.push({ time, notes: [], open: true });
    }

    if (this.ex.timed) {
      const c = this.timedCandidates(time, (t) => t.kind.type === 'attack');
      if (c.length) this.settle(c[0].i, this.judgeDelta(c[0].delta), c[0].delta, out);
      else if (this.ex.targets.some((t) => t.kind.type === 'attack')) this.strays++;
    } else if (this.ex.targets[this.cursor]?.kind.type === 'attack' && time >= this.appeared - 0.02) {
      const i = this.cursor;
      const delta = Math.max(0, time - this.appeared);
      this.resolved(time);
      this.settle(i, 'hit', delta, out);
    }
  }

  private onNote(time: number, midi: number, out: ScoredTarget[]): void {
    const attempt = this.attempts.find((a) => a.open && time >= a.time - 0.005 && time <= a.time + this.win.chord);
    if (attempt) {
      attempt.notes.push(midi);
      // A compatible chord is accepted at once; anything else waits for the rest of the window. In spectral mode only
      // the strum event decides, so the notes are just kept.
      const target = this.spectral ? undefined : this.attemptTarget(attempt);
      if (target && this.verifier.verify(target.kind, { onsetTime: attempt.time, notes: attempt.notes }) === 'ok') {
        this.finishAttempt(attempt, out);
      }
      return;
    }

    if (this.ex.timed) {
      const c = this.timedCandidates(time, (t) => PITCHED.has(t.kind.type));
      if (!c.length) {
        if (this.ex.targets.some((t) => PITCHED.has(t.kind.type))) this.strays++;
        return;
      }
      const right = c.find((x) => matchesPitch(this.ex.targets[x.i], midi));
      if (right) this.settle(right.i, this.judgeDelta(right.delta), right.delta, out, [midi]);
      else this.settle(c[0].i, 'wrong', c[0].delta, out, [midi]);
    } else {
      const i = this.cursor;
      const target = this.ex.targets[i];
      if (!target || !PITCHED.has(target.kind.type) || time < this.appeared - 0.02) return;
      if (matchesPitch(target, midi)) {
        const delta = Math.max(0, time - this.appeared);
        this.resolved(time);
        this.settle(i, 'hit', delta, out, [midi]);
      } else {
        this.wrongAttempt(i, [midi], out);
      }
    }
  }

  private onStrum(e: Extract<DetectorEvent, { type: 'strum' }>, out: ScoredTarget[]): void {
    if (!this.spectral) return;
    const a = this.attempts.find((x) => x.open && Math.abs(x.time - e.time) < 0.02);
    if (!a) return;
    a.strum = { strengths: e.strengths, shadowed: e.shadowed };
    this.finishAttempt(a, out);
  }

  private attemptTarget(a: Attempt): (Target & { kind: ChordKind }) | undefined {
    const i = this.attemptIndex(a);
    const t = i === undefined ? undefined : this.ex.targets[i];
    return t && t.kind.type === 'chord' ? (t as Target & { kind: ChordKind }) : undefined;
  }

  private attemptIndex(a: Attempt): number | undefined {
    if (this.ex.timed) {
      return this.timedCandidates(a.time, (t) => t.kind.type === 'chord')[0]?.i;
    }
    const t = this.ex.targets[this.cursor];
    return t && t.kind.type === 'chord' && a.time >= this.appeared - 0.02 ? this.cursor : undefined;
  }

  private finishAttempt(a: Attempt, out: ScoredTarget[]): void {
    a.open = false;
    const i = this.attemptIndex(a);
    if (i === undefined) {
      this.strays++;
      return;
    }
    const target = this.ex.targets[i];
    const kind = target.kind as ChordKind;
    const hearing: ChordHearing = { onsetTime: a.time, notes: a.notes, strum: a.strum };
    let verdict = this.verifier.verify(kind, hearing);
    const chord = this.verifier.analyze?.(kind, hearing) ?? undefined;
    if (verdict === 'unknown') verdict = this.unknownAs === 'hit' ? 'ok' : 'wrong';
    if (this.ex.timed) {
      const delta = a.time - this.latency - this.expected(i);
      this.settle(i, verdict === 'ok' ? this.judgeDelta(delta) : 'wrong', delta, out, a.notes.slice(), chord);
    } else if (verdict === 'ok') {
      const delta = Math.max(0, a.time - this.appeared);
      this.resolved(a.time);
      this.settle(i, 'hit', delta, out, a.notes.slice(), chord);
    } else {
      this.wrongAttempt(i, a.notes.slice(), out, chord);
    }
  }

  private closeAttempts(out: ScoredTarget[], all: boolean): void {
    for (const a of this.attempts) {
      const wait = this.spectral ? this.strumWait : this.win.chord;
      if (a.open && (all || this.clock >= a.time + wait)) this.finishAttempt(a, out);
    }
    for (let k = this.attempts.length - 1; k >= 0; k--) if (!this.attempts[k].open) this.attempts.splice(k, 1);
  }

  private expire(out: ScoredTarget[]): void {
    this.closeAttempts(out, false);
    if (!this.ex.timed) return;
    this.finals.forEach((f, i) => {
      if (f) return;
      if (this.clock > this.expected(i) + this.latency + this.win.outer + this.win.grace) this.settle(i, 'miss', 0, out);
    });
  }
}
