/**
 * Metronome: click sounds scheduled AHEAD of time on the AudioContext (a short timer only tops up the
 * schedule; the clicks themselves land on exact context times). The accent falls on beat 1 of each bar.
 *
 * The click is synthesised here (a short pitched blip over a tick of filtered noise): nothing sampled.
 * The scheduling maths (`clicksBetween`) is pure and tested; `ClickSink` is the seam to Web Audio.
 */
import type { GameClock } from './clock';

export interface Click {
  /** Source (AudioContext) time. */
  time: number;
  beat: number;
  accent: boolean;
}

/** Whole-beat clicks of the clock whose time is in [from, to), count-in included. Pure. */
export function clicksBetween(clock: GameClock, from: number, to: number): Click[] {
  const out: Click[] = [];
  const first = Math.max(-clock.countInBeats, Math.ceil(clock.timeToBeat(from) - 1e-9));
  for (let b = first; clock.beatToTime(b) < to; b++) {
    out.push({ time: clock.beatToTime(b), beat: b, accent: clock.isAccent(b) });
  }
  return out;
}

export interface ClickSink {
  /** Plays one click at a source time with a volume 0..1. */
  click(time: number, accent: boolean, volume: number): void;
}

/** Web Audio click: accent 1500 Hz, normal 1000 Hz, ~45 ms. */
export class AudioClickSink implements ClickSink {
  constructor(private readonly ctx: AudioContext) {}

  click(time: number, accent: boolean, volume: number): void {
    const ctx = this.ctx;
    const t = Math.max(time, ctx.currentTime);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * (accent ? 0.9 : 0.6)), t + 0.002);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    out.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(accent ? 1500 : 1000, t);
    osc.frequency.exponentialRampToValueAtTime(accent ? 1100 : 760, t + 0.04);
    osc.connect(out);
    osc.start(t);
    osc.stop(t + 0.06);
    // A tick of high-passed noise gives the attack its "wood".
    const len = Math.ceil(ctx.sampleRate * 0.012);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = accent ? 12345 : 6789;
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      d[i] = ((s / 4294967296) * 2 - 1) * (1 - i / len);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    noise.connect(hp).connect(ng).connect(out);
    noise.start(t);
  }
}

export interface MetronomeOptions {
  volume?: number;
  muted?: boolean;
  /** How far ahead (seconds) clicks are queued. Default 0.25. */
  lookahead?: number;
  /** Top-up period of the timer in ms. Default 40. */
  intervalMs?: number;
}

export class Metronome {
  private volume: number;
  private muted: boolean;
  private readonly lookahead: number;
  private readonly intervalMs: number;
  private scheduledUntil = -Infinity;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly queued: number[] = []; // recent beats already queued (guards against double scheduling)

  constructor(
    private readonly clock: GameClock,
    private readonly sink: ClickSink,
    opts: MetronomeOptions = {},
  ) {
    this.volume = opts.volume ?? 0.6;
    this.muted = opts.muted ?? false;
    this.lookahead = opts.lookahead ?? 0.25;
    this.intervalMs = opts.intervalMs ?? 40;
  }

  get isMuted(): boolean {
    return this.muted;
  }
  get level(): number {
    return this.volume;
  }
  setMuted(m: boolean): void {
    this.muted = m;
  }
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
  }

  /** Queues every click due before `clock.now() + lookahead`. The timer calls it; tests call it by hand. */
  pump(): void {
    if (this.clock.state !== 'running') return;
    const now = this.clock.now();
    const to = now + this.lookahead;
    const from = Math.max(this.scheduledUntil, now - 0.02);
    if (to <= from) return;
    for (const c of clicksBetween(this.clock, from, to)) {
      if (this.queued.includes(c.beat)) continue;
      this.queued.push(c.beat);
      if (this.queued.length > 16) this.queued.shift();
      if (!this.muted) this.sink.click(c.time, c.accent, this.volume);
    }
    this.scheduledUntil = to;
  }

  start(): void {
    this.stop();
    this.reset();
    this.pump();
    this.timer = setInterval(() => this.pump(), this.intervalMs);
  }

  /** After `clock.resume()` the beat times moved: forget what was queued. */
  reset(): void {
    this.scheduledUntil = -Infinity;
    this.queued.length = 0;
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
