import { describe, expect, it } from 'vitest';
import type { DetectorEvent } from '../src/detection/detector';
import type { Exercise, Target } from '../src/model/exercise';
import { Judge } from '../src/scoring';

const onset = (time: number): DetectorEvent => ({ type: 'onset', time, rms: 0.3 });
const note = (time: number, midi: number): DetectorEvent => ({ type: 'note', time, emittedAt: time + 0.03, freq: 100, midi, clarity: 0.95 });

const timedEx = (targets: Target[], instrument: Exercise['instrument'] = 'guitar'): Exercise => ({
  id: 't', skill: 'frets', instrument, timed: true, bpm: 60, targets,
});
const untimedEx = (targets: Target[]): Exercise => ({ id: 'u', skill: 'frets', instrument: 'guitar', timed: false, targets });
const n = (midi: number, beat?: number): Target => ({ itemId: `n${midi}`, kind: { type: 'note', midi }, beat });

describe('Judge, timed', () => {
  it('hit / early / late by window, with latency offset', () => {
    const ex = timedEx([n(40, 0), n(41, 1), n(42, 2)]);
    const j = new Judge(ex, { startTime: 1 });
    j.push([note(1.02, 40), note(1.85, 41), note(3.15, 42)]);
    j.finish();
    expect(j.results().map((r) => r.judgement)).toEqual(['hit', 'early', 'late']);

    const j2 = new Judge(ex, { startTime: 1, latencyOffset: 0.15 });
    j2.push([note(1.15, 40), note(2.15, 41), note(3.15, 42)]);
    expect(j2.results().map((r) => r.judgement)).toEqual(['hit', 'hit', 'hit']);
  });

  it('wrong pitch inside the window is wrong; outside it matches nothing and the target is missed', () => {
    const ex = timedEx([n(40, 0), n(41, 2)]);
    const j = new Judge(ex);
    j.push([note(0.01, 45), note(1.0, 41)]); // second one is 1 s from its target
    j.advance(5);
    expect(j.results().map((r) => r.judgement)).toEqual(['wrong', 'miss']);
    expect(j.summary().strays).toBe(1);
  });

  it('one event satisfies only one target', () => {
    const ex = timedEx([n(40, 0), n(40, 0.1)]);
    const j = new Judge(ex);
    j.push([note(0.05, 40)]);
    j.advance(5);
    const r = j.results();
    expect(r.filter((x) => x.judgement === 'hit').length).toBe(1);
    expect(r.filter((x) => x.judgement === 'miss').length).toBe(1);
  });

  it('bass windows are wider', () => {
    const g = new Judge(timedEx([n(40, 0)], 'guitar'));
    const b = new Judge(timedEx([n(28, 0)], 'bass4'));
    g.push([note(0.1, 40)]);
    b.push([note(0.1, 28)]);
    expect(g.results()[0].judgement).toBe('late');
    expect(b.results()[0].judgement).toBe('hit');
  });

  it('attack targets listen to onsets only; summary reports rushing/dragging', () => {
    const ex: Exercise = { id: 'r', skill: 'rhythm', instrument: 'guitar', timed: true, bpm: 120, targets: [0, 1, 2, 3].map((b) => ({ itemId: 'rhythm:quarters', kind: { type: 'attack' as const }, beat: b })) };
    const j = new Judge(ex);
    j.push([onset(0.07), onset(0.57), onset(1.07), onset(1.57)]);
    const s = j.summary();
    expect(s.hits).toBe(4);
    expect(s.tendency).toBe('drag');
    expect(s.meanTimingError!).toBeCloseTo(0.07, 3);
  });
});

describe('Judge, untimed', () => {
  it('wrong notes do not advance; the right one gives reaction time', () => {
    const j = new Judge(untimedEx([n(40), n(41)]), { startTime: 0 });
    const a = j.push([note(0.5, 45)]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ judgement: 'wrong', final: false, heard: [45], index: 0 });
    expect(j.currentIndex).toBe(0);
    const b = j.push([note(1.2, 40)]);
    expect(b[0]).toMatchObject({ judgement: 'hit', final: true, wrongAttempts: 1, index: 0 });
    expect(b[0].delta).toBeCloseTo(1.2);
    j.push([note(2.0, 41)]);
    expect(j.results()[1].delta).toBeCloseTo(0.8);
    expect(j.done).toBe(true);
    const s = j.summary();
    expect(s.accuracy).toBeCloseTo(0.5); // first target needed a retry
    expect(s.cleanliness).toBeCloseTo(0.5);
  });

  it('pitchClass and anyOf kinds', () => {
    const ex = untimedEx([
      { itemId: 'pc', kind: { type: 'pitchClass', pc: 4 } },
      { itemId: 'any', kind: { type: 'anyOf', midis: [45, 48] } },
    ]);
    const j = new Judge(ex);
    j.push([note(0.1, 52), note(0.5, 46), note(0.9, 48)]);
    expect(j.results().map((r) => r.judgement)).toEqual(['hit', 'hit']);
    expect(j.results()[1].wrongAttempts).toBe(1);
  });

  it('unresolved targets become misses on finish', () => {
    const j = new Judge(untimedEx([n(40), n(41)]));
    j.push([note(0.1, 40)]);
    j.finish();
    expect(j.results().map((r) => r.judgement)).toEqual(['hit', 'miss']);
  });
});

describe('Judge, chords', () => {
  const chord = (beat?: number): Target => ({ itemId: 'chords:Em', kind: { type: 'chord', name: 'Em', midis: [40, 47, 52, 55, 59, 64] }, beat });
  it('accepts a chord tone, rejects foreign notes, treats no pitch leniently', () => {
    const ok = new Judge(untimedEx([chord()]));
    ok.push([onset(0.1), note(0.1, 59)]);
    expect(ok.results()[0].judgement).toBe('hit');

    const bad = new Judge(untimedEx([chord()]));
    const out = bad.push([onset(0.1), note(0.1, 61), onset(0.9)]);
    expect(out.some((r) => r.judgement === 'wrong' && !r.final)).toBe(true);

    const none = new Judge(untimedEx([chord()]));
    none.push([onset(0.1)]);
    none.advance(1);
    expect(none.results()[0].judgement).toBe('hit');
    const strict = new Judge(untimedEx([chord()]), { unknownChord: 'wrong' });
    strict.push([onset(0.1)]);
    strict.advance(1);
    expect(strict.results()).toHaveLength(0);
  });

  it('uses a pluggable verifier', () => {
    const j = new Judge(untimedEx([chord()]), { chordVerifier: { verify: () => 'wrong' } });
    j.push([onset(0.1), note(0.1, 40)]);
    j.advance(1);
    expect(j.results()).toHaveLength(0);
  });

  it('timed chord gets timing from its attack', () => {
    const j = new Judge(timedEx([chord(0)]));
    j.push([onset(0.15), note(0.15, 40)]);
    expect(j.results()[0].judgement).toBe('late');
  });
});
