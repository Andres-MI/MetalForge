import { describe, expect, it } from 'vitest';
import { generate } from '../src/exercises';
import { runPhases, targetMidis } from '../src/game/scales/info';
import { improvisation } from '../src/game/scales/board';
import { fakePluck, FakeInput } from '../src/game/input';
import { GameSession } from '../src/game/session';
import { BASE_DAMAGE, BOSS_BARS, BOSS_BONUS, BossFight, bossHealth, HEAL, MIN_REPEAT_FRACTION, repeatFactor } from '../src/game/tower/boss';
import { baseTimedBpm, baseWaterSpeed, nextWaterSpeed, notePerformance, restartWaterSpeed, speedRange } from '../src/game/tower/pace';
import {
  CLEAN_POINTS, CLUMSY_POINTS, FLAWLESS_BONUS, FLOOR_GRACE, FLOORS, INVULN_SECONDS, MAX_GAP, MAX_HEARTS, MAX_RESTARTS, PHASE_BONUS, RESCUE_GAP, SLIP, speedFactor, START_GAP, TowerRun,
  WRONG_GRACE,
} from '../src/game/tower/state';
import type { InstrumentId } from '../src/model/instrument';

/** A run of the given level, started on a floor of `n` targets at t = 0. */
function startRun(level = 2, instrument: InstrumentId = 'guitar'): { run: TowerRun; midis: number[] } {
  const ex = generate('scales', { instrument, level, seed: 1, length: 40 });
  const midis = targetMidis(ex);
  const run = TowerRun.forLevel(level, instrument);
  run.startFloor(midis, 0);
  return { run, midis };
}

/** Plays the whole floor perfectly and fast: a note every `dt` seconds after the grace. */
function playFloor(run: TowerRun, n: number, t0 = 0, dt = 0.4): number {
  let now = t0 + FLOOR_GRACE;
  for (let i = 0; i < n; i++) {
    run.next(i, now);
    now += dt;
    expect(run.tick(now)).toBeNull();
    expect(run.jump(now)).not.toBeNull();
  }
  return now;
}

describe('Torre pace (pure)', () => {
  it('water speed grows with the level, 0.12 .. 0.28 platforms/s, and a bass is ~20 % slower', () => {
    expect(baseWaterSpeed(1, 'guitar')).toBe(0.12);
    expect(baseWaterSpeed(9, 'guitar')).toBe(0.28);
    for (let l = 2; l <= 9; l++) expect(baseWaterSpeed(l, 'guitar')).toBeGreaterThan(baseWaterSpeed(l - 1, 'guitar'));
    for (let l = 1; l <= 9; l++) {
      expect(baseWaterSpeed(l, 'bass4') / baseWaterSpeed(l, 'guitar')).toBeCloseTo(0.8, 2);
      expect(baseWaterSpeed(l, 'bass5')).toBe(baseWaterSpeed(l, 'bass4'));
    }
    expect(baseTimedBpm(80, 'guitar')).toBe(80);
    expect(baseTimedBpm(80, 'bass4')).toBe(67);
  });

  it('note performance: instant 1, a platform of water 0.4, wrong first halves, skipped 0', () => {
    expect(notePerformance(0, 0.2, 0, false)).toBe(1);
    expect(notePerformance(5, 0.2, 0, false)).toBeCloseTo(0.4);
    expect(notePerformance(50, 0.2, 0, false)).toBeCloseTo(0.4);
    expect(notePerformance(0, 0.2, 1, false)).toBe(0.5);
    expect(notePerformance(1, 0.2, 0, true)).toBe(0);
  });

  it('speeds up with fast clean play, holds in the middle, slows down with failures, always inside the band', () => {
    const base = 0.2;
    expect(nextWaterSpeed(0.2, [1, 1], base)).toBeCloseTo(0.212);
    expect(nextWaterSpeed(0.2, [0.75], base)).toBeCloseTo(0.204);
    expect(nextWaterSpeed(0.2, [0.6], base)).toBe(0.2);
    expect(nextWaterSpeed(0.2, [0.4], base)).toBeCloseTo(0.184);
    expect(nextWaterSpeed(0.2, [0], base)).toBeCloseTo(0.17);
    const r = speedRange(base);
    expect(r).toEqual({ min: 0.14, max: 0.28 });
    for (const p of [0, 0.3, 0.6, 0.8, 1]) {
      let v = base;
      for (let i = 0; i < 80; i++) {
        v = nextWaterSpeed(v, [p, p, p, p], base);
        expect(v).toBeGreaterThanOrEqual(r.min);
        expect(v).toBeLessThanOrEqual(r.max);
      }
      if (p === 1) expect(v).toBe(r.max);
      if (p === 0) expect(v).toBe(r.min);
    }
  });

  it('a restart is always slower (20 %) down to half the base', () => {
    expect(restartWaterSpeed(0.2, 0.2)).toBe(0.16);
    let v = 0.2;
    for (let i = 0; i < 10; i++) {
      const next = restartWaterSpeed(v, 0.2);
      expect(next).toBeLessThanOrEqual(v);
      v = next;
    }
    expect(v).toBe(0.1);
    // A retry that is under the band is not pushed back up by the next adaptation.
    expect(nextWaterSpeed(0.1, [1], 0.2)).toBeGreaterThanOrEqual(0.1);
    expect(nextWaterSpeed(0.1, [0], 0.2)).toBeLessThanOrEqual(0.1);
  });
});

describe('Torre rules: untimed floor', () => {
  it('a perfect floor: every note clean, ascent and descent bonuses, flawless bonus, no hearts lost', () => {
    const { run, midis } = startRun(2);
    const phases = runPhases(midis);
    expect(phases).toHaveLength(2);
    let now = FLOOR_GRACE;
    let phaseBonuses = 0;
    let jumpPoints = 0;
    for (let i = 0; i < midis.length; i++) {
      run.next(i, now);
      now += 0.4;
      expect(run.tick(now)).toBeNull();
      const j = run.jump(now)!;
      expect(j.kind).toBe('clean');
      jumpPoints += j.points;
      phaseBonuses += j.phaseBonus;
      if (i === phases[0].end || i === phases[1].end) expect(j.phaseBonus).toBeGreaterThan(0);
      else expect(j.phaseBonus).toBe(0);
    }
    expect(run.combo).toBe(midis.length);
    expect(run.bestCombo).toBe(midis.length);
    expect(run.hearts).toBe(MAX_HEARTS);
    expect(run.gap).toBeLessThanOrEqual(MAX_GAP);
    const end = run.completeFloor();
    expect(end.flawless).toBe(true);
    expect(end.bonus).toBe(FLAWLESS_BONUS * 1);
    expect(end.accuracy).toBe(1);
    expect(end.over).toBe(false);
    expect(run.floor).toBe(2);
    expect(run.score).toBe(jumpPoints + phaseBonuses + end.bonus);
    expect(run.score).toBeGreaterThan(midis.length * CLEAN_POINTS);
  });

  it('speed pays: an instant note is worth more than a late one; both clean', () => {
    const a = startRun(1).run;
    a.next(0, 0);
    const fast = a.jump(0)!.points;
    const b = startRun(1).run;
    b.next(0, 0);
    const slow = b.jump(40)!.points;
    expect(fast).toBe(Math.round(CLEAN_POINTS * 1.5));
    expect(slow).toBe(CLEAN_POINTS);
    expect(speedFactor(0)).toBe(1.5);
    expect(speedFactor(2)).toBe(1);
  });

  it('a wrong note halves the combo and slips, costs no heart; the right note after it is clumsy and breaks the clean phase', () => {
    const { run, midis } = startRun(2);
    let now = playFloor(run, 6);
    const combo0 = run.combo;
    expect(combo0).toBe(6);
    run.next(6, now);
    now += WRONG_GRACE + 0.1;
    const gap0 = run.gap;
    expect(run.wrong(now)).toBe(true);
    expect(run.combo).toBe(3);
    expect(run.gap).toBeCloseTo(gap0 - SLIP);
    expect(run.hearts).toBe(MAX_HEARTS);
    now += 0.2;
    const j = run.jump(now)!;
    expect(j.kind).toBe('clumsy');
    expect(j.points).toBe(CLUMSY_POINTS * 1);
    expect(run.combo).toBe(3);
    // Finish the floor: the ascent was not clean, so it gets no bonus; the descent can still be.
    const phases = runPhases(midis);
    expect(phases).toHaveLength(2);
    const bonusAt: Record<number, number> = {};
    for (let i = 7; i < midis.length; i++) {
      run.next(i, now);
      now += 0.3;
      bonusAt[i] = run.jump(now)!.phaseBonus;
    }
    expect(bonusAt[phases[0].end]).toBe(0);
    expect(bonusAt[phases[1].end]).toBeGreaterThan(0);
    const end = run.completeFloor();
    expect(end.flawless).toBe(false);
    expect(end.bonus).toBe(0);
    expect(end.accuracy).toBeLessThan(1);
  });

  it('a wrong note right after the target appeared is ignored (the previous note is still ringing)', () => {
    const { run } = startRun(1);
    run.next(0, 5);
    expect(run.wrong(5 + WRONG_GRACE - 0.05)).toBe(false);
    expect(run.combo).toBe(0);
    run.next(1, 6);
    expect(run.wrong(6 + WRONG_GRACE + 0.01)).toBe(true);
  });

  it('the water catches a silent player: heart lost, combo 0, rescued to a gap of 1.5, water holds for a moment', () => {
    const { run } = startRun(9);
    run.next(0, FLOOR_GRACE);
    let now = FLOOR_GRACE;
    expect(run.gap).toBe(START_GAP);
    // The water holds still during the grace period.
    expect(run.tick(FLOOR_GRACE)).toBeNull();
    expect(run.gap).toBe(START_GAP);
    let caught = null;
    while (!caught && now < 200) {
      now += 0.25;
      caught = run.tick(now);
    }
    expect(caught).toEqual({ heartLost: true, roundFailed: false });
    expect(now).toBeGreaterThan(FLOOR_GRACE + (START_GAP / run.basePace) * 0.9);
    expect(run.hearts).toBe(MAX_HEARTS - 1);
    expect(run.combo).toBe(0);
    expect(run.gap).toBe(RESCUE_GAP);
    // Invulnerable: the water does not move for INVULN_SECONDS.
    expect(run.tick(now + INVULN_SECONDS - 0.1)).toBeNull();
    expect(run.gap).toBe(RESCUE_GAP);
    expect(run.isInvulnerable(now + 1)).toBe(true);
    expect(run.isInvulnerable(now + INVULN_SECONDS + 0.1)).toBe(false);
    run.next(1, now + 0.1);
    expect(run.tick(now + INVULN_SECONDS + 1)).toBeNull();
    expect(run.gap).toBeLessThan(RESCUE_GAP);
  });

  it('three catches lose every heart; the floor restarts slower; after MAX_RESTARTS the run ends', () => {
    const { run, midis } = startRun(5);
    const base = run.basePace;
    let now = 0;
    for (let attempt = 0; attempt <= MAX_RESTARTS; attempt++) {
      run.startFloor(midis, now);
      run.next(0, now + FLOOR_GRACE);
      const speedBefore = run.pace;
      let failed = false;
      for (let k = 0; k < 3; k++) {
        let c = null;
        while (!c) {
          now += 0.5;
          c = run.tick(now);
        }
        failed = c.roundFailed;
        expect(c.roundFailed).toBe(k === 2);
        now += INVULN_SECONDS + 0.1;
      }
      expect(failed).toBe(true);
      expect(run.hearts).toBe(0);
      const f = run.failFloor();
      if (attempt < MAX_RESTARTS) {
        expect(f.over).toBe(false);
        expect(run.hearts).toBe(MAX_HEARTS);
        expect(f.pace).toBeLessThanOrEqual(speedBefore);
        if (attempt === 0) expect(f.pace).toBeLessThan(speedBefore);
        expect(f.pace).toBeGreaterThanOrEqual(base * 0.5 - 1e-9);
        expect(run.retrying).toBe(true);
        expect(run.restarts).toBe(attempt + 1);
      } else {
        expect(f.over).toBe(true);
        expect(run.over).toBe(true);
      }
    }
    expect(run.score).toBe(0);
  });

  it('a wrong-note slip can also let the water catch the hero', () => {
    const { run } = startRun(1);
    run.next(0, FLOOR_GRACE);
    run.gap = 0.3;
    expect(run.wrong(FLOOR_GRACE + 1)).toBe(true);
    expect(run.tick(FLOOR_GRACE + 1)).toEqual({ heartLost: true, roundFailed: false });
  });

  it('the water speeds up for a player who is fast and clean, and never leaves the band', () => {
    const { run, midis } = startRun(4);
    const base = run.basePace;
    playFloor(run, midis.length, 0, 0.1);
    expect(run.pace).toBeGreaterThan(base);
    expect(run.pace).toBeLessThanOrEqual(speedRange(base).max + 1e-9);
  });

  it('three floors end the run; a floor with accuracy >= 90 % gives a heart back', () => {
    const { run, midis } = startRun(1);
    run.hearts = 2;
    playFloor(run, midis.length);
    expect(run.completeFloor().heartGained).toBe(true);
    expect(run.hearts).toBe(3);
    for (let f = 2; f <= FLOORS; f++) {
      run.startFloor(midis, 0);
      playFloor(run, midis.length);
      const end = run.completeFloor();
      expect(end.over).toBe(f === FLOORS);
    }
    expect(run.over).toBe(true);
  });
});

describe('Torre rules: timed level 10 (verdicts of the Judge)', () => {
  it('hit = clean jump, early/late = clumsy jump, miss/wrong = fall and lose a heart (unless invulnerable)', () => {
    const ex = generate('scales', { instrument: 'guitar', level: 10, seed: 1, length: 40 });
    expect(ex.timed).toBe(true);
    const run = TowerRun.forLevel(10, 'guitar', ex.bpm);
    run.startFloor(targetMidis(ex), 0);
    expect(run.timed).toBe(true);
    expect(run.pace).toBe(80);
    const a = run.resolveTimed('hit', 0, 0);
    expect(a).toMatchObject({ outcome: 'clean', points: CLEAN_POINTS, heartLost: false });
    expect(run.combo).toBe(1);
    run.resolveTimed('hit', 1, 0.5);
    run.resolveTimed('hit', 2, 1);
    expect(run.combo).toBe(3);
    const b = run.resolveTimed('late', 3, 1.5);
    expect(b.outcome).toBe('clumsy');
    expect(b.heartLost).toBe(false);
    expect(run.combo).toBe(1);
    const c = run.resolveTimed('miss', 4, 2);
    expect(c).toMatchObject({ outcome: 'fall', points: 0, heartLost: true, roundFailed: false });
    expect(run.hearts).toBe(2);
    expect(run.combo).toBe(0);
    // Invulnerable for 1.5 beats: another miss right away costs nothing.
    const d = run.resolveTimed('wrong', 5, 2.5);
    expect(d.outcome).toBe('spared');
    expect(run.hearts).toBe(2);
    const e = run.resolveTimed('miss', 6, 4);
    expect(e.heartLost).toBe(true);
    const f = run.resolveTimed('miss', 7, 6);
    expect(f.roundFailed).toBe(true);
    expect(run.hearts).toBe(0);
    const fail = run.failFloor();
    expect(fail.over).toBe(false);
    expect(fail.pace).toBeLessThan(80);
    expect(run.hearts).toBe(MAX_HEARTS);
  });

  it('a clean timed floor gets the phase and flawless bonuses and moves the next tempo up', () => {
    const ex = generate('scales', { instrument: 'guitar', level: 10, seed: 1, length: 40 });
    const midis = targetMidis(ex);
    const run = TowerRun.forLevel(10, 'guitar', ex.bpm);
    run.startFloor(midis, 0);
    const phases = runPhases(midis);
    let bonus = 0;
    midis.forEach((_, i) => {
      bonus += run.resolveTimed('hit', i, i * 0.5).phaseBonus;
    });
    expect(bonus).toBeGreaterThanOrEqual(PHASE_BONUS * phases.length);
    const end = run.completeFloor();
    expect(end.flawless).toBe(true);
    expect(run.pace).toBeGreaterThan(80);
    // A bass plays slower.
    expect(TowerRun.forLevel(10, 'bass5', baseTimedBpm(ex.bpm!, 'bass5')).pace).toBe(67);
  });
});

describe('Torre boss room (pure)', () => {
  it('every scale note damages; the same note in a row damages less and less down to 10 %', () => {
    const boss = new BossFight(bossHealth(1, 1));
    expect(boss.maxHp).toBe(70);
    const a = boss.hit(45);
    expect(a).toMatchObject({ damage: BASE_DAMAGE, repeat: 1, points: BASE_DAMAGE * 3 });
    const b = boss.hit(45);
    const c = boss.hit(45);
    const d = boss.hit(45);
    expect(b.damage).toBe(6);
    expect(c.damage).toBe(3.6);
    expect(d.damage).toBe(2.2);
    expect(b.repeat).toBe(2);
    for (let i = 0; i < 12; i++) boss.hit(45);
    expect(boss.hit(45).damage).toBe(BASE_DAMAGE * MIN_REPEAT_FRACTION);
    // Moving to another note restores the full damage.
    expect(boss.hit(48)).toMatchObject({ damage: BASE_DAMAGE, repeat: 1 });
    expect(repeatFactor(1)).toBe(1);
    expect(repeatFactor(2)).toBeCloseTo(0.6);
    expect(repeatFactor(99)).toBe(MIN_REPEAT_FRACTION);
  });

  it('a note outside the scale heals a little, never above full health, and breaks the streak', () => {
    const boss = new BossFight(70);
    expect(boss.stray()).toBe(0);
    expect(boss.hp).toBe(70);
    boss.hit(45);
    boss.hit(45);
    expect(boss.hp).toBe(54);
    expect(boss.stray()).toBe(HEAL);
    expect(boss.hp).toBe(57);
    expect(boss.healed).toBe(HEAL);
    expect(boss.hit(45).repeat).toBe(1);
    boss.hp = 69;
    expect(boss.stray()).toBe(1);
    expect(boss.hp).toBe(70);
  });

  it('moving around the scale defeats it; playing one note forever does not', () => {
    const scale = [45, 48, 50, 52, 55, 57];
    const varied = new BossFight(bossHealth(1, 1));
    let n = 0;
    while (!varied.defeated && n < 100) varied.hit(scale[n++ % scale.length]);
    expect(varied.defeated).toBe(true);
    expect(n).toBe(7);
    expect(varied.used.size).toBe(6);
    expect(varied.bonus(2)).toBe(BOSS_BONUS * 2);
    const stuck = new BossFight(bossHealth(1, 1));
    for (let i = 0; i < 40; i++) stuck.hit(45);
    expect(stuck.defeated).toBe(false);
    expect(stuck.bonus(1)).toBe(0);
    // ... and by the end of the bars the stuck player has dealt much less than the varied one.
    expect(stuck.dealt).toBeLessThan(varied.dealt);
  });

  it('the damage cannot overshoot, the guardian does not heal once defeated, bars are counted from the room beat', () => {
    const boss = new BossFight(8);
    expect(boss.hit(45).damage).toBe(8);
    expect(boss.defeated).toBe(true);
    expect(boss.stray()).toBe(0);
    expect(boss.hp).toBe(0);
    const b = new BossFight(70);
    expect(b.bars).toBe(BOSS_BARS);
    expect(b.barAt(0)).toBe(1);
    expect(b.barAt(3.9)).toBe(1);
    expect(b.barAt(4)).toBe(2);
    expect(b.barAt(1000)).toBe(BOSS_BARS);
    expect(b.timeUp(BOSS_BARS * 4 - 0.01)).toBe(false);
    expect(b.timeUp(BOSS_BARS * 4)).toBe(true);
  });

  it('health grows with the level and the floor', () => {
    expect(bossHealth(1, 1)).toBe(70);
    expect(bossHealth(1, 2)).toBe(80);
    expect(bossHealth(10, 2)).toBe(134);
    for (let l = 2; l <= 10; l++) expect(bossHealth(l, 1)).toBeGreaterThan(bossHealth(l - 1, 1));
  });

  it('the boss room works on the real Judge: scale notes resolve targets, others are wrong attempts', () => {
    const imp = improvisation(generate('scales', { instrument: 'bass4', level: 3, seed: 1, free: true, length: 30 }), 80);
    const boss = new BossFight(bossHealth(3, 1));
    const fake = new FakeInput();
    const session = new GameSession({ exercise: imp, input: fake, metronome: { on: false } });
    session.on('targetResolved', (r) => boss.hit(r.heard![0]));
    session.on('wrongAttempt', () => boss.stray());
    session.start();
    fake.advance(0.3);
    const notes = imp.targets[0].kind.type === 'anyOf' ? imp.targets[0].kind.midis : [];
    const play = (m: number) => {
      fake.inject(fakePluck(fake.now() + 0.05, m));
      fake.advance(0.25);
    };
    play(notes[0]);
    play(notes[0]);
    play(notes[1]);
    play(notes[0] + 1 === notes[1] ? notes[1] + 1 : notes[0] + 1);
    expect(boss.notes).toBe(3);
    expect(boss.strays).toBe(1);
    expect(boss.hp).toBe(bossHealth(3, 1) - (10 + 6 + 10) + 3);
    // The clock of an improvisation runs at the backing tempo.
    expect(session.clock.bpm).toBe(80);
  });
});
