import { describe, expect, it } from 'vitest';
import type { DetectorEvent } from '../src/detection/detector';
import type { Exercise, Target } from '../src/model/exercise';
import { generate } from '../src/exercises';
import { summarize } from '../src/scoring/summary';
import type { ScoredTarget } from '../src/scoring/types';
import { Judge, MIN_HIT_WINDOW, MIN_OUTER_WINDOW, clampWindows, minTargetGap, windowsFor } from '../src/scoring';

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
    const ex = timedEx([n(40, 0), n(40, 0.25)]); // 0.25 s apart: windows are clamped to the gap, see the clamp tests below
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

describe('Judge: ventanas recortadas al hueco entre notas', () => {
  const rhythmEx = (inst: Exercise['instrument'], level: number) => generate('rhythm', { instrument: inst, level, seed: 1, length: 32 });

  it('las ventanas por defecto nunca superan 0.3 y 0.6 veces el hueco mínimo (con suelo)', () => {
    for (const inst of ['guitar', 'bass4', 'bass5'] as const) {
      for (let level = 1; level <= 10; level++) {
        const ex = rhythmEx(inst, level);
        const gap = minTargetGap(ex);
        const w = clampWindows(windowsFor(inst), ex);
        expect(w.hit).toBeLessThanOrEqual(Math.max(MIN_HIT_WINDOW, 0.3 * gap) + 1e-9);
        expect(w.outer).toBeLessThanOrEqual(Math.max(MIN_OUTER_WINDOW, 0.6 * gap) + 1e-9);
        expect(w.hit).toBeGreaterThanOrEqual(MIN_HIT_WINDOW);
        expect(w.hit).toBeLessThanOrEqual(windowsFor(inst).hit);
      }
    }
  });

  it('semicorcheas a 75 bpm en bajo: una pulsación a media distancia no es acierto de la vecina', () => {
    const ex = { ...rhythmEx('bass4', 6), bpm: 75 }; // the tempo the bug was seen at (level 6 used to be 75 bpm)
    const w = clampWindows(windowsFor('bass4'), ex);
    expect(minTargetGap(ex)).toBeCloseTo(0.2, 3);
    expect(w.hit).toBeLessThan(0.07); // before: 0.12, i.e. +/-0.12 s around notes only 0.20 s apart
    const t0 = ex.targets[0];
    const t1 = ex.targets.find((t) => t.beat! > t0.beat!)!;
    const gap = ((t1.beat! - t0.beat!) * 60) / ex.bpm!;
    // a click exactly between two sixteenths is not a clean hit for either
    const j = new Judge(ex);
    j.push([onset(gap / 2)]);
    j.advance(30);
    expect(j.results().filter((r) => r.judgement === 'hit')).toHaveLength(0);
  });

  it('los huecos grandes dejan las ventanas como estaban y una ventana explícita manda', () => {
    const quarters = rhythmEx('bass4', 1);
    expect(clampWindows(windowsFor('bass4'), quarters)).toEqual(windowsFor('bass4'));
    const dense = rhythmEx('guitar', 8);
    const t = dense.targets[0];
    const at = (t.beat! * 60) / dense.bpm! + 0.08; // 0.08 s late: outside the clamped hit window, inside an explicit one
    const clamped = new Judge(dense);
    clamped.push([onset(at)]);
    const explicit = new Judge(dense, { windows: { hit: 0.1 } });
    explicit.push([onset(at)]);
    expect(clamped.results()[0].judgement).not.toBe('hit');
    expect(explicit.results()[0].judgement).toBe('hit');
  });
});

describe('summarize: estrellas', () => {
  const res = (judgement: ScoredTarget['judgement'], i: number, wrongAttempts = 0): ScoredTarget =>
    ({ itemId: `x${i}`, judgement, delta: judgement === 'late' ? 0.1 : judgement === 'early' ? -0.1 : 0, wrongAttempts, kind: { type: 'attack' } }) as unknown as ScoredTarget;
  const many = (j: ScoredTarget['judgement'], n: number) => Array.from({ length: n }, (_, i) => res(j, i));

  it('todo tarde o todo pronto no llega a 2 estrellas', () => {
    expect(summarize(many('late', 20), 20, true).stars).toBe(1);
    expect(summarize(many('early', 20), 20, true).stars).toBe(1);
  });

  it('65 % limpio y 35 % sin tocar ya no son 2 estrellas', () => {
    const s = summarize(many('hit', 13), 20, true);
    expect(s.cleanliness).toBeCloseTo(0.65);
    expect(s.stars).toBe(1);
  });

  it('2 estrellas piden limpieza 0,75 y 3 piden 0,9', () => {
    expect(summarize(many('hit', 15), 20, true).stars).toBe(2); // 75 % clean
    expect(summarize(many('hit', 17), 20, true).stars).toBe(2); // score 0.85
    expect(summarize(many('hit', 18), 20, true).stars).toBe(3);
    // all hits but a third needed retries: accuracy 1, cleanliness 0.67
    const retried = Array.from({ length: 18 }, (_, i) => res('hit', i, i % 3 === 0 ? 1 : 0));
    const s = summarize(retried, 18, false);
    expect(s.cleanliness).toBeLessThan(0.75);
    expect(s.stars).toBe(1);
  });

  it('las notas de más restan (poco y con tope)', () => {
    const clean = summarize(many('hit', 20), 20, true, 0);
    const some = summarize(many('hit', 20), 20, true, 2);
    const lots = summarize(many('hit', 20), 20, true, 500);
    expect(some.score).toBeLessThan(clean.score);
    expect(some.score).toBeGreaterThan(clean.score - 0.1);
    expect(lots.score).toBeCloseTo(clean.score - 0.15);
    expect(clean.stars).toBe(3);
    expect(lots.stars).toBe(2);
  });

  it('no tocar nada, o casi nada, da 0 estrellas', () => {
    expect(summarize([], 20, true).stars).toBe(0);
    expect(summarize(many('hit', 2), 20, true).stars).toBe(0);
    expect(summarize(many('hit', 6), 20, true).stars).toBe(1);
  });
});
