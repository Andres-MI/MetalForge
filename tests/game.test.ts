import { describe, expect, it } from 'vitest';
import { BlockProcessor } from '../src/audio/blocks';
import { measureOffset, median } from '../src/game/calibration';
import { GameClock } from '../src/game/clock';
import { playFake } from '../src/game/fakePlayer';
import { FakeInput } from '../src/game/input';
import { clicksBetween, Metronome } from '../src/game/metronome';
import { profileMasteryStore } from '../src/game/progressBlob';
import { GameSession } from '../src/game/session';
import { generate } from '../src/exercises';
import { INSTRUMENTS, pitchRange } from '../src/model/instrument';
import { currentStrength } from '../src/progress';
import { MemoryStorage } from '../src/profile/memory';
import { ProfileStore, sanitizeProfile } from '../src/profile/store';
import { renderPlucks } from '../src/synth/karplus';

describe('GameClock', () => {
  it('converts beats and seconds around beat 0 and places the count-in before it', () => {
    let t = 10;
    const c = new GameClock({ now: () => t });
    c.start({ bpm: 120, countInBeats: 4, lead: 0.5 });
    expect(c.spb).toBeCloseTo(0.5);
    expect(c.beat0Time).toBeCloseTo(10 + 0.5 + 2);
    expect(c.startTime).toBeCloseTo(10.5);
    expect(c.beatToTime(2)).toBeCloseTo(13.5);
    expect(c.timeToBeat(13.5)).toBeCloseTo(2);
    expect(c.beat()).toBeCloseTo(-5); // lead of one beat before the first count-in beat
    t = 12.5;
    expect(c.beat()).toBeCloseTo(0);
    expect(c.inCountIn).toBe(false);
    expect(c.gameTime(13)).toBeCloseTo(0.5);
  });

  it('pauses and resumes without losing the beat', () => {
    let t = 0;
    const c = new GameClock({ now: () => t });
    c.start({ bpm: 60, countInBeats: 0, lead: 0 });
    t = 3;
    c.pause();
    const frozen = c.beat();
    t = 100;
    expect(c.beat()).toBeCloseTo(frozen);
    c.resume();
    expect(c.beat()).toBeCloseTo(3);
    t = 101;
    expect(c.beat()).toBeCloseTo(4);
  });

  it('accents the first beat of each bar, including the count-in', () => {
    const c = new GameClock({ now: () => 0 });
    c.start({ bpm: 60 });
    expect([-4, -3, -1, 0, 1, 4].map((b) => c.isAccent(b))).toEqual([true, false, false, true, false, true]);
  });
});

describe('Metronome', () => {
  it('lists the clicks of a time range, count-in first, accent on beat 1', () => {
    const c = new GameClock({ now: () => 0 });
    c.start({ bpm: 60, countInBeats: 4, lead: 0 }); // beat 0 at t=4
    const clicks = clicksBetween(c, 0, 6.01);
    expect(clicks.map((k) => k.beat)).toEqual([-4, -3, -2, -1, 0, 1, 2]);
    expect(clicks.map((k) => k.accent)).toEqual([true, false, false, false, true, false, false]);
    expect(clicks[4].time).toBeCloseTo(4);
    expect(clicksBetween(c, -5, 0.5).map((k) => k.beat)).toEqual([-4]);
  });

  it('schedules ahead without repeating a click, and mutes', () => {
    let t = 0;
    const c = new GameClock({ now: () => t });
    c.start({ bpm: 120, countInBeats: 2, lead: 0 });
    const played: { time: number; accent: boolean; v: number }[] = [];
    const m = new Metronome(c, { click: (time, accent, v) => played.push({ time, accent, v }) }, { volume: 0.5, lookahead: 0.6 });
    for (t = 0; t < 3; t += 0.1) m.pump();
    expect(played.map((p) => p.time.toFixed(2))).toEqual(['0.00', '0.50', '1.00', '1.50', '2.00', '2.50', '3.00', '3.50']); // the lookahead runs 0.6 s past the last pump
    expect(played[0].v).toBe(0.5);
    const n = played.length;
    m.setMuted(true);
    for (t = 3; t < 4; t += 0.1) m.pump();
    expect(played.length).toBe(n);
  });
});

describe('calibration maths', () => {
  const beats = Array.from({ length: 10 }, (_, i) => 5 + i * 0.857);

  it('measures a constant latency exactly', () => {
    const r = measureOffset(beats.map((b) => b + 0.123), beats);
    expect(r.offset).toBeCloseTo(0.123, 6);
    expect(r.used).toBe(10);
    expect(r.ok).toBe(true);
    expect(r.spread).toBeLessThan(0.001);
  });

  it('takes the median and discards outliers and double detections', () => {
    const jitter = [0.004, -0.006, 0.01, -0.012, 0.002, 0.007, -0.003, 0.009, -0.008, 0.001];
    const onsets = beats.map((b, i) => b + 0.08 + jitter[i]);
    onsets[3] = beats[3] + 0.31; // a late stumble
    onsets.push(beats[6] + 0.08 + 0.05); // a second detection of the same pluck
    const r = measureOffset(onsets, beats);
    expect(r.offset).toBeGreaterThan(0.075);
    expect(r.offset).toBeLessThan(0.085);
    expect(r.used).toBeLessThanOrEqual(9);
    expect(r.ok).toBe(true);
  });

  it('refuses to trust too little data, and handles negative offsets', () => {
    expect(measureOffset([5.0, 5.86], beats).ok).toBe(false);
    expect(measureOffset([], beats).ok).toBe(false);
    expect(measureOffset(beats.map((b) => b - 0.04), beats).offset).toBeCloseTo(-0.04, 6);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe('BlockProcessor time alignment', () => {
  it('puts onsets on the context timeline: firstFrame/sr + sample time', () => {
    const sr = 48000;
    const inst = INSTRUMENTS.guitar;
    const audio = renderPlucks([{ time: 0.5, midi: 52, string: 0 }, { time: 1.5, midi: 55, string: 1 }], { sampleRate: sr, duration: 2.5 });
    const firstFrame = 123456; // the context had been running for 2.572 s when capture began
    const proc = new BlockProcessor({ sampleRate: sr, windowSize: inst.windowSize, ...pitchRange(inst) });
    const onsets: number[] = [];
    let upTo = 0;
    for (let i = 0; i + 1024 <= audio.length; i += 1024) {
      const r = proc.push(audio.slice(i, i + 1024), firstFrame + i);
      onsets.push(...r.events.filter((e) => e.type === 'onset').map((e) => e.time));
      upTo = r.upTo;
    }
    expect(proc.origin).toBeCloseTo(firstFrame / sr, 9);
    expect(onsets.length).toBe(2);
    const origin = firstFrame / sr;
    expect(Math.abs(onsets[0] - (origin + 0.5))).toBeLessThan(0.012);
    expect(Math.abs(onsets[1] - (origin + 1.5))).toBeLessThan(0.012);
    expect(upTo).toBeCloseTo(origin + Math.floor(audio.length / 1024) * (1024 / sr), 6);
  });

  it('fills a gap with silence so later onsets keep their true time', () => {
    const sr = 48000;
    const inst = INSTRUMENTS.guitar;
    const audio = renderPlucks([{ time: 0.2, midi: 52, string: 0 }], { sampleRate: sr, duration: 0.5 });
    const proc = new BlockProcessor({ sampleRate: sr, windowSize: inst.windowSize, ...pitchRange(inst) });
    proc.push(new Float32Array(1024), 0);
    // The next block starts 0.3 s later than a contiguous one would (dropped input).
    const gap = 14400;
    const events = [];
    for (let i = 0; i + 1024 <= audio.length; i += 1024) events.push(...proc.push(audio.slice(i, i + 1024), 1024 + gap + i).events);
    const onset = events.find((e) => e.type === 'onset')!;
    expect(Math.abs(onset.time - (1024 + gap + 0.2 * sr) / sr)).toBeLessThan(0.012);
  });
});

function setup(level = 1, instrument: 'guitar' | 'bass4' = 'guitar', latency = 0) {
  const exercise = generate('rhythm', { instrument, level, seed: 4, length: 16 });
  const fake = new FakeInput();
  fake.advanceTo(50); // the context has been running for a while
  const storage = new MemoryStorage();
  const store = new ProfileStore(storage);
  const session = new GameSession({
    exercise,
    input: fake,
    latencyOffset: latency,
    mastery: profileMasteryStore(store, instrument),
    wallClock: () => 1_000_000,
  });
  const log = { countIn: [] as number[], resolved: [] as { judgement: string; delta: number }[], strays: 0, go: 0 };
  session.on('countIn', (b) => log.countIn.push(b));
  session.on('go', () => log.go++);
  session.on('stray', () => log.strays++);
  session.on('targetResolved', (r) => log.resolved.push({ judgement: r.judgement, delta: r.delta }));
  const finished = new Promise<ReturnType<typeof expectSummary>>((res) => session.on('finished', (s) => res(s)));
  return { exercise, fake, store, session, log, finished };
}
const expectSummary = (s: import('../src/scoring/types').RoundSummary) => s;

describe('GameSession with the fake input', () => {
  it('perfect play: count-in, every target a hit, 3 stars, mastery saved', async () => {
    const { exercise, fake, store, session, log, finished } = setup(1);
    playFake(session, fake);
    const s = await finished;
    expect(log.countIn).toEqual([1, 2, 3, 4]);
    expect(log.go).toBe(1);
    expect(log.resolved.length).toBe(exercise.targets.length);
    expect(log.resolved.every((r) => r.judgement === 'hit')).toBe(true);
    expect(s.stars).toBe(3);
    expect(s.accuracy).toBeGreaterThan(0.95);
    expect(s.strays).toBe(0);
    const blob = (await store.getProgress('guitar')) as { mastery: { items: Record<string, { hits: number; lastSeen: number }> } };
    const ids = new Set(exercise.targets.map((t) => t.itemId));
    expect(Object.keys(blob.mastery.items).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(blob.mastery.items[id].hits).toBeGreaterThan(0);
      expect(blob.mastery.items[id].lastSeen).toBe(1_000_000);
    }
    expect(session.finished).toBe(true);
  });

  it('150 ms late: late judgements, drag tendency, lower score', async () => {
    const { fake, session, log, finished } = setup(1);
    playFake(session, fake, { offsetMs: 150 });
    const s = await finished;
    expect(log.resolved.filter((r) => r.judgement === 'late').length).toBe(log.resolved.length);
    expect(s.tendency).toBe('drag');
    expect(s.meanTimingError! * 1000).toBeCloseTo(150, 0);
    expect(s.stars).toBeLessThan(3);
    expect(s.accuracy).toBeLessThan(0.6);
  });

  it('the calibrated latency cancels a constant delay', async () => {
    const { fake, session, finished } = setup(1, 'guitar', 0.15);
    playFake(session, fake, { offsetMs: 150 });
    const s = await finished;
    expect(s.hits).toBe(s.total);
    expect(s.stars).toBe(3);
  });

  it('no input: every target missed, no crash, still updates mastery as failures', async () => {
    const { exercise, fake, store, session, log, finished } = setup(2);
    playFake(session, fake, { skip: exercise.targets.map((_, i) => i) });
    const s = await finished;
    expect(log.resolved.every((r) => r.judgement === 'miss')).toBe(true);
    expect(s.miss).toBe(exercise.targets.length);
    expect(s.accuracy).toBe(0);
    expect(s.stars).toBe(1);
    const blob = (await store.getProgress('guitar')) as { mastery: { items: Record<string, { misses: number }> } };
    expect(Object.values(blob.mastery.items).every((i) => i.misses > 0)).toBe(true);
  });

  it('reports strays and keeps the rest of the progress blob', async () => {
    const { fake, store, session, log, finished } = setup(1);
    await store.saveProgress('guitar', { other: 42 });
    playFake(session, fake, { strayBeats: [0.5, 2.5] });
    const s = await finished;
    expect(log.strays).toBe(2);
    expect(s.strays).toBe(2);
    expect(((await store.getProgress('guitar')) as { other: number }).other).toBe(42);
  });

  it('mastery strength grows after a good round (bass too)', async () => {
    const { fake, store, session, finished, exercise } = setup(1, 'bass4');
    playFake(session, fake);
    await finished;
    const m = (await profileMasteryStore(store, 'bass4').load()).items[exercise.targets[0].itemId];
    expect(currentStrength(m, 1_000_000)).toBeGreaterThan(0.3);
  });

  it('stops at a given beat for mid-play inspection and can pause', () => {
    const { fake, session } = setup(1);
    playFake(session, fake, { untilBeat: 3 });
    expect(session.beat()).toBeCloseTo(3, 1);
    session.pause();
    const b = session.beat();
    fake.advance(5);
    expect(session.beat()).toBeCloseTo(b);
    session.resume();
    expect(session.beat()).toBeCloseTo(b);
    fake.advance(1);
    expect(session.beat()).toBeGreaterThan(b);
  });
});

describe('profile settings', () => {
  it('keeps latency and metronome settings only when valid', () => {
    const p = sanitizeProfile({ instrument: 'guitar', settings: { backgroundEffects: true, latencyOffset: 0.12, metronomeVolume: 4, metronomeOn: false } });
    expect(p.settings).toEqual({ backgroundEffects: true, latencyOffset: 0.12, metronomeVolume: 1, metronomeOn: false });
    expect(sanitizeProfile({ settings: { latencyOffset: 'x' } }).settings.latencyOffset).toBeUndefined();
    expect(sanitizeProfile({ settings: { latencyOffset: 9 } }).settings.latencyOffset).toBeUndefined();
  });
});
