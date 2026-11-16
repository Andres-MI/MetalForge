import { describe, expect, it } from 'vitest';
import { fretsZone, generate } from '../src/exercises';
import { fakePluck, FakeInput } from '../src/game/input';
import { boardLayout, directionHint, playedOnBoard, rowY, slotX } from '../src/game/frets/board';
import { baseLimit, limitRange, nextLimit, restartLimit, targetPerformance } from '../src/game/ninja/pace';
import {
  KILL_POINTS, CRACK_POINTS, comboMultiplier, dashBonus, FLAWLESS_BONUS, MAX_HEARTS, MAX_RESTARTS, NinjaRun, planWave, shieldPercent, speedFactor, WAVES, WRONG_GRACE,
} from '../src/game/ninja/state';
import { GameSession } from '../src/game/session';
import type { InstrumentId } from '../src/model/instrument';
import { INSTRUMENTS } from '../src/model/instrument';

const INSTRUMENT_IDS: InstrumentId[] = ['guitar', 'bass4', 'bass5'];

describe('Ninja pace (pure)', () => {
  it('base limit shrinks with the level and bass gets 20 % more', () => {
    expect(baseLimit(1, 'guitar')).toBe(7);
    expect(baseLimit(10, 'guitar')).toBe(3.85);
    expect(baseLimit(1, 'bass4')).toBeCloseTo(8.4);
    for (let l = 2; l <= 10; l++) expect(baseLimit(l, 'guitar')).toBeLessThan(baseLimit(l - 1, 'guitar'));
    for (let l = 1; l <= 10; l++) expect(baseLimit(l, 'bass5') / baseLimit(l, 'guitar')).toBeCloseTo(1.2, 1);
  });

  it('performance: instant 1, last moment 0.4, wrong first halves, timeout 0', () => {
    expect(targetPerformance(0, 5, 0, false)).toBe(1);
    expect(targetPerformance(5, 5, 0, false)).toBeCloseTo(0.4);
    expect(targetPerformance(0, 5, 1, false)).toBe(0.5);
    expect(targetPerformance(1, 5, 0, true)).toBe(0);
  });

  it('shrinks with fast play, holds in the middle, grows with failures, always inside the band', () => {
    const base = 5;
    expect(nextLimit(5, [1, 1], base)).toBeCloseTo(4.7);
    expect(nextLimit(5, [0.75], base)).toBeCloseTo(4.9);
    expect(nextLimit(5, [0.6], base)).toBe(5);
    expect(nextLimit(5, [0.4], base)).toBeCloseTo(5.4);
    expect(nextLimit(5, [0], base)).toBeCloseTo(5.75);
    const r = limitRange(base);
    for (const p of [0, 0.3, 0.6, 0.8, 1]) {
      let lim = base;
      for (let i = 0; i < 60; i++) {
        lim = nextLimit(lim, [p, p, p, p], base);
        expect(lim).toBeGreaterThanOrEqual(r.min);
        expect(lim).toBeLessThanOrEqual(r.max);
      }
      if (p === 1) expect(lim).toBe(r.min);
      if (p === 0) expect(lim).toBe(r.max);
    }
  });

  it('a restart gives 25 % more time, up to twice the base, and good play afterwards brings it back down', () => {
    expect(restartLimit(5, 5)).toBe(6.25);
    let lim = 5;
    for (let i = 0; i < 10; i++) lim = restartLimit(lim, 5);
    expect(lim).toBe(10);
    expect(nextLimit(10, [1, 1, 1, 1], 5)).toBeLessThan(10);
  });
});

describe('Ninja rules (pure)', () => {
  it('multiplier, speed factor and dash bonus', () => {
    expect([0, 4, 5, 10, 20, 99].map(comboMultiplier)).toEqual([1, 1, 2, 3, 5, 5]);
    expect(speedFactor(0, 5)).toBe(1.5);
    expect(speedFactor(5, 5)).toBe(1);
    expect(speedFactor(9, 5)).toBe(1);
    expect(dashBonus(5, 12)).toBe(0); // leaps only from level 6
    expect(dashBonus(6, 4)).toBe(0);
    expect(dashBonus(6, 6)).toBe(10);
    expect(dashBonus(10, 12)).toBe(40);
  });

  it('a perfect, fast run: full hearts, combo = every enemy, flawless bonuses, speed adapts to harder', () => {
    const run = new NinjaRun(2, 'guitar');
    const first = run.limit;
    let now = 0;
    let kills = 0;
    for (let w = 1; w <= WAVES; w++) {
      for (let i = 0; i < 10; i++) {
        run.spawn(i, { shield: false, dash: 0 }, now);
        now += 0.4;
        const r = run.hit(now);
        expect(r).toMatchObject({ kind: 'kill', clean: true });
        kills++;
      }
      const end = run.completeWave();
      expect(end.bonus).toBe(FLAWLESS_BONUS * w);
      expect(end.over).toBe(w === WAVES);
    }
    expect(run.hearts).toBe(MAX_HEARTS);
    expect(run.bestCombo).toBe(kills);
    expect(run.over).toBe(true);
    expect(run.limit).toBeLessThan(first);
    expect(run.limit).toBeGreaterThanOrEqual(limitRange(run.baseLimit).min);
    expect(run.score).toBeGreaterThan(kills * KILL_POINTS);
  });

  it('faster reactions score more', () => {
    const quick = new NinjaRun(1, 'guitar');
    quick.spawn(0, { shield: false, dash: 0 }, 0);
    const a = quick.hit(0.2)!;
    const slow = new NinjaRun(1, 'guitar');
    slow.spawn(0, { shield: false, dash: 0 }, 0);
    const b = slow.hit(6.5)!;
    expect(a.points).toBeGreaterThan(b.points);
    expect(b.points).toBeGreaterThanOrEqual(KILL_POINTS);
  });

  it('a slow run (reacting at the last moment) holds the limit; the count never loses hearts', () => {
    const run = new NinjaRun(3, 'guitar');
    const base = run.limit;
    for (let i = 0; i < 12; i++) {
      run.spawn(i, { shield: false, dash: 0 }, 0);
      run.hit(run.live!.limit * 0.95);
    }
    expect(run.hearts).toBe(MAX_HEARTS);
    expect(run.limit).toBeGreaterThan(base * 0.99); // perf 0.43 < 0.5 -> grows
    expect(run.limit).toBeLessThanOrEqual(limitRange(base).max);
  });

  it('wrong frets cost combo, not hearts, and are free right after the enemy appears', () => {
    const run = new NinjaRun(1, 'guitar');
    for (let i = 0; i < 7; i++) {
      run.spawn(i, { shield: false, dash: 0 }, 0);
      run.hit(1);
    }
    expect(run.combo).toBe(7);
    run.spawn(7, { shield: false, dash: 0 }, 10);
    expect(run.wrong(10 + WRONG_GRACE / 2)).toBe(false);
    expect(run.combo).toBe(7);
    expect(run.wrong(11)).toBe(true);
    expect(run.combo).toBe(3);
    expect(run.hearts).toBe(MAX_HEARTS);
    const k = run.hit(12)!;
    expect(k).toMatchObject({ kind: 'kill', clean: false });
    expect(run.combo).toBe(3); // not increased
  });

  it('shielded enemy: needs two hits, cracks first, has 1.6x the time', () => {
    const run = new NinjaRun(5, 'guitar');
    const plain = run.spawn(0, { shield: false, dash: 0 }, 0).limit;
    run.hit(0.5);
    const live = run.spawn(1, { shield: true, dash: 0 }, 0);
    expect(live.limit).toBeCloseTo(run.limit * 1.6);
    expect(plain).toBeGreaterThan(0);
    expect(live.hitsLeft).toBe(2);
    const c = run.hit(1)!;
    expect(c).toEqual({ kind: 'crack', points: CRACK_POINTS * run.multiplier });
    expect(run.live).not.toBeNull();
    expect(run.live!.hitsLeft).toBe(1);
    const comboBefore = run.combo;
    const k = run.hit(2)!;
    expect(k.kind).toBe('kill');
    expect(run.combo).toBe(comboBefore + 1);
    expect(run.live).toBeNull();
  });

  it('timeouts: heart lost, combo 0; third one fails the wave; restart has more time, full hearts; ends after the retries', () => {
    const run = new NinjaRun(1, 'bass4');
    run.spawn(0, { shield: false, dash: 0 }, 0);
    run.hit(1);
    expect(run.combo).toBe(1);
    expect(run.expired(0)).toBe(false);
    run.spawn(1, { shield: false, dash: 0 }, 0);
    expect(run.expired(run.live!.limit - 0.01)).toBe(false);
    expect(run.expired(run.live!.limit + 0.01)).toBe(true);
    expect(run.timeout()).toBe(false);
    expect(run.hearts).toBe(2);
    expect(run.combo).toBe(0);
    run.spawn(2, { shield: false, dash: 0 }, 0);
    expect(run.timeout()).toBe(false);
    run.spawn(3, { shield: false, dash: 0 }, 0);
    expect(run.timeout()).toBe(true);
    expect(run.hearts).toBe(0);
    const before = run.limit;
    const f = run.failWave();
    expect(f.over).toBe(false);
    expect(run.hearts).toBe(MAX_HEARTS);
    expect(run.wave).toBe(1); // the same wave again
    expect(run.restarts).toBe(1);
    expect(f.limit).toBeGreaterThan(before);
    let limit = f.limit;
    for (let k = 2; k <= MAX_RESTARTS + 1; k++) {
      for (let i = 0; i < 3; i++) {
        run.spawn(i, { shield: false, dash: 0 }, 0);
        run.timeout();
      }
      const r = run.failWave();
      if (k <= MAX_RESTARTS) {
        expect(r.over).toBe(false);
        expect(r.limit).toBeGreaterThanOrEqual(limit);
        limit = r.limit;
      } else expect(r.over).toBe(true);
    }
    expect(run.over).toBe(true);
    expect(run.score).toBeGreaterThan(0);
  });

  it('a heart comes back after a wave with >= 90 % clean kills', () => {
    const run = new NinjaRun(1, 'guitar');
    run.spawn(0, { shield: false, dash: 0 }, 0);
    run.timeout();
    for (let i = 1; i < 20; i++) {
      run.spawn(i, { shield: false, dash: 0 }, 0);
      run.hit(1);
    }
    expect(run.hearts).toBe(2);
    expect(run.completeWave().heartGained).toBe(true); // 19 clean of 20 = 95 %
    expect(run.hearts).toBe(3);
  });
});

describe('Ninja wave plan', () => {
  for (const id of INSTRUMENT_IDS) {
    it(`${id}: no shields before level 4, shields repeat the target, first enemy never shielded`, () => {
      for (let level = 1; level <= 10; level++) {
        const base = generate('frets', { instrument: id, level, seed: 5, length: 10 });
        const plan = planWave(base, level, 5);
        expect(plan.enemies.length).toBe(10);
        expect(plan.enemies[0].shield).toBe(false);
        const shields = plan.enemies.filter((e) => e.shield).length;
        if (level < 4) expect(shields).toBe(0);
        expect(plan.exercise.targets.length).toBe(10 + shields);
        expect(plan.exercise.timed).toBe(false);
        plan.enemies.forEach((e, i) => {
          expect(plan.enemyOf[e.firstIndex]).toBe(i);
          if (e.shield) expect(plan.exercise.targets[e.firstIndex + 1]).toBe(plan.exercise.targets[e.firstIndex]);
        });
      }
    });
  }

  it('shield share grows with the level and shows up across many seeds', () => {
    expect(shieldPercent(3)).toBe(0);
    expect(shieldPercent(4)).toBe(20);
    expect(shieldPercent(10)).toBe(38);
    let total = 0;
    let shielded = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const p = planWave(generate('frets', { instrument: 'guitar', level: 7, seed, length: 10 }), 7, seed);
      total += p.enemies.length - 1;
      shielded += p.enemies.filter((e) => e.shield).length;
    }
    expect(shielded / total).toBeGreaterThan(0.15);
    expect(shielded / total).toBeLessThan(0.45);
  });

  it('dash is the fret distance from the previous enemy', () => {
    const plan = planWave(generate('frets', { instrument: 'guitar', level: 5, seed: 3, length: 10 }), 5, 3);
    expect(plan.enemies[0].dash).toBe(0);
    for (let i = 1; i < plan.enemies.length; i++) expect(plan.enemies[i].dash).toBe(Math.abs(plan.enemies[i].pos.fret - plan.enemies[i - 1].pos.fret));
  });
});

/** Plays a wave through the real GameSession and Judge (fake input): every enemy killed, shields hit twice. */
describe('Ninja through GameSession', () => {
  for (const id of INSTRUMENT_IDS) {
    it(`${id}: killing every enemy (shields twice) ends with all targets hit and no wrong attempts; skipCurrent misses`, () => {
      const base = generate('frets', { instrument: id, level: 8, seed: 11, length: 10 });
      const plan = planWave(base, 8, 11);
      const input = new FakeInput();
      const session = new GameSession({ exercise: plan.exercise, input, metronome: { on: false } });
      const resolved: string[] = [];
      let wrong = 0;
      let finished = false;
      session.on('targetResolved', (r) => resolved.push(r.judgement));
      session.on('wrongAttempt', () => wrong++);
      session.on('finished', () => (finished = true));
      session.start();
      input.advance(0.5);
      for (const t of plan.exercise.targets) {
        if (t.kind.type !== 'note') throw new Error('note expected');
        input.inject(fakePluck(input.now() + 0.01, t.kind.midi));
        input.advance(0.3);
      }
      expect(wrong).toBe(0);
      expect(resolved.every((j) => j === 'hit')).toBe(true);
      expect(resolved.length).toBe(plan.exercise.targets.length);
      void finished;
    });
  }

  it('skipCurrent resolves the waiting target as a miss and shows the next', () => {
    const ex = generate('frets', { instrument: 'guitar', level: 1, seed: 2, length: 3 });
    const input = new FakeInput();
    const session = new GameSession({ exercise: ex, input, metronome: { on: false } });
    const out: [number, string][] = [];
    session.on('targetResolved', (r) => out.push([r.index, r.judgement]));
    session.start();
    input.advance(0.5);
    session.skipCurrent();
    const k = ex.targets[1].kind;
    if (k.type !== 'note') throw new Error();
    input.inject(fakePluck(input.now() + 0.01, k.midi));
    input.advance(0.3);
    expect(out).toEqual([[0, 'miss'], [1, 'hit']]);
  });
});

describe('Fretboard layout shared by both games', () => {
  for (const id of INSTRUMENT_IDS) {
    it(`${id}: every level fits 320 px, with one row per zone string and distinct slots`, () => {
      for (let level = 1; level <= 10; level++) {
        const zone = fretsZone(id, level, 9);
        const l = boardLayout(zone);
        expect(l.strings.length).toBe(new Set(zone.map((p) => p.string)).size);
        expect(l.left).toBeGreaterThanOrEqual(8);
        expect(l.right).toBeLessThanOrEqual(312);
        expect(l.step).toBeGreaterThanOrEqual(18);
        const xs = Array.from({ length: l.slots }, (_, f) => slotX(l, f));
        expect(new Set(xs).size).toBe(l.slots);
        // Highest string on top.
        const ys = l.strings.map((s) => rowY(l, s));
        expect([...ys].sort((a, b) => a - b)).toEqual(ys);
        for (const p of zone) expect(l.frets.get(p.string)!.has(p.fret)).toBe(true);
      }
    });
  }

  it('finds where a heard note is and which way to go', () => {
    const inst = INSTRUMENTS.guitar;
    const l = boardLayout(fretsZone('guitar', 3, 4)); // one string, frets 0-7
    const s = l.strings[0];
    const p = playedOnBoard(l, inst, inst.openStrings[s] + 5, { string: s, fret: 2 });
    expect(p).toEqual({ pos: { string: s, fret: 5 }, off: null });
    expect(playedOnBoard(l, inst, inst.openStrings[s] + 20).off).toBe('high');
    expect(playedOnBoard(l, inst, inst.openStrings[s] - 4).off).toBe('low');
    expect(directionHint(50, 55).text).toBe('más agudo →');
    expect(directionHint(60, 55).text).toBe('← más grave');
  });
});
