import { describe, expect, it } from 'vitest';
import { generate, rhythmBpm } from '../src/exercises';
import { playFake } from '../src/game/fakePlayer';
import { FakeInput } from '../src/game/input';
import { readBest, readMastery, saveArcadeBest, writeBest, writeMastery } from '../src/game/progressBlob';
import { bpmRange, nextBpm, restartBpm } from '../src/game/salto/pace';
import { CLEAN_POINTS, CLUMSY_POINTS, comboMultiplier, FLAWLESS_BONUS, MAX_HEARTS, MAX_RESTARTS, ROUNDS, SaltoRun } from '../src/game/salto/state';
import { GameSession } from '../src/game/session';
import type { InstrumentId } from '../src/model/instrument';
import { emptyMastery } from '../src/progress';
import { MemoryStorage } from '../src/profile/memory';
import { ProfileStore } from '../src/profile/store';
import { summarize } from '../src/scoring/summary';
import type { ScoredTarget } from '../src/scoring/types';

describe('adaptive speed (pure)', () => {
  it('goes up with high accuracy, holds in the middle, down with low accuracy', () => {
    expect(nextBpm(60, 1, 60)).toBe(65);
    expect(nextBpm(60, 0.9, 60)).toBe(65);
    expect(nextBpm(60, 0.85, 60)).toBe(62);
    expect(nextBpm(60, 0.7, 60)).toBe(60);
    expect(nextBpm(60, 0.5, 60)).toBe(55);
    expect(nextBpm(60, 0.1, 60)).toBe(51);
  });

  it('stays inside the band of the level for every level and accuracy', () => {
    for (let level = 1; level <= 10; level++) {
      const base = rhythmBpm(level);
      const r = bpmRange(base);
      expect(r.min).toBeLessThan(base);
      expect(r.max).toBeGreaterThan(base);
      for (const acc of [0, 0.3, 0.5, 0.7, 0.85, 1]) {
        let bpm = base;
        for (let i = 0; i < 30; i++) {
          bpm = nextBpm(bpm, acc, base);
          expect(bpm).toBeGreaterThanOrEqual(r.min);
          expect(bpm).toBeLessThanOrEqual(r.max);
        }
        if (acc >= 0.9) expect(bpm).toBe(r.max);
        if (acc < 0.4) expect(bpm).toBe(r.min);
        if (acc === 0.7) expect(bpm).toBe(base);
      }
    }
  });

  it('a restart is always slower until its floor, and the next round never jumps back up by itself', () => {
    expect(restartBpm(60, 60)).toBe(51);
    expect(restartBpm(51, 60)).toBe(43);
    let bpm = 60;
    for (let i = 0; i < 10; i++) bpm = restartBpm(bpm, 60);
    expect(bpm).toBe(36);
    expect(nextBpm(43, 0.7, 60)).toBe(43); // under the band after two retries: an average round keeps it
    expect(nextBpm(43, 1, 60)).toBeGreaterThan(43);
  });
});

describe('Salto rules (pure)', () => {
  it('multiplier grows every 5 clean jumps up to x5', () => {
    expect([0, 4, 5, 9, 10, 19, 20, 99].map(comboMultiplier)).toEqual([1, 1, 2, 2, 3, 4, 5, 5]);
  });

  it('perfect run: full hearts, combo = every target, flawless bonus, tempo rises, over after the last round', () => {
    const run = new SaltoRun(60);
    const bpms = [run.bpm];
    let expected = 0;
    let combo = 0;
    for (let round = 1; round <= ROUNDS; round++) {
      expect(run.plan()).toMatchObject({ round, retry: false, countInBeats: 4 });
      for (let i = 0; i < 16; i++) {
        const r = run.resolve('hit', i);
        expect(r).toMatchObject({ outcome: 'clean', heartLost: false, roundFailed: false });
        expected += CLEAN_POINTS * comboMultiplier(combo);
        combo++;
      }
      const end = run.completeRound();
      expected += FLAWLESS_BONUS * round;
      expect(end.accuracy).toBe(1);
      expect(end.over).toBe(round === ROUNDS);
      bpms.push(run.bpm);
    }
    expect(run.score).toBe(expected);
    expect(run.bestCombo).toBe(16 * ROUNDS);
    expect(run.hearts).toBe(MAX_HEARTS);
    expect(run.restarts).toBe(0);
    expect(run.over).toBe(true);
    expect(bpms.slice(0, ROUNDS)).toEqual([60, 65, 70]);
  });

  it('late run: clumsy jumps keep the hearts but score less, break the combo and do not speed up', () => {
    const clean = new SaltoRun(60);
    const late = new SaltoRun(60);
    for (let i = 0; i < 16; i++) {
      clean.resolve('hit', i);
      expect(late.resolve('late', i)).toMatchObject({ outcome: 'clumsy', points: CLUMSY_POINTS, heartLost: false });
    }
    expect(late.hearts).toBe(MAX_HEARTS);
    expect(late.bestCombo).toBe(0);
    expect(late.momentum).toBeLessThan(clean.momentum);
    expect(late.score).toBe(16 * CLUMSY_POINTS);
    expect(late.score).toBeLessThan(clean.score);
    const end = late.completeRound();
    expect(end.accuracy).toBe(0.5);
    expect(end.bonus).toBe(0);
    expect(late.bpm).toBe(55); // 0.5 accuracy: slower
  });

  it('a clumsy jump halves the combo, a miss resets it', () => {
    const run = new SaltoRun(80);
    for (let i = 0; i < 12; i++) run.resolve('hit', i);
    expect([run.combo, run.multiplier]).toEqual([12, 3]);
    run.resolve('early', 12);
    expect(run.combo).toBe(6);
    run.resolve('miss', 13);
    expect([run.combo, run.bestCombo, run.hearts]).toEqual([0, 12, MAX_HEARTS - 1]);
  });

  it('missed notes: a heart each, brief invulnerability, then the round restarts slower with full hearts', () => {
    const run = new SaltoRun(60);
    expect(run.resolve('miss', 0)).toMatchObject({ outcome: 'stumble', heartLost: true, roundFailed: false });
    expect(run.isInvulnerable(1)).toBe(true);
    expect(run.resolve('miss', 1)).toMatchObject({ outcome: 'spared', heartLost: false }); // 1 < 0 + 1.5
    expect(run.hearts).toBe(2);
    expect(run.resolve('miss', 2)).toMatchObject({ outcome: 'stumble', roundFailed: false });
    expect(run.resolve('hit', 3).outcome).toBe('clean');
    const last = run.resolve('miss', 4);
    expect(last).toMatchObject({ outcome: 'stumble', heartLost: true, roundFailed: true });
    expect(run.hearts).toBe(0);
    const scoreBefore = run.score;
    const fail = run.failRound();
    expect(fail).toEqual({ over: false, bpm: 51 });
    expect(run.plan()).toMatchObject({ round: 1, retry: true, bpm: 51, attempt: 2, countInBeats: 4 });
    expect([run.hearts, run.combo, run.restarts, run.score]).toEqual([MAX_HEARTS, 0, 1, scoreBefore]);
    expect(run.isInvulnerable(0)).toBe(false);
  });

  it('never ends in the menu: retries get slower, and after the last retry the run is over', () => {
    const run = new SaltoRun(60);
    const bpms: number[] = [];
    let over = false;
    while (!over) {
      for (let b = 0; run.hearts > 0; b += 2) run.resolve('miss', b);
      const f = run.failRound();
      over = f.over;
      if (!over) bpms.push(f.bpm);
    }
    expect(bpms).toEqual([51, 43, 37]);
    expect(run.restarts).toBe(MAX_RESTARTS);
    expect(run.over).toBe(true);
    expect(run.score).toBe(0);
  });

  it('a good round gives a heart back', () => {
    const run = new SaltoRun(60);
    run.resolve('miss', 0);
    for (let i = 2; i < 40; i++) run.resolve('hit', i);
    expect(run.completeRound()).toMatchObject({ heartGained: true, over: false });
    expect(run.hearts).toBe(MAX_HEARTS);
  });
});

describe('arcade best score in the progress blob', () => {
  it('keeps the best per game+level and leaves mastery and other keys alone', () => {
    const blob = writeMastery({ other: 1 }, emptyMastery());
    expect(readBest(blob, 'salto', 3)).toBeNull();
    const a = writeBest(blob, 'salto', 3, { score: 1200, bestCombo: 10 });
    expect(a).toMatchObject({ previousBest: 0, newBest: true });
    expect(readBest(a.blob, 'salto', 3)).toEqual({ score: 1200, bestCombo: 10 });
    expect(readBest(a.blob, 'salto', 4)).toBeNull();
    const b = writeBest(a.blob, 'salto', 3, { score: 900, bestCombo: 30 });
    expect(b).toMatchObject({ previousBest: 1200, newBest: false });
    expect(readBest(b.blob, 'salto', 3)).toEqual({ score: 1200, bestCombo: 10 });
    const c = writeBest(b.blob, 'salto', 4, { score: 50, bestCombo: 1 });
    expect(readBest(c.blob, 'salto', 3)!.score).toBe(1200);
    expect(c.blob.other).toBe(1);
    expect(readMastery(c.blob)).toEqual(emptyMastery());
    expect(readBest({ arcadeBest: { 'salto:1': 'x' } }, 'salto', 1)).toBeNull();
  });

  it('saves through the profile store, per instrument', async () => {
    const store = new ProfileStore(new MemoryStorage());
    expect(await saveArcadeBest(store, 'bass5', 'salto', 2, { score: 700, bestCombo: 7 })).toEqual({ previousBest: 0, newBest: true });
    expect(await saveArcadeBest(store, 'bass5', 'salto', 2, { score: 800, bestCombo: 5 })).toEqual({ previousBest: 700, newBest: true });
    expect(await saveArcadeBest(store, 'bass5', 'salto', 2, { score: 100, bestCombo: 9 })).toEqual({ previousBest: 800, newBest: false });
    expect(readBest(await store.getProgress('bass5'), 'salto', 2)).toEqual({ score: 800, bestCombo: 5 });
    expect(readBest(await store.getProgress('guitar'), 'salto', 2)).toBeNull();
  });
});

/** Plays a whole Salto run the way the scene does: one session per round on a shared fake input. */
async function playRun(instrument: InstrumentId, level: number, play: { offsetMs?: number; silent?: boolean }) {
  const fake = new FakeInput();
  fake.advanceTo(20);
  const first = generate('rhythm', { instrument, level, seed: 5, length: 16 });
  const run = new SaltoRun(first.bpm!);
  let session = new GameSession({ exercise: first, input: fake, metronome: { on: false } });
  const bpms: number[] = [];
  const completed: ScoredTarget[] = [];
  const attempted: ScoredTarget[] = [];
  let sessions = 0;
  while (!run.over && sessions < 20) {
    sessions++;
    const plan = run.plan();
    bpms.push(session.exercise.bpm!);
    expect(session.exercise.bpm).toBe(plan.bpm);
    let failed = false;
    let done: ScoredTarget[] | null = null;
    const s = session;
    s.on('targetResolved', (r) => {
      if (failed) return;
      attempted.push(r);
      if (run.resolve(r.judgement, s.exercise.targets[r.index].beat ?? 0).roundFailed) failed = true;
    });
    s.on('finished', (_sum, results) => (done = results));
    s.start();
    expect(s.clock.countInBeats).toBe(plan.countInBeats);
    if (play.silent) {
      while (!failed && !done && fake.now() < 2000) {
        fake.advance(0.02);
        await Promise.resolve();
      }
    } else {
      playFake(s, fake, { offsetMs: play.offsetMs });
      for (let i = 0; i < 5 && !done; i++) await Promise.resolve();
    }
    if (failed) run.failRound();
    else {
      expect(done).not.toBeNull();
      completed.push(...done!);
      run.completeRound();
    }
    s.release();
    fake.clearPending();
    if (!run.over) {
      const p = run.plan();
      session = s.spawn({ ...generate('rhythm', { instrument, level, seed: 5 + (p.round - 1) * 7919, length: 16 }), bpm: p.bpm }, { countInBeats: p.countInBeats });
    }
  }
  const pool = completed.length ? completed : attempted;
  return { run, bpms, sessions, summary: summarize(pool, Math.max(1, pool.length), true, 0), input: fake, session };
}

describe('Salto on real sessions and the Judge (fake input)', () => {
  for (const instrument of ['guitar', 'bass4', 'bass5'] as InstrumentId[]) {
    it(`${instrument}: perfect run = 3 stars, full hearts, long combo, faster each round`, async () => {
      const { run, bpms, sessions, summary } = await playRun(instrument, 3, {});
      expect(sessions).toBe(ROUNDS);
      expect(summary.stars).toBe(3);
      expect(summary.accuracy).toBe(1);
      expect(run.hearts).toBe(MAX_HEARTS);
      expect(run.restarts).toBe(0);
      expect(run.bestCombo).toBe(summary.total);
      expect(run.bestCombo).toBeGreaterThanOrEqual(3 * 16);
      expect(bpms[1]).toBeGreaterThan(bpms[0]);
      expect(bpms[2]).toBeGreaterThan(bpms[1]);
    });
  }

  it('150 ms late: no hearts lost, lower score than perfect, tempo goes down', async () => {
    const perfect = await playRun('guitar', 1, {});
    const late = await playRun('guitar', 1, { offsetMs: 150 });
    expect(late.sessions).toBe(ROUNDS);
    expect(late.summary.late).toBe(late.summary.total);
    expect(late.run.hearts).toBe(MAX_HEARTS);
    expect(late.run.score).toBeLessThan(perfect.run.score / 4);
    expect(late.run.bestCombo).toBe(0);
    expect(late.summary.stars).toBeLessThan(3);
    expect(late.bpms[1]).toBeLessThan(late.bpms[0]);
  });

  it('silence: hearts run out, the round restarts slower (never past the retries), then the run ends', async () => {
    const { run, bpms, sessions, summary, session, input } = await playRun('guitar', 1, { silent: true });
    expect(sessions).toBe(MAX_RESTARTS + 1);
    expect(run.restarts).toBe(MAX_RESTARTS);
    expect(bpms).toEqual([60, 51, 43, 37]);
    expect(run.round).toBe(1);
    expect(run.score).toBe(0);
    expect(summary.accuracy).toBe(0);
    expect(summary.miss).toBe(summary.total);
    // release() keeps the shared input usable; dispose() is what closes it.
    let seen = 0;
    input.subscribe(() => seen++);
    input.advance(0.1);
    expect(seen).toBe(1);
    session.dispose();
    input.advance(0.1);
    expect(seen).toBe(1);
  });
});
