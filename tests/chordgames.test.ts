import { describe, expect, it } from 'vitest';
import { CHORDS, chordShape, generate } from '../src/exercises';
import { makeFakeControl } from '../src/game/fakePlayer';
import { chordDiagram, missingMessage, missingStrings } from '../src/game/chords/diagram';
import { chordFeedback, CLEAN_THRESHOLD, foreignMessage } from '../src/game/chords/feedback';
import { changeFromOf, chordLabel, chordNameOf, chordToneNames, groupChords, groupIndexOf, lookAlike } from '../src/game/chords/names';
import { RUNE_SIZE, runeColor, runeGlyph } from '../src/game/chords/rune';
import { MINUTE_SECONDS, MinuteRound, minuteExercise, pairKey, readChangeBest, writeChangeBest } from '../src/game/forge/minute';
import { FakeInput } from '../src/game/input';
import { GameSession } from '../src/game/session';
import { baseLimit, bpmRange, foePerformance, limitRange, nextBpm, nextLimit, restartBpm, restartLimit } from '../src/game/wizard/pace';
import {
  bossLength, BOSS_BONUS, CAST_WAIT, CHANGE_BONUS, FIZZLE_GRACE, FLAWLESS_BONUS, MAX_HEARTS, MAX_RESTARTS, NORMAL_POINTS, speedFactor, TUNING, WAVES, WizardRun,
} from '../src/game/wizard/state';
import type { Exercise } from '../src/model/exercise';
import { INSTRUMENTS, midiAt, noteName, type InstrumentId } from '../src/model/instrument';
import type { ChordAnalysis } from '../src/scoring/chord';
import type { ScoredTarget } from '../src/scoring/types';

const IDS: InstrumentId[] = ['guitar', 'bass4', 'bass5'];
/** Bass levels whose pattern is root-fifth-octave-fifth (see exercises/chords.ts). */
const BASS4_LEVELS = [4, 8, 9, 10];
const NAMES = Object.keys(CHORDS);
const guitar = INSTRUMENTS.guitar;

describe('chord groups', () => {
  it('names come from the itemId', () => {
    expect(chordNameOf('chords:Em')).toBe('Em');
    expect(chordNameOf('chords:Em>Am')).toBe('Am');
    expect(changeFromOf('chords:Em>Am')).toBe('Em');
    expect(changeFromOf('chords:Em')).toBe('');
  });

  it('every level and instrument: one group per chord (guitar 1 target, bass 3 or 4 notes), names in order', () => {
    for (const instrument of IDS)
      for (let level = 1; level <= 10; level++) {
        const ex = generate('chords', { instrument, level, seed: 3, length: 6 });
        const groups = groupChords(ex);
        const expectedCount = instrument === 'guitar' ? 1 : BASS4_LEVELS.includes(level) ? 4 : 3;
        expect(groups.length).toBe(ex.targets.length / expectedCount);
        groups.forEach((g, i) => {
          expect(g.count).toBe(expectedCount);
          expect(g.name).toBe(chordNameOf(ex.targets[g.first].itemId));
          for (let k = 0; k < g.count; k++) expect(chordNameOf(ex.targets[g.first + k].itemId)).toBe(g.name);
          if (i > 0) expect(g.from).toBe(groups[i - 1].name);
          expect(groupIndexOf(groups, g.first + g.count - 1)).toBe(i);
        });
        if (level === 10) expect(groups.map((g) => g.beat)).toEqual(groups.map((_, i) => i * 4));
      }
  });

  it('Spanish names and tones', () => {
    expect(chordLabel('Em')).toBe('Mi menor');
    expect(chordLabel('G')).toBe('Sol mayor');
    expect(chordLabel('A5')).toBe('La 5');
    expect(chordToneNames('Em')).toEqual(['Mi', 'Si', 'Sol']);
    expect(chordToneNames('C')).toEqual(['Do', 'Mi', 'Sol']);
  });
});

describe('chord box', () => {
  it('matches the shape of every chord: open "o", muted "x", fretted dots in their row', () => {
    for (const name of NAMES) {
      const d = chordDiagram(name);
      expect(d.strings).toHaveLength(6);
      CHORDS[name].frets.forEach((fret, string) => {
        const s = d.strings[string];
        if (fret < 0) expect(s.state).toBe('muted');
        else if (fret === 0) expect(s.state).toBe('open');
        else {
          expect(s.state).toBe('fret');
          expect(s.fret).toBe(fret);
          expect(s.row).toBe(fret - d.baseFret);
          expect(s.row).toBeGreaterThanOrEqual(0);
          expect(s.row).toBeLessThan(4);
        }
        if (fret >= 0) expect(s.midi).toBe(midiAt(guitar, { string, fret }));
      });
    }
  });

  it('F is drawn as a barre over the six strings; power chords up the neck start at their lowest fret', () => {
    expect(chordDiagram('F').barre).toMatchObject({ fret: 1, from: 0, to: 5 });
    expect(chordDiagram('Em').barre).toBeUndefined();
    expect(chordDiagram('Em').baseFret).toBe(1);
    expect(chordDiagram('G5').baseFret).toBe(3);
    expect(chordDiagram('D5').baseFret).toBe(10);
    expect(chordDiagram('D5').strings[0].row).toBe(0);
  });

  it('every fretted string has a finger (1-4), open and muted ones none', () => {
    for (const name of NAMES) for (const s of chordDiagram(name).strings) {
      if (s.state === 'fret') expect([1, 2, 3, 4]).toContain(s.finger);
      else expect(s.finger).toBeUndefined();
    }
  });

  it('missing note -> string: every tone of every shape maps back to the string that plays it', () => {
    for (const name of NAMES)
      for (const p of chordShape(name)) {
        const midi = midiAt(guitar, p);
        const found = missingStrings(name, [midi])[0];
        expect(found.strings).toContain(p.string);
        expect(found.note).toBe(noteName(midi));
        const msg = missingMessage(name, [midi]);
        expect(msg).toContain(`cuerda${msg.includes('cuerdas') ? 's' : ''}`);
        expect(msg).toContain(String(6 - p.string));
        expect(msg.startsWith('Falta el')).toBe(true);
      }
  });

  it('the example of the design: Em without the G on the 3rd string', () => {
    expect(missingMessage('Em', [55])).toBe('Falta el Sol: revisa la cuerda 3');
    expect(missingMessage('Em', [55, 47])).toBe('Faltan Sol y Si: revisa las cuerdas 3 y 5');
    expect(missingMessage('Em', [])).toBe('');
  });
});

describe('verdict feedback', () => {
  const analysis = (over: Partial<ChordAnalysis>): ChordAnalysis => ({ verdict: 'wrong', missing: [], contradicted: [], present: [], cleanliness: 0.4, ...over });

  it('names the foreign note and the chord it points to', () => {
    // G#3 (56) sounding in Em: the player is playing E major.
    expect(lookAlike('Em', [56], [40, 47, 52, 59, 64])).toBe('E');
    expect(foreignMessage('Em', [56], [40, 47, 52, 59, 64]).text).toBe('Suena un Sol#: ¿es Mi mayor en vez de Mi menor?');
    expect(lookAlike('E', [55], [40, 47, 52, 59, 64])).toBe('Em');
    expect(lookAlike('Am', [60], [45, 52, 57, 64])).toBe('C');
    expect(foreignMessage('Em', [], [])).toEqual({ text: '', look: null });
  });

  it('every chord: the foreign notes of its own contradicting set point to some other chord or none, never crash', () => {
    for (const name of NAMES) for (const m of [50, 53, 56, 60, 65]) expect(() => foreignMessage(name, [m], [])).not.toThrow();
  });

  it('lights the strings that sounded and the ones that did not', () => {
    const f = chordFeedback('Em', analysis({ missing: [55], present: [40, 47, 52, 59, 64], cleanliness: 0.5 }), false);
    expect(f.ok).toBe(false);
    expect(f.missingText).toBe('Falta el Sol: revisa la cuerda 3');
    expect(f.missingStringIdx).toEqual([3]);
    expect(f.presentStrings).toEqual([0, 1, 2, 4, 5]);
    expect(f.foreignText).toBe('');
  });

  it('clean = accepted with cleanliness from the threshold', () => {
    expect(chordFeedback('Em', analysis({ verdict: 'ok', cleanliness: CLEAN_THRESHOLD }), true).clean).toBe(true);
    expect(chordFeedback('Em', analysis({ verdict: 'ok', cleanliness: CLEAN_THRESHOLD - 0.01 }), true).clean).toBe(false);
    expect(chordFeedback('Em', undefined, true).clean).toBe(false); // pitch-only judging: no cleanliness to speak of
  });
});

/** A session whose Judge sees real spectral verdicts from the fake input. */
function guitarSession(level: number, seed = 5) {
  const exercise = generate('chords', { instrument: 'guitar', level, seed, length: 4 });
  const input = new FakeInput();
  const session = new GameSession({ exercise, input, metronome: { on: false } });
  return { exercise, input, session, fake: makeFakeControl(session, input) };
}

describe('Forja through GameSession (fake chords)', () => {
  it('a perfect strum is accepted, clean, with every string present', () => {
    const { session, input, fake } = guitarSession(1);
    const seen: ScoredLike[] = [];
    session.on('targetResolved', (r) => seen.push(r));
    session.start();
    expect(input.chordCandidates.required.length).toBeGreaterThan(0);
    fake.advance(1);
    fake.strum();
    fake.advance(0.4);
    expect(seen).toHaveLength(1);
    const f = chordFeedback(groupChords(session.exercise)[0].name, seen[0].chord, true);
    expect(f.clean).toBe(true);
    expect(f.missing).toEqual([]);
  });

  it('a muted string: not accepted, the message names the right string; strumming it right accepts it', () => {
    const { session, exercise, fake } = guitarSession(1);
    const wrong: ScoredLike[] = [];
    const ok: ScoredLike[] = [];
    session.on('wrongAttempt', (r) => wrong.push(r));
    session.on('targetResolved', (r) => ok.push(r));
    session.start();
    const name = groupChords(exercise)[0].name;
    const shape = chordShape(name);
    const mutedString = shape[Math.floor(shape.length / 2)].string;
    const mutedMidi = midiAt(guitar, shape.find((p) => p.string === mutedString)!);
    fake.advance(1);
    fake.strum({ mutedStrings: [mutedString] });
    fake.advance(0.4);
    expect(wrong).toHaveLength(1);
    expect(ok).toHaveLength(0);
    const f = chordFeedback(name, wrong[0].chord, false);
    expect(f.missing.map((m) => m.midi)).toEqual([mutedMidi]);
    expect(f.missingText).toBe(missingMessage(name, [mutedMidi]));
    expect(f.missingText).toContain(String(6 - mutedString));
    fake.strum();
    fake.advance(0.4);
    expect(ok).toHaveLength(1);
  });

  it('the wrong chord with a foreign note: the message says which note and which chord it looks like', () => {
    const { session, fake } = guitarSession(1);
    const wrong: ScoredLike[] = [];
    session.on('wrongAttempt', (r) => wrong.push(r));
    session.start();
    const cand = fake.candidates();
    const name = groupChords(session.exercise)[0].name;
    fake.advance(1);
    fake.strum({ foreign: [cand.contradicting[0]] });
    fake.advance(0.4);
    expect(wrong).toHaveLength(1);
    const f = chordFeedback(name, wrong[0].chord, false);
    expect(f.foreign.length).toBe(1);
    expect(f.foreignText).toContain('Suena');
  });

  it('Em with the G# sounding reads "¿es Mi mayor en vez de Mi menor?"', () => {
    const exercise = generate('chords', { instrument: 'guitar', level: 1, seed: 1, length: 4 });
    const em = exercise.targets.findIndex((t) => t.kind.type === 'chord' && t.kind.name === 'Em');
    expect(em).toBeGreaterThanOrEqual(0);
    const input = new FakeInput();
    const session = new GameSession({ exercise: { ...exercise, targets: exercise.targets.slice(em) }, input, metronome: { on: false } });
    const fake = makeFakeControl(session, input);
    const wrong: ScoredLike[] = [];
    session.on('wrongAttempt', (r) => wrong.push(r));
    session.start();
    fake.advance(1);
    fake.strum({ foreign: [56] });
    fake.advance(0.4);
    expect(chordFeedback('Em', wrong[0].chord, false).foreignText).toBe('Suena un Sol#: ¿es Mi mayor en vez de Mi menor?');
  });
});

type ScoredLike = ScoredTarget;

describe('one-minute changes', () => {
  it('starts with the first accepted chord, counts the changes after it and the clean ones among them', () => {
    const m = new MinuteRound(['Em', 'Am']);
    expect(m.started).toBe(false);
    expect(m.remaining(100)).toBe(MINUTE_SECONDS);
    expect(m.accept(10, true)).toBe('start');
    expect(m.changes).toBe(0);
    expect(m.accept(12, true)).toBe('clean');
    expect(m.accept(14, false)).toBe('sloppy');
    expect(m.accept(16, true)).toBe('clean');
    expect([m.changes, m.clean]).toEqual([3, 2]);
    expect(m.remaining(40)).toBeCloseTo(30);
  });

  it('is measured with the injected clock: nothing counts at or after 60 s, wrong strums are tallied', () => {
    const m = new MinuteRound(['E', 'A']);
    m.accept(5, true);
    m.wrong(20);
    expect(m.wrongs).toBe(1);
    expect(m.over(64.9)).toBe(false);
    expect(m.accept(64.9, true)).toBe('clean');
    expect(m.over(65)).toBe(true);
    expect(m.accept(65, true)).toBeNull();
    m.wrong(70);
    expect(m.wrongs).toBe(1);
    expect(m.clean).toBe(1);
    expect(m.remaining(500)).toBe(0);
  });

  it('builds the alternating exercise from the first change of every changes level, guitar and bass', () => {
    for (const instrument of IDS)
      for (const level of instrument === 'guitar' ? [6, 7, 8, 9] : [3, 5, 6, 7, 8, 9]) {
        const base = generate('chords', { instrument, level, seed: 9, length: 8 });
        const made = minuteExercise(base)!;
        expect(made).not.toBeNull();
        const [a, b] = made.pair;
        expect(a).not.toBe(b);
        const groups = groupChords(made.exercise);
        expect(made.exercise.timed).toBe(false);
        expect(groups.length).toBeGreaterThanOrEqual(60);
        groups.forEach((g, i) => expect(g.name).toBe(i % 2 === 0 ? a : b));
        expect(made.exercise.targets.every((t) => t.beat === undefined)).toBe(true);
        const per = instrument === 'guitar' ? 1 : BASS4_LEVELS.includes(level) ? 4 : 3;
        expect(groups.every((g) => g.count === per)).toBe(true);
      }
  });

  it('is not offered at single-chord levels nor at the timed level', () => {
    for (const level of [1, 2, 3, 4, 5, 10]) expect(minuteExercise(generate('chords', { instrument: 'guitar', level, seed: 2, length: 8 }))).toBeNull();
    for (const level of [1, 2, 4, 10]) expect(minuteExercise(generate('chords', { instrument: 'bass4', level, seed: 2, length: 8 }))).toBeNull();
  });

  it('keeps the best per pair in the blob without touching anything else (older blobs have no such key)', () => {
    expect(pairKey('Em', 'Am')).toBe(pairKey('Am', 'Em'));
    expect(readChangeBest(undefined, 'Em', 'Am')).toBe(0);
    expect(readChangeBest({ mastery: {} }, 'Em', 'Am')).toBe(0);
    const old = { mastery: { x: 1 }, arcadeBest: { 'wizard:1': { score: 5, bestCombo: 1 } } };
    const w1 = writeChangeBest(old, 'Em', 'Am', 12);
    expect(w1.newBest).toBe(true);
    expect(w1.previous).toBe(0);
    expect(w1.blob.mastery).toEqual({ x: 1 });
    expect(w1.blob.arcadeBest).toEqual(old.arcadeBest);
    expect(readChangeBest(w1.blob, 'Am', 'Em')).toBe(12);
    const w2 = writeChangeBest(w1.blob, 'Am', 'Em', 9);
    expect(w2.newBest).toBe(false);
    expect(readChangeBest(w2.blob, 'Em', 'Am')).toBe(12);
    expect(writeChangeBest(w2.blob, 'Em', 'Am', 14).newBest).toBe(true);
    expect(readChangeBest(writeChangeBest(w2.blob, 'D', 'G', 3).blob, 'Em', 'Am')).toBe(12);
  });

  it('through the session: alternating perfect strums for a virtual minute count clean changes', () => {
    const base = generate('chords', { instrument: 'guitar', level: 6, seed: 4, length: 8 });
    const made = minuteExercise(base)!;
    const input = new FakeInput();
    const session = new GameSession({ exercise: made.exercise, input, metronome: { on: false } });
    const fake = makeFakeControl(session, input);
    const minute = new MinuteRound(made.pair);
    session.on('targetResolved', (r) => {
      if (r.judgement === 'hit') minute.accept(session.input.now(), (r.chord?.cleanliness ?? 0) >= CLEAN_THRESHOLD);
    });
    session.start();
    while (!minute.over(input.now())) {
      fake.strum();
      fake.advance(0.5);
      fake.advance(1.5); // two seconds per change
    }
    expect(minute.started).toBe(true);
    expect(minute.clean).toBeGreaterThanOrEqual(25);
    expect(minute.clean).toBe(minute.changes);
  });
});

describe('runes', () => {
  it('are 9x9, deterministic and different for every chord of the list', () => {
    const seen = new Map<string, string>();
    for (const name of NAMES) {
      const glyph = runeGlyph(name);
      expect(glyph).toHaveLength(RUNE_SIZE);
      glyph.forEach((row) => expect(row).toMatch(/^[.#]{9}$/));
      expect(runeGlyph(name)).toEqual(glyph);
      const key = glyph.join('/');
      expect(seen.get(key)).toBeUndefined();
      seen.set(key, name);
      expect(glyph.join('').includes('#')).toBe(true);
    }
    expect(seen.size).toBe(NAMES.length);
  });

  it('colour follows the quality', () => {
    expect(runeColor('E')).toBe('amber');
    expect(runeColor('Em')).toBe('cyan');
    expect(runeColor('E5')).toBe('magenta');
  });
});

describe('Hechicero pace (pure)', () => {
  it('generous base limits: 10 s at level 1, falling with the level, changes get extra time, bass +30 %', () => {
    expect(baseLimit(1, 'guitar')).toBe(10);
    expect(baseLimit(4, 'guitar')).toBe(8.5);
    expect(baseLimit(5, 'guitar')).toBe(9.5); // the first level with changes gets extra time
    expect(baseLimit(9, 'guitar')).toBe(7.5);
    for (let l = 1; l <= 10; l++) {
      expect(baseLimit(l, 'guitar')).toBeGreaterThanOrEqual(6.5);
      expect(baseLimit(l, 'guitar')).toBeLessThanOrEqual(10);
      expect(baseLimit(l, 'bass4') / baseLimit(l, 'guitar')).toBeCloseTo(1.3, 1);
      if (l !== 5 && l > 1) expect(baseLimit(l, 'guitar')).toBeLessThan(baseLimit(l - 1, 'guitar'));
    }
  });

  it('shrinks with fast clean play, holds in the middle, grows with failures, always inside the band', () => {
    const base = 8;
    expect(nextLimit(8, [1, 1], base)).toBeCloseTo(7.52);
    expect(nextLimit(8, [0.75], base)).toBeCloseTo(7.84);
    expect(nextLimit(8, [0.6], base)).toBe(8);
    expect(nextLimit(8, [0.4], base)).toBeCloseTo(8.64);
    expect(nextLimit(8, [0], base)).toBeCloseTo(9.2);
    const r = limitRange(base);
    for (const p of [0, 0.3, 0.6, 0.8, 1]) {
      let lim = base;
      for (let i = 0; i < 60; i++) {
        lim = nextLimit(lim, [p, p, p, p], base);
        expect(lim).toBeGreaterThanOrEqual(r.min);
        expect(lim).toBeLessThanOrEqual(r.max);
      }
    }
    expect(r.min).toBeCloseTo(5.6);
  });

  it('performance: instant 1, last moment 0.4, a fizzle halves it, arriving 0', () => {
    expect(foePerformance(0, 8, 0, false)).toBe(1);
    expect(foePerformance(8, 8, 0, false)).toBeCloseTo(0.4);
    expect(foePerformance(0, 8, 2, false)).toBe(0.5);
    expect(foePerformance(1, 8, 0, true)).toBe(0);
  });

  it('a restart gives 25 % more time up to twice the base; never pushed up again from above the band', () => {
    expect(restartLimit(8, 8)).toBe(10);
    expect(restartLimit(15, 8)).toBe(16);
    expect(nextLimit(15, [0], 8)).toBe(15);
    expect(nextLimit(15, [1], 8)).toBeLessThan(15);
  });

  it('timed level: tempo moves with accuracy inside its band and a restart is slower', () => {
    expect(bpmRange(60)).toEqual({ min: 48, max: 75 });
    expect(nextBpm(60, 0.95, 60)).toBe(64);
    expect(nextBpm(60, 0.8, 60)).toBe(60);
    expect(nextBpm(60, 0.5, 60)).toBe(55);
    expect(nextBpm(60, 0.1, 60)).toBe(51);
    let b = 60;
    for (let i = 0; i < 30; i++) b = nextBpm(b, 0, 60);
    expect(b).toBe(48);
    for (let i = 0; i < 30; i++) b = nextBpm(b, 1, 60);
    expect(b).toBe(75);
    expect(restartBpm(60, 60)).toBe(51);
    expect(restartBpm(40, 60)).toBe(36);
  });

  it('boss length: 4 to 6 chords', () => {
    for (let l = 1; l <= 10; l++) {
      expect(bossLength(l)).toBeGreaterThanOrEqual(4);
      expect(bossLength(l)).toBeLessThanOrEqual(6);
    }
    expect(bossLength(10)).toBe(4);
  });
});

describe('Hechicero rules (pure)', () => {
  const foe = (name: string, extra: { steps?: number; boss?: boolean } = {}) => ({ name, ...extra });

  it('a perfect run: critical hits, rising combo and multiplier, flawless bonus per wave, boss, over after wave 3', () => {
    const run = new WizardRun(1, 'guitar');
    let t = 0;
    const names = ['Em', 'Am', 'Em', 'Am', 'Em'];
    let points = 0;
    for (let wave = 1; wave <= WAVES; wave++) {
      expect(run.wave).toBe(wave);
      names.forEach((n, i) => {
        run.spawn(i, foe(n), t);
        const r = run.cast(t + 0.5, { clean: true })!;
        expect(r.kind).toBe('critical');
        points += r.points;
        t += 3;
      });
      if (wave === WAVES) {
        run.enterBoss();
        expect(run.stage).toBe('boss');
        for (let i = 0; i < bossLength(1); i++) {
          run.spawn(i, foe(i % 2 ? 'Am' : 'Em', { boss: true }), t);
          expect(run.live!.limit).toBeGreaterThan(run.limit);
          expect(run.cast(t + 0.5, { clean: true })!.kind).toBe('critical');
          t += 3;
        }
      }
      const end = run.completeWave(wave === WAVES);
      expect(end.accuracy).toBe(1);
      expect(end.bonus).toBe(FLAWLESS_BONUS * wave + (wave === WAVES ? BOSS_BONUS : 0));
      expect(end.over).toBe(wave === WAVES);
    }
    expect(run.over).toBe(true);
    expect(run.bossDefeated).toBe(true);
    expect(run.hearts).toBe(MAX_HEARTS);
    expect(run.combo).toBe(5 * 3 + bossLength(1));
    expect(run.bestCombo).toBe(run.combo);
    expect(run.multiplier).toBe(4); // 19 clean casts in a row
    expect(run.score).toBeGreaterThan(points); // bonuses on top
  });

  it('critical vs normal: a clean cast is worth 1.8x an accepted one, same speed and multiplier', () => {
    const a = new WizardRun(1, 'guitar');
    a.spawn(0, foe('Em'), 0);
    const crit = a.cast(0, { clean: true })!;
    const b = new WizardRun(1, 'guitar');
    b.spawn(0, foe('Em'), 0);
    const normal = b.cast(0, { clean: false })!;
    expect(normal.kind).toBe('normal');
    expect(normal.points).toBe(Math.round(NORMAL_POINTS * speedFactor(0, b.baseLimit)));
    expect(crit.points).toBe(Math.round(NORMAL_POINTS * 1.8 * speedFactor(0, a.baseLimit)));
    expect(crit.points).toBeGreaterThan(normal.points);
    expect(b.combo).toBe(0); // not clean: the combo does not grow
    expect(a.combo).toBe(1);
  });

  it('the critical threshold is tunable and comes from the cleanliness of the strum', () => {
    expect(TUNING.criticalClean).toBe(CLEAN_THRESHOLD);
  });

  it('speed: a quick cast is worth up to 1.5x, the last moment 1x', () => {
    expect(speedFactor(0, 8)).toBe(1.5);
    expect(speedFactor(8, 8)).toBe(1);
    expect(speedFactor(20, 8)).toBe(1);
  });

  it('wrong chords fizzle: combo and chain lost, no heart, the enemy keeps waiting, not clean afterwards', () => {
    const run = new WizardRun(1, 'guitar');
    run.spawn(0, foe('Em'), 0);
    run.cast(1, { clean: true });
    run.spawn(1, foe('Am'), 2);
    run.cast(3, { clean: true });
    expect(run.combo).toBe(2);
    run.spawn(2, foe('Em'), 4);
    expect(run.fizzle(4 + FIZZLE_GRACE / 2)).toBe(false); // grace: the previous chord may still ring
    expect(run.combo).toBe(2);
    expect(run.fizzle(5)).toBe(true);
    expect(run.combo).toBe(0);
    expect(run.chain).toBe(0);
    expect(run.hearts).toBe(MAX_HEARTS);
    expect(run.live).not.toBeNull();
    expect(run.cast(6, { clean: true })!.kind).toBe('normal'); // not clean any more: it fizzled first
    expect(run.combo).toBe(0); // and the combo does not restart
    expect(run.bestCombo).toBe(2);
  });

  it('the change bonus: a different chord soon after the previous cast chains; slow, repeated or after a fizzle does not', () => {
    const run = new WizardRun(1, 'guitar');
    const limit = run.baseLimit;
    run.spawn(0, foe('Em'), 0);
    expect(run.cast(1, { clean: true })!.change).toBe(false); // first cast: nothing to change from
    run.spawn(1, foe('Am'), 1);
    const c1 = run.cast(1 + 1, { clean: true })!;
    expect(c1.change).toBe(true);
    expect(c1.chain).toBe(1);
    expect(c1.bonus).toBe(CHANGE_BONUS);
    run.spawn(2, foe('Em'), 2);
    const c2 = run.cast(2 + 1, { clean: true })!;
    expect(c2.chain).toBe(2);
    expect(c2.bonus).toBe(2 * CHANGE_BONUS);
    expect(c2.points).toBeGreaterThan(c1.points - CHANGE_BONUS);
    // the same chord twice is no change
    run.spawn(3, foe('Em'), 3);
    expect(run.cast(3 + 1, { clean: true })!.change).toBe(false);
    expect(run.chain).toBe(0);
    // too slow
    run.spawn(4, foe('Am'), 4);
    const slowAt = 4 + TUNING.changeWindow * run.live!.limit + 0.5;
    expect(run.cast(slowAt, { clean: true })!.change).toBe(false);
    run.spawn(5, foe('Em'), slowAt);
    expect(run.cast(slowAt + 1, { clean: true })!.change).toBe(true);
    expect(limit).toBe(10);
  });

  it('the chain is capped', () => {
    const run = new WizardRun(1, 'guitar');
    let t = 0;
    let last = 0;
    for (let i = 0; i < 12; i++) {
      run.spawn(i, foe(i % 2 ? 'Am' : 'Em'), t);
      last = run.cast(t + 1, { clean: true })!.chain;
      t += 2;
    }
    expect(last).toBe(5);
  });

  it('an enemy that arrives costs a heart, resets combo and chain; three hearts lost fail the wave', () => {
    const run = new WizardRun(1, 'bass4');
    run.spawn(0, foe('Em'), 0);
    run.cast(1, { clean: true });
    run.spawn(1, foe('Am'), 1);
    expect(run.expired(1 + run.live!.limit - 0.01)).toBe(false);
    expect(run.expired(1 + run.live!.limit + 0.01)).toBe(true);
    expect(run.arrive()).toBe(false);
    expect([run.hearts, run.combo, run.chain]).toEqual([2, 0, 0]);
    run.spawn(2, foe('Em'), 3);
    expect(run.arrive()).toBe(false);
    run.spawn(3, foe('Am'), 4);
    expect(run.arrive()).toBe(true);
    expect(run.hearts).toBe(0);
  });

  it('never counts the enemy as arrived while a strum is being judged', () => {
    const run = new WizardRun(1, 'guitar');
    run.spawn(0, foe('Em'), 0);
    const late = run.live!.limit + 1;
    expect(run.expired(late)).toBe(true);
    run.strumHeard(late - 0.1);
    expect(run.casting(late)).toBe(true);
    expect(run.expired(late)).toBe(false);
    expect(run.expired(late - 0.1 + CAST_WAIT + 0.01)).toBe(true); // the wait is bounded: noise cannot freeze the enemy
    run.strumDone();
    expect(run.casting(late)).toBe(false);
    expect(run.expired(late)).toBe(true);
    run.strumHeard(late);
    const r = run.cast(late + 0.25, { clean: true })!; // the verdict was right, just after the limit
    expect(r.kind).toBe('critical');
    expect(run.hearts).toBe(MAX_HEARTS);
  });

  it('losing every heart restarts the SAME wave slower with hearts back, never leaves the run until the retries run out', () => {
    const run = new WizardRun(1, 'guitar');
    let limit = run.limit;
    for (let k = 0; k <= MAX_RESTARTS; k++) {
      for (let i = 0; i < 3; i++) {
        run.spawn(i, foe('Em'), 0);
        run.arrive();
      }
      expect(run.hearts).toBe(0);
      const waveBefore = run.wave;
      const f = run.failWave();
      if (k < MAX_RESTARTS) {
        expect(f.over).toBe(false);
        expect(run.wave).toBe(waveBefore);
        expect(run.hearts).toBe(MAX_HEARTS);
        if (k === 0) expect(f.limit).toBeGreaterThan(limit);
        expect(f.limit).toBeGreaterThanOrEqual(limit);
        expect(f.limit).toBeLessThanOrEqual(run.baseLimit * 2);
        limit = f.limit;
        expect(run.restarts).toBe(k + 1);
      } else {
        expect(f.over).toBe(true);
        expect(run.over).toBe(true);
      }
    }
  });

  it('losing in the boss room repeats the whole wave 3 (stage back to enemies)', () => {
    const run = new WizardRun(1, 'guitar');
    run.wave = WAVES;
    run.enterBoss();
    for (let i = 0; i < 3; i++) {
      run.spawn(i, foe('Em', { boss: true }), 0);
      run.arrive();
    }
    run.failWave();
    expect(run.stage).toBe('foes');
    expect(run.wave).toBe(WAVES);
  });

  it('boss plates give more points than plain enemies', () => {
    const a = new WizardRun(1, 'guitar');
    a.spawn(0, foe('Em'), 0);
    const plain = a.cast(0, { clean: true })!.points;
    const b = new WizardRun(1, 'guitar');
    b.spawn(0, foe('Em', { boss: true }), 0);
    expect(b.cast(0, { clean: true })!.points).toBeGreaterThan(plain);
  });

  it('a heart comes back after a wave with >= 90 % clean casts', () => {
    const run = new WizardRun(1, 'guitar');
    run.spawn(0, foe('Em'), 0);
    run.arrive();
    expect(run.hearts).toBe(2);
    for (let i = 0; i < 10; i++) {
      run.spawn(i, foe(i % 2 ? 'Am' : 'Em'), 0);
      run.cast(1, { clean: true });
    }
    const end = run.completeWave();
    expect(end.accuracy).toBeCloseTo(10 / 11);
    expect(end.heartGained).toBe(true);
    expect(run.hearts).toBe(3);
  });

  it('adaptive limit: fast clean play shortens it, failures lengthen it, always inside the band', () => {
    const run = new WizardRun(3, 'guitar');
    const base = run.limit;
    for (let i = 0; i < 6; i++) {
      run.spawn(i, foe(i % 2 ? 'Am' : 'Em'), 0);
      run.cast(0.2, { clean: true });
    }
    expect(run.limit).toBeLessThan(base);
    expect(run.limit).toBeGreaterThanOrEqual(limitRange(base).min);
    const slow = new WizardRun(3, 'guitar');
    for (let i = 0; i < 6; i++) {
      slow.spawn(i, foe('Em'), 0);
      slow.arrive();
      if (slow.hearts === 0) slow.failWave();
    }
    expect(slow.limit).toBeGreaterThan(base);
  });

  it('bass: the enemy has several steps; the rune fills in one note at a time and the cast comes with the last', () => {
    const run = new WizardRun(1, 'bass4');
    const l = run.spawn(0, foe('Em', { steps: 3 }), 0);
    expect(l.steps).toBe(3);
    expect(run.step()).toBe(1);
    expect(run.step()).toBe(2);
    expect(run.step()).toBe(2); // the last note is the cast, not a step
    const r = run.cast(2, { clean: true })!;
    expect(r.kind).toBe('critical');
    expect(run.live).toBeNull();
    expect(run.limit).toBeLessThanOrEqual(run.baseLimit);
    expect(run.baseLimit).toBeCloseTo(13);
  });

  describe('timed level (10)', () => {
    it('the enemies arrive on the beat: no time limit, critical only on the beat, a wrong chord retreats without costing a heart', () => {
      const run = new WizardRun(10, 'guitar', 60);
      expect(run.timed).toBe(true);
      expect(run.bpm).toBe(60);
      run.spawn(0, foe('Em'), 0, -100);
      expect(run.expired(1e6)).toBe(false);
      expect(run.cast(10, { clean: true, onBeat: true })!.kind).toBe('critical');
      run.spawn(1, foe('Am'), 10, -100);
      const early = run.cast(14, { clean: true, onBeat: false })!;
      expect(early.kind).toBe('normal');
      expect(early.change).toBe(false); // off the beat: no change bonus
      run.spawn(2, foe('Em'), 14, -100);
      expect(run.cast(18, { clean: true, onBeat: true })!.change).toBe(true);
      run.spawn(3, foe('D'), 18, -100);
      expect(run.retreat()).toBe(true);
      expect(run.hearts).toBe(MAX_HEARTS);
      expect(run.combo).toBe(0);
      run.spawn(4, foe('G'), 22, -100);
      run.arrive();
      expect(run.hearts).toBe(MAX_HEARTS - 1);
    });

    it('waves change the tempo with accuracy; a restart is slower', () => {
      const run = new WizardRun(10, 'guitar', 60);
      for (let i = 0; i < 4; i++) {
        run.spawn(i, foe(i % 2 ? 'Am' : 'Em'), 0, -100);
        run.cast(1, { clean: true, onBeat: true });
      }
      run.completeWave();
      expect(run.bpm).toBe(64);
      for (let i = 0; i < 3; i++) {
        run.spawn(i, foe('Em'), 0, -100);
        run.arrive();
      }
      const f = run.failWave();
      expect(f.bpm).toBe(54);
      expect(run.bpm).toBeLessThan(64);
    });
  });
});

describe('Hechicero through GameSession and the bass variant', () => {
  it('untimed guitar: each chord target resolves with its analysis; clean casts give critical hits', () => {
    const { session, fake, exercise } = guitarSession(5, 8);
    const run = new WizardRun(5, 'guitar');
    const groups = groupChords(exercise);
    let gi = 0;
    run.spawn(0, { name: groups[0].name }, session.input.now());
    const crits: string[] = [];
    session.on('targetResolved', (r) => {
      const clean = chordFeedback(groups[gi].name, r.chord, true).clean;
      const res = run.cast(session.input.now(), { clean })!;
      crits.push(res.kind);
      gi++;
      if (gi < groups.length) run.spawn(gi, { name: groups[gi].name }, session.input.now());
    });
    session.start();
    for (let i = 0; i < groups.length; i++) {
      fake.advance(1);
      fake.strum();
      fake.advance(0.4);
    }
    expect(crits).toEqual(groups.map(() => 'critical'));
    expect(run.combo).toBe(groups.length);
  });

  it('muted string: a fizzle, not a critical hit', () => {
    const { session, fake, exercise } = guitarSession(1, 8);
    const run = new WizardRun(1, 'guitar');
    const name = groupChords(exercise)[0].name;
    run.spawn(0, { name }, session.input.now());
    let fizzles = 0;
    session.on('wrongAttempt', () => {
      if (run.fizzle(session.input.now())) fizzles++;
    });
    session.start();
    fake.advance(1);
    fake.strum({ mutedStrings: [chordShape(name)[1].string] });
    fake.advance(0.4);
    expect(fizzles).toBe(1);
    expect(run.live).not.toBeNull();
  });

  it('bass: the notes of a chord are separate targets; three notes in order cast the spell', () => {
    for (const instrument of ['bass4', 'bass5'] as const) {
      const exercise = generate('chords', { instrument, level: 2, seed: 6, length: 4 });
      const groups = groupChords(exercise);
      const input = new FakeInput();
      const session = new GameSession({ exercise, input, metronome: { on: false } });
      const fake = makeFakeControl(session, input);
      const run = new WizardRun(2, instrument);
      let gi = 0;
      run.spawn(0, { name: groups[0].name, steps: groups[0].count }, 0);
      const casts: string[] = [];
      session.on('targetResolved', (r) => {
        const g = groups[gi];
        if (r.index - g.first < g.count - 1) run.step();
        else {
          casts.push(run.cast(input.now(), { clean: true })!.kind);
          gi++;
          if (gi < groups.length) run.spawn(gi, { name: groups[gi].name, steps: groups[gi].count }, input.now());
        }
      });
      session.start();
      exercise.targets.forEach((t) => {
        fake.advance(0.6);
        if (t.kind.type !== 'note') throw new Error('bass uses notes');
        fake.pluckNote(t.kind.midi, 0);
        fake.advance(0.3);
      });
      expect(casts).toEqual(groups.map(() => 'critical'));
      expect(groups.every((g) => g.count === 3)).toBe(true);
      expect(run.live).toBeNull();
    }
  });

  it('bass: a wrong note is a wrongAttempt (a fizzle), the right order then completes the chord', () => {
    const exercise: Exercise = generate('chords', { instrument: 'bass4', level: 1, seed: 2, length: 2 });
    const input = new FakeInput();
    const session = new GameSession({ exercise, input, metronome: { on: false } });
    const fake = makeFakeControl(session, input);
    let wrong = 0;
    let right = 0;
    session.on('wrongAttempt', () => wrong++);
    session.on('targetResolved', () => right++);
    session.start();
    fake.advance(0.5);
    fake.pluckNote(exercise.targets[0].kind.type === 'note' ? exercise.targets[0].kind.midi + 1 : 0, 0);
    fake.advance(0.3);
    expect(wrong).toBe(1);
    expect(right).toBe(0);
  });
});
