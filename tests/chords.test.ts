import { describe, expect, it } from 'vitest';
import { BlockProcessor } from '../src/audio/blocks';
import { Detector } from '../src/detection/detector';
import { generate } from '../src/exercises';
import { FakeInput, fakeChord } from '../src/game/input';
import { GameSession } from '../src/game/session';
import { INSTRUMENTS, pitchRange } from '../src/model/instrument';
import { analyzeChord, CHORD_THRESHOLDS } from '../src/scoring/chord';
import { chordSet } from '../src/scoring/chordSet';
import { Judge } from '../src/scoring/judge';
import { renderPlucks } from '../src/synth/karplus';
import { chordKind, runChordBench, shapeOf, SR } from '../scripts/bench-lib';
import type { Exercise } from '../src/model/exercise';

const kind = chordKind;

describe('chordSet (notes to listen to)', () => {
  it('Em lists the other third (G#3) and E lists G3', () => {
    expect(chordSet(kind('Em')).contradicting).toContain(56);
    expect(chordSet(kind('E')).contradicting).toContain(55);
    expect(chordSet(kind('A')).contradicting).toContain(60); // C4 would make it Am
    expect(chordSet(kind('D')).contradicting).toContain(65); // F4 would make it Dm
  });
  it('adds the notes of look-alike chords of the list (C against Am, G against Em)', () => {
    expect(chordSet(kind('C')).contradicting).toEqual(expect.arrayContaining([45, 57])); // the A notes of Am
    expect(chordSet(kind('G')).contradicting).toEqual(expect.arrayContaining([40, 52, 64])); // the E notes of Em
  });
  it('never lists a chord tone as contradicting, and candidates are required + contradicting', () => {
    for (const name of ['Em', 'Am', 'E', 'A', 'D', 'G', 'C', 'F', 'E5', 'G5', 'A5', 'C5', 'D5']) {
      const s = chordSet(kind(name));
      expect(s.contradicting.filter((m) => s.required.includes(m))).toEqual([]);
      expect(s.candidates).toEqual([...new Set([...s.required, ...s.contradicting])].sort((a, b) => a - b));
    }
  });
});

describe('analyzeChord (verdict from strengths)', () => {
  const em = kind('Em');
  const all = (v: number) => Object.fromEntries(chordSet(em).candidates.map((m) => [m, v]));
  const perfect = () => ({ ...all(0), ...Object.fromEntries(chordSet(em).required.map((m) => [m, 1])) });
  it('accepts a clean chord with high cleanliness', () => {
    const a = analyzeChord(em, { onsetTime: 0, notes: [], strum: { strengths: perfect() } })!;
    expect(a.verdict).toBe('ok');
    expect(a.missing).toEqual([]);
    expect(a.cleanliness).toBeGreaterThan(0.95);
  });
  it('names the missing tone and rejects', () => {
    const s = perfect();
    s[55] = 0.1; // G3 muted
    const a = analyzeChord(em, { onsetTime: 0, notes: [], strum: { strengths: s } })!;
    expect(a.verdict).toBe('wrong');
    expect(a.missing).toEqual([55]);
    expect(a.cleanliness).toBeLessThan(0.7);
  });
  it('rejects a foreign note (E major for Em) and lists it', () => {
    const s = { ...perfect(), 55: 0, 56: 1 };
    const a = analyzeChord(em, { onsetTime: 0, notes: [], strum: { strengths: s } })!;
    expect(a.verdict).toBe('wrong');
    expect(a.contradicted).toEqual([56]);
  });
  it('does not blame the player for shadowed tones, and allows maxMissing', () => {
    const s = perfect();
    s[52] = 0; // E3: an octave of E2, not verifiable
    expect(analyzeChord(em, { onsetTime: 0, notes: [], strum: { strengths: s, shadowed: [52] } })!.verdict).toBe('ok');
    s[55] = 0;
    expect(analyzeChord(em, { onsetTime: 0, notes: [], strum: { strengths: s, shadowed: [52] } }, { ...CHORD_THRESHOLDS, maxMissing: 1 })!.verdict).toBe('ok');
  });
  it('returns null without a strum (the verifier then falls back to the pitch)', () => {
    expect(analyzeChord(em, { onsetTime: 0, notes: [52] })).toBeNull();
  });
});

describe('Detector strum event', () => {
  const inst = INSTRUMENTS.guitar;
  const audio = renderPlucks(shapeOf('Em').map((n, i) => ({ time: 0.5 + i * 0.012, midi: n.midi, string: n.string })), { sampleRate: SR, duration: 1.2 });
  const run = (setup?: (d: Detector) => void) => {
    const d = new Detector({ sampleRate: SR, windowSize: inst.windowSize, ...pitchRange(inst) });
    setup?.(d);
    const out = [];
    for (let i = 0; i < audio.length; i += 128) out.push(...d.process(audio.subarray(i, i + 128)));
    return out;
  };
  it('is silent unless candidates are set, and then comes once per strum within 250 ms', () => {
    expect(run().filter((e) => e.type === 'strum')).toHaveLength(0);
    const s = chordSet(kind('Em'));
    const strums = run((d) => d.setChordCandidates(s.required, s.contradicting)).filter((e) => e.type === 'strum');
    expect(strums).toHaveLength(1);
    const e = strums[0];
    if (e.type !== 'strum') throw new Error();
    expect(e.emittedAt - 0.5).toBeLessThan(0.25);
    expect(Object.keys(e.strengths).map(Number).sort()).toEqual(s.candidates);
    expect(e.strengths[55]).toBeGreaterThan(0.5); // G3 is in Em
    expect(e.strengths[56]).toBeLessThan(0.6); // G#3 is not
  });
  it('does not change the other events', () => {
    const s = chordSet(kind('Em'));
    const plain = run().filter((e) => e.type !== 'strum');
    const withChord = run((d) => d.setChordCandidates(s.required, s.contradicting)).filter((e) => e.type !== 'strum');
    expect(withChord).toEqual(plain);
  });
  it('BlockProcessor puts the strum on the context timeline', () => {
    const s = chordSet(kind('Em'));
    const p = new BlockProcessor({ sampleRate: SR, windowSize: inst.windowSize, ...pitchRange(inst) });
    p.setChordCandidates(s.required, s.contradicting);
    const found = [];
    for (let i = 0; i + 1024 <= audio.length; i += 1024) found.push(...p.push(audio.subarray(i, i + 1024), 48000 + i).events);
    const e = found.find((x) => x.type === 'strum');
    expect(e && e.type === 'strum' && e.time).toBeCloseTo(1.5, 1); // 1 s of origin + the strum at 0.5 s
  });
});

describe('Judge with spectral chords', () => {
  const ex = (): Exercise => ({ id: 'x', skill: 'chords', instrument: 'guitar', timed: false, targets: [{ itemId: 'chords:Em', kind: kind('Em') }] });
  const feed = (j: Judge, events: ReturnType<typeof fakeChord>) => {
    const out = j.push(events);
    j.advance(2);
    return out;
  };
  it('waits for the strum: a chord tone heard is not enough', () => {
    const j = new Judge(ex(), { spectralChords: true });
    j.push([{ type: 'onset', time: 0.1, rms: 0.3 }, { type: 'note', time: 0.1, emittedAt: 0.14, freq: 82, midi: 40, clarity: 0.9 }]);
    expect(j.results()).toHaveLength(0);
    j.push(fakeChord(0.1, kind('Em')).slice(1));
    expect(j.results()[0].judgement).toBe('hit');
    expect(j.results()[0].chord?.cleanliness).toBeGreaterThan(0.95);
  });
  it('a muted string is a wrong attempt that says which tone is missing; E for Em is wrong too', () => {
    const j = new Judge(ex(), { spectralChords: true });
    const out = feed(j, fakeChord(0.1, kind('Em'), { muted: [55] }));
    const wrong = out.find((r) => !r.final);
    expect(wrong?.chord?.missing).toEqual([55]);
    const e = feed(new Judge(ex(), { spectralChords: true }), fakeChord(0.1, kind('Em'), { muted: [55], foreign: [56] }));
    expect(e.some((r) => !r.final && r.chord?.contradicted.includes(56))).toBe(true);
  });
  it('without strum events it falls back to the pitch verdict after the wait', () => {
    const j = new Judge(ex(), { spectralChords: true });
    j.push([{ type: 'onset', time: 0.1, rms: 0.3 }, { type: 'note', time: 0.1, emittedAt: 0.14, freq: 82, midi: 40, clarity: 0.9 }]);
    j.advance(1);
    expect(j.results()[0].judgement).toBe('hit');
  });
  it('several attacks within one strum are one attempt', () => {
    const j = new Judge(ex(), { spectralChords: true });
    j.push([{ type: 'onset', time: 0.1, rms: 0.3 }, { type: 'onset', time: 0.17, rms: 0.4 }]);
    j.push(fakeChord(0.1, kind('Em')).slice(1));
    expect(j.results()).toHaveLength(1);
    expect(j.results()[0].judgement).toBe('hit');
  });
});

describe('GameSession with chords', () => {
  const make = () => {
    const input = new FakeInput();
    const exercise = generate('chords', { instrument: 'guitar', level: 1, seed: 3, length: 4 });
    const session = new GameSession({ exercise, input, metronome: { on: false } });
    return { input, exercise, session };
  };
  it('gives the detector the tones and the look-alike notes of the chord being waited for', () => {
    const { input, exercise, session } = make();
    session.start();
    const first = exercise.targets[0].kind;
    if (first.type !== 'chord') throw new Error();
    expect(input.chordCandidates.required).toEqual(chordSet(first).required);
    expect(input.chordCandidates.contradicting).toEqual(chordSet(first).contradicting);
    session.dispose();
    expect(input.chordCandidates.required).toEqual([]);
  });
  it('plays a round: the right strums hit, a muted string is a retry that names the tone', async () => {
    const { input, exercise, session } = make();
    const wrong: (number[] | undefined)[] = [];
    session.on('wrongAttempt', (r) => wrong.push(r.chord?.missing));
    session.start();
    input.advance(0.1);
    exercise.targets.forEach((t, i) => {
      if (t.kind.type !== 'chord') return;
      if (i === 1) {
        input.inject(fakeChord(input.now() + 0.1, t.kind, { muted: [t.kind.midis[1]] }));
        input.advance(1);
      }
      input.inject(fakeChord(input.now() + 0.1, t.kind));
      input.advance(1);
    });
    input.advance(1);
    await Promise.resolve();
    expect(wrong).toEqual([[exercise.targets[1].kind.type === 'chord' ? exercise.targets[1].kind.midis[1] : 0]]);
    expect(session.finished).toBe(true);
    expect(session.summary?.hits).toBe(4);
  });
});

describe('chord bench thresholds (synthetic strings)', () => {
  const bench = runChordBench();
  const sum = (f: (r: (typeof bench.rows)[number]) => number) => bench.rows.reduce((a, r) => a + f(r), 0);
  it('accepts the right chord: >= 90% overall and >= 85% for every chord', () => {
    expect(sum((r) => r.correct.accepted) / sum((r) => r.correct.n)).toBeGreaterThanOrEqual(0.9);
    for (const r of bench.rows) expect(r.correct.accepted / r.correct.n, r.chord).toBeGreaterThanOrEqual(0.85);
  });
  it('rejects the nearest wrong chords: >= 90%', () => {
    expect(sum((r) => r.wrong.rejected) / sum((r) => r.wrong.n)).toBeGreaterThanOrEqual(0.9);
  });
  it('names the muted string when its note is not an octave double of another string: >= 70%', () => {
    expect(sum((r) => r.muted.identifiedUnique) / sum((r) => r.muted.nUnique)).toBeGreaterThanOrEqual(0.7);
  });
  it('a muted octave double is the known blind spot (reported, only guarded against regression)', () => {
    expect(sum((r) => r.muted.rejected) / sum((r) => r.muted.n)).toBeGreaterThanOrEqual(0.5);
  });
  it('answers within 250 ms of the strum', () => {
    for (const r of bench.rows) expect(r.latency.max, r.chord).toBeLessThanOrEqual(250);
    // A strum under a louder ringing chord can escape the onset detector (then the Judge falls back to the pitch).
    expect(bench.outcomes.filter((o) => o.latencyMs === null).length / bench.outcomes.length).toBeLessThan(0.05);
  });
}, 300000);
