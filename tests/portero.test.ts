import { describe, expect, it } from 'vitest';
import { generate } from '../src/exercises';
import { baseShotSeconds, baseTimedBpm, nextShotSeconds, restartShotSeconds, shotRange, streakSpeed } from '../src/game/portero/pace';
import { planShots, ringRadius, shotLimit, timedPhase, timeLeft } from '../src/game/portero/shots';
import { CLEAN_POINTS, comboMultiplier, DOUBLE_BONUS, FLAWLESS_BONUS, FUMBLED_POINTS, MAX_HEARTS, MAX_RESTARTS, PorteroRun, ROUNDS, SPEED_BONUS } from '../src/game/portero/state';
import { INSTRUMENTS, type InstrumentId } from '../src/model/instrument';

const stringsOf = (id: InstrumentId, level: number, seed = 1) =>
  generate('strings', { instrument: id, level, seed, length: 16 }).targets.map((t) => (t.kind.type === 'note' ? t.kind.pos!.string : -1));

describe('Portero pace (pure)', () => {
  it('untimed base time per level, bass 20 % more', () => {
    expect([1, 2, 3, 4, 5, 6].map((l) => baseShotSeconds(l, 'guitar'))).toEqual([4.2, 4, 3.8, 3.6, 3.4, 3.2]);
    for (let l = 1; l <= 6; l++) {
      const g = baseShotSeconds(l, 'guitar');
      expect(baseShotSeconds(l, 'bass4')).toBeCloseTo(g * 1.2, 1);
      expect(baseShotSeconds(l, 'bass5')).toBe(baseShotSeconds(l, 'bass4'));
    }
    expect(baseTimedBpm(60, 'guitar')).toBe(60);
    expect(baseTimedBpm(60, 'bass4')).toBe(50);
  });

  it('goes faster with high accuracy, slower with low, always inside the band of the level', () => {
    expect(nextShotSeconds(4, 1, 4)).toBe(3.7);
    expect(nextShotSeconds(4, 0.85, 4)).toBe(3.8);
    expect(nextShotSeconds(4, 0.7, 4)).toBe(4);
    expect(nextShotSeconds(4, 0.5, 4)).toBe(4.3);
    expect(nextShotSeconds(4, 0.1, 4)).toBe(4.6);
    for (let level = 1; level <= 6; level++) {
      for (const inst of ['guitar', 'bass5'] as const) {
        const base = baseShotSeconds(level, inst);
        const r = shotRange(base);
        for (const acc of [0, 0.5, 0.7, 0.85, 1]) {
          let s = base;
          for (let i = 0; i < 40; i++) {
            s = nextShotSeconds(s, acc, base);
            expect(s).toBeGreaterThanOrEqual(r.min);
            expect(s).toBeLessThanOrEqual(r.max);
          }
          if (acc === 1) expect(s).toBe(r.min);
          if (acc === 0) expect(s).toBe(r.max);
        }
      }
    }
  });

  it('a restart gives always more time, up to 1.6x; the next round does not push it back down by itself', () => {
    expect(restartShotSeconds(4, 4)).toBe(4.8);
    let s = 4;
    for (let i = 0; i < 10; i++) s = restartShotSeconds(s, 4);
    expect(s).toBe(6.4);
    expect(nextShotSeconds(6.4, 0.7, 4)).toBe(6.4);
  });

  it('streaks speed up the shots in steps of 6 % up to 18 %', () => {
    expect([0, 3, 4, 8, 12, 40].map(streakSpeed)).toEqual([1, 1, 0.94, 0.88, 0.82, 0.82]);
    expect(shotLimit(4, 0.82, 'single')).toBe(3.28);
    expect(shotLimit(4, 1, 'second')).toBe(2.8);
  });

  it('timed phases follow the beat: marker 2 beats ahead, ball in the air the last one', () => {
    expect(timedPhase(2.9, 5)).toMatchObject({ visible: false });
    expect(timedPhase(3, 5)).toMatchObject({ visible: true, ring: 1, flight: 0 });
    expect(timedPhase(4, 5)).toMatchObject({ ring: 0.5, flight: 0 });
    expect(timedPhase(4.5, 5)).toMatchObject({ ring: 0.25, flight: 0.5 });
    expect(timedPhase(5.4, 5)).toMatchObject({ ring: 0, flight: 1 });
    expect(timeLeft(1, 0, 4)).toBe(0.75);
    expect(timeLeft(9, 0, 4)).toBe(0);
    expect(ringRadius(1)).toBe(16);
    expect(ringRadius(0)).toBe(3);
  });
});

describe('Portero shots (pure)', () => {
  it('skips become double shots, saved in order; adjacent strings stay single', () => {
    expect(planShots([0, 1, 2, 1]).map((g) => g.indices)).toEqual([[0], [1], [2], [3]]);
    expect(planShots([0, 2, 0, 2]).map((g) => g.indices)).toEqual([[0, 1], [2, 3]]);
    expect(planShots([0, 3, 4, 5]).map((g) => g.indices)).toEqual([[0, 1], [2], [3]]);
  });

  it('timed doubles need the two beats at most one apart', () => {
    expect(planShots([0, 2], [0, 1]).map((g) => g.indices)).toEqual([[0, 1]]);
    expect(planShots([0, 2], [0, 2]).map((g) => g.indices)).toEqual([[0], [1]]);
  });

  it('groups of every real exercise cover all targets once, for the three instruments', () => {
    for (const id of Object.keys(INSTRUMENTS) as InstrumentId[]) {
      for (let level = 1; level <= 10; level++) {
        const ex = generate('strings', { instrument: id, level, seed: 3, length: 16 });
        const strings = stringsOf(id, level, 3);
        const groups = planShots(strings, ex.timed ? ex.targets.map((t) => t.beat) : undefined);
        expect(groups.flatMap((g) => g.indices)).toEqual(strings.map((_, i) => i));
        for (const g of groups) if (g.indices.length === 2) expect(Math.abs(strings[g.indices[0]] - strings[g.indices[1]])).toBeGreaterThanOrEqual(2);
        if (level === 3) expect(groups.some((g) => g.indices.length === 2)).toBe(true);
      }
    }
  });
});

describe('Portero rules (pure)', () => {
  it('perfect untimed run: every shot saved clean, combo grows, flawless bonus, pace gets faster, over after round 3', () => {
    const run = new PorteroRun(false, 4);
    const paces = [run.pace];
    let expected = 0;
    let combo = 0;
    for (let round = 1; round <= ROUNDS; round++) {
      expect(run.plan()).toMatchObject({ round, retry: false, countInBeats: 0 });
      for (let i = 0; i < 16; i++) {
        const r = run.resolve('hit', { timeLeft: 0.5 });
        expect(r).toMatchObject({ outcome: 'clean', heartLost: false });
        expected += (CLEAN_POINTS + SPEED_BONUS / 2) * comboMultiplier(combo);
        combo++;
      }
      const end = run.completeRound();
      expected += FLAWLESS_BONUS * round;
      expect(end).toMatchObject({ accuracy: 1, over: round === ROUNDS });
      paces.push(run.pace);
    }
    expect(run.score).toBe(expected);
    expect(run.bestCombo).toBe(16 * ROUNDS);
    expect(run.hearts).toBe(MAX_HEARTS);
    expect(run.over).toBe(true);
    expect(paces.slice(0, ROUNDS)).toEqual([4, 3.7, 3.4]);
  });

  it('wrong strings: combo and streak lost, no heart; a later right string is only a fumbled save', () => {
    const run = new PorteroRun(false, 4);
    for (let i = 0; i < 6; i++) run.resolve('hit', { timeLeft: 0 });
    expect([run.combo, run.multiplier, run.speed]).toEqual([6, 2, 0.94]);
    expect(run.wrongString()).toEqual({ comboLost: 6 });
    expect([run.combo, run.hearts, run.streak, run.speed]).toEqual([0, MAX_HEARTS, 0, 1]);
    const before = run.score;
    expect(run.resolve('hit', { wrongAttempts: 2 })).toMatchObject({ outcome: 'fumbled', points: FUMBLED_POINTS, heartLost: false });
    expect(run.score - before).toBe(FUMBLED_POINTS);
    expect(run.bestCombo).toBe(6);
    const end = run.completeRound();
    expect(end.bonus).toBe(0);
  });

  it('timeouts take a heart each; three goals restart the round slower with full hearts; never over before the retries run out', () => {
    const run = new PorteroRun(false, 4);
    run.resolve('hit', {});
    expect(run.resolve('miss')).toMatchObject({ outcome: 'goal', heartLost: true, roundFailed: false });
    expect(run.resolve('miss')).toMatchObject({ roundFailed: false });
    expect(run.resolve('miss')).toMatchObject({ heartLost: true, roundFailed: true });
    expect([run.hearts, run.combo]).toEqual([0, 0]);
    const score = run.score;
    expect(run.failRound()).toEqual({ over: false, pace: 4.8 });
    expect(run.plan()).toMatchObject({ round: 1, retry: true, pace: 4.8, attempt: 2 });
    expect([run.hearts, run.restarts, run.score]).toEqual([MAX_HEARTS, 1, score]);
    // silent run: every retry slower, and after MAX_RESTARTS retries the run ends
    const paces = [run.pace];
    let over = false;
    for (let k = 0; k < 10 && !over; k++) {
      for (let h = 0; h < MAX_HEARTS; h++) run.resolve('miss');
      const f = run.failRound();
      over = f.over;
      if (!over) paces.push(run.pace);
    }
    expect(over).toBe(true);
    expect(run.restarts).toBe(MAX_RESTARTS);
    expect(paces.every((p, i) => i === 0 || p > paces[i - 1])).toBe(true);
    expect(run.over).toBe(true);
  });

  it('double shot: saved in order, bonus only when both are clean', () => {
    const run = new PorteroRun(false, 4);
    run.resolve('hit', {});
    run.resolve('hit', {});
    expect(run.doubleBonus()).toBe(DOUBLE_BONUS);
    expect(run.score).toBe(2 * CLEAN_POINTS + DOUBLE_BONUS);
  });

  it('timed run with late hits: fumbled saves keep the hearts, halve the combo, score less and do not speed up', () => {
    const clean = new PorteroRun(true, 60);
    const late = new PorteroRun(true, 60);
    expect(late.plan()).toMatchObject({ countInBeats: 4, pace: 60 });
    for (let i = 0; i < 16; i++) {
      clean.resolve('hit');
      expect(late.resolve('late')).toMatchObject({ outcome: 'fumbled', points: FUMBLED_POINTS, heartLost: false });
    }
    expect(late.hearts).toBe(MAX_HEARTS);
    expect(late.bestCombo).toBe(0);
    expect(late.score).toBe(16 * FUMBLED_POINTS);
    expect(late.score).toBeLessThan(clean.score);
    expect(late.speed).toBe(1);
    expect(late.completeRound()).toMatchObject({ accuracy: 0.5, bonus: 0 });
    expect(late.pace).toBe(55);
    const run = new PorteroRun(true, 80);
    for (let i = 0; i < 12; i++) run.resolve('hit');
    run.resolve('early');
    expect(run.combo).toBe(6);
    expect(run.resolve('wrong')).toMatchObject({ outcome: 'goal', heartLost: true });
    expect(run.resolve('miss')).toMatchObject({ outcome: 'goal' });
    expect([run.combo, run.bestCombo, run.hearts]).toEqual([0, 12, MAX_HEARTS - 2]);
  });

  it('timed restart uses the Salto tempo rule: always slower', () => {
    const run = new PorteroRun(true, 60);
    for (let h = 0; h < MAX_HEARTS; h++) run.resolve('miss');
    expect(run.failRound()).toEqual({ over: false, pace: 51 });
  });
});

import { fretWords, locateHeard, skipText, stringLabel, wrongHint } from '../src/game/strings';

describe('strings helpers (pure)', () => {
  it('locates a heard note on its string for every instrument and level, and names strings', () => {
    for (const id of Object.keys(INSTRUMENTS) as InstrumentId[]) {
      const inst = INSTRUMENTS[id];
      inst.openStrings.forEach((open, s) => {
        expect(locateHeard(id, 1, open)).toEqual({ string: s, fret: 0 });
        expect(locateHeard(id, 4, open + 2)).toEqual({ string: s, fret: 2 });
      });
    }
    expect(locateHeard('guitar', 1, 20)).toBeNull();
    expect(stringLabel('guitar', 0)).toBe('6 Mi');
    expect(stringLabel('bass4', 3)).toBe('1 Sol');
    expect(stringLabel('bass5', 0)).toBe('5 Si');
  });

  it('hints say which string was heard and where to go', () => {
    const t = { string: 3, fret: 0 };
    expect(wrongHint('guitar', 1, t, 40)).toMatchObject({ direction: 1, distance: 3, heardString: 0 });
    expect(wrongHint('guitar', 1, t, 40).text).toBe('Sonó la 6 Mi: ve a la 3 Sol ↑');
    expect(wrongHint('guitar', 1, t, 64)).toMatchObject({ direction: -1, distance: 2 });
    expect(wrongHint('guitar', 5, { string: 3, fret: 2 }, 55)).toMatchObject({ direction: 0, text: 'Cuerda correcta, pero toca traste 2' });
    expect(fretWords(0)).toBe('al aire');
    expect(skipText(0, 1)).toBeNull();
    expect(skipText(0, 2)).toBe('Saltas 1 cuerda ↑');
    expect(skipText(4, 0)).toBe('Saltas 3 cuerdas ↓');
  });
});
