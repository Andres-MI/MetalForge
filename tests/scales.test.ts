import { describe, expect, it } from 'vitest';
import { generate, scalesZone } from '../src/exercises';
import { backingPlan, vampRoot } from '../src/game/scales/backing';
import { improvisation, scaleBoardLayout } from '../src/game/scales/board';
import { FreeLog, inScale, isRoot, routeHolds, runPhases, scaleInfo, scaleName, targetMidis, zoneMidis } from '../src/game/scales/info';
import { rowY, slotX } from '../src/game/frets/board';
import { FakeInput } from '../src/game/input';
import { GameSession } from '../src/game/session';
import type { InstrumentId } from '../src/model/instrument';
import { fakePluck } from '../src/game/input';

const INSTRUMENT_IDS: InstrumentId[] = ['guitar', 'bass4', 'bass5'];

describe('scale info (pure)', () => {
  it('reads the scale, root and position from the exercise', () => {
    const a = generate('scales', { instrument: 'guitar', level: 1, seed: 1, length: 40 });
    const info = scaleInfo(a);
    expect(info).toMatchObject({ kind: 'pent-min', rootPc: 9, position: 1 });
    expect(scaleName(info)).toBe('La menor pentatónica');
    const b = generate('scales', { instrument: 'bass4', level: 3, seed: 1, length: 40 });
    expect(scaleInfo(b)).toMatchObject({ kind: 'major', rootPc: 0 });
    expect(scaleName(scaleInfo(b))).toBe('Do mayor');
  });

  it('every note of the zone is in the scale, roots are recognised, and the zone has no repeated pitch', () => {
    for (const id of INSTRUMENT_IDS) {
      for (let level = 1; level <= 10; level++) {
        const ex = generate('scales', { instrument: id, level, seed: 7, length: 40 });
        const info = scaleInfo(ex);
        const zone = scalesZone(id, level, 7);
        expect(new Set(zone.map((n) => n.midi)).size).toBe(zone.length);
        for (const n of zone) expect(inScale(info, n.midi)).toBe(true);
        expect(zone.some((n) => isRoot(info, n.midi))).toBe(true);
        expect(zoneMidis(ex).every((m) => zone.some((n) => n.midi === m))).toBe(true);
      }
    }
    expect(isRoot(scaleInfo(generate('scales', { instrument: 'guitar', level: 1, seed: 1 })), 45)).toBe(true);
    expect(isRoot(scaleInfo(generate('scales', { instrument: 'guitar', level: 1, seed: 1 })), 48)).toBe(false);
  });

  it('route holds: higher notes are higher on the wall, an updown run comes back down', () => {
    const ex = generate('scales', { instrument: 'guitar', level: 2, seed: 1, length: 40 });
    const holds = routeHolds(targetMidis(ex));
    expect(holds).toHaveLength(ex.targets.length);
    const top = holds.reduce((b, h) => (h.height > holds[b].height ? h.index : b), 0);
    expect(holds[0].height).toBe(0);
    expect(holds[top].height).toBe(1);
    expect(holds[holds.length - 1].height).toBe(0);
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(holds.length - 1);
    expect(routeHolds([60, 60]).map((h) => h.height)).toEqual([0, 0]);
  });

  it('phases: a run up has one, up and down has two split at the peak', () => {
    const up = generate('scales', { instrument: 'guitar', level: 1, seed: 1, length: 40 });
    expect(runPhases(targetMidis(up))).toEqual([{ start: 0, end: up.targets.length - 1, dir: 'up' }]);
    const ud = generate('scales', { instrument: 'guitar', level: 2, seed: 1, length: 40 });
    const midis = targetMidis(ud);
    const ph = runPhases(midis);
    expect(ph).toHaveLength(2);
    expect(midis[ph[0].end]).toBe(Math.max(...midis));
    expect(ph[1].start).toBe(ph[0].end + 1);
    expect(ph[1].end).toBe(midis.length - 1);
    const th = generate('scales', { instrument: 'guitar', level: 4, seed: 1, length: 40 });
    expect(runPhases(targetMidis(th))).toHaveLength(1);
    expect(runPhases([])).toEqual([]);
  });

  it('board layout: same slot mapping as the frets games, inside the area, one row per string of the zone', () => {
    for (const id of INSTRUMENT_IDS) {
      for (const level of [1, 3, 6, 9, 10]) {
        const zone = scalesZone(id, level, 5).map((n) => n.pos);
        const l = scaleBoardLayout(zone, { x0: 38, width: 278, centerY: 78 });
        expect(l.left).toBeGreaterThanOrEqual(38);
        expect(l.right).toBeLessThanOrEqual(316);
        expect(l.nutX).toBe(l.left + l.step);
        expect(l.step).toBeGreaterThanOrEqual(14);
        expect(slotX(l, 0)).toBeLessThan(slotX(l, 1));
        // The highest-pitched string is the top row.
        expect(l.strings[0]).toBe(Math.max(...zone.map((p) => p.string)));
        expect(rowY(l, l.strings[0])).toBeLessThan(rowY(l, l.strings[l.strings.length - 1]));
        const h = rowY(l, l.strings[l.strings.length - 1]) - rowY(l, l.strings[0]);
        expect(h).toBeLessThanOrEqual(66);
      }
    }
  });

  it('free variant: improvisation drops the clock but keeps the same notes and the same position', () => {
    for (const level of [1, 10]) {
      const free = generate('scales', { instrument: 'guitar', level, seed: 3, free: true, length: 30 });
      const imp = improvisation(free, 80);
      expect(imp.timed).toBe(false);
      expect(imp.bpm).toBe(80);
      expect(imp.targets).toHaveLength(30);
      expect(imp.targets.every((t) => t.beat === undefined && t.kind.type === 'anyOf')).toBe(true);
      const ordered = generate('scales', { instrument: 'guitar', level, seed: 3, length: 40 });
      expect(zoneMidis(imp)).toEqual(zoneMidis(ordered));
    }
  });
});

describe('free-mode bookkeeping (pure)', () => {
  it('counts the different scale notes visited and the notes outside the scale', () => {
    const log = new FreeLog([45, 48, 50, 52, 55]);
    expect(log.total).toBe(5);
    expect(log.inside(45)).toBe(true);
    expect(log.inside(45)).toBe(false);
    expect(log.inside(52)).toBe(true);
    log.stray(46);
    log.stray(46);
    log.stray(47);
    expect(log.visitedCount).toBe(2);
    expect(log.plays).toBe(6);
    expect(log.outside.get(46)).toBe(2);
    expect(log.outside.size).toBe(2);
    expect(log.last).toEqual({ midi: 47, inside: false });
    expect(log.complete).toBe(false);
    [48, 50, 55].forEach((m) => log.inside(m));
    expect(log.complete).toBe(true);
  });

  it('is fed by the Judge: scale notes resolve targets, outside notes are wrong attempts', () => {
    const free = improvisation(generate('scales', { instrument: 'guitar', level: 1, seed: 1, free: true, length: 6 }));
    const log = new FreeLog(zoneMidis(free));
    const fake = new FakeInput();
    const session = new GameSession({ exercise: free, input: fake });
    session.on('targetResolved', (r) => log.inside(r.heard![0]));
    session.on('wrongAttempt', (r) => log.stray(r.heard![0]));
    session.start();
    fake.advance(0.3);
    const [a, b] = zoneMidis(free);
    const play = (midi: number) => {
      fake.inject(fakePluck(fake.now() + 0.05, midi));
      fake.advance(0.2);
    };
    play(a);
    play(a + 1 === b ? b + 1 : a + 1); // outside the scale (a semitone from a scale note, not itself in the scale)
    play(b);
    expect(log.visitedCount).toBe(2);
    expect(log.outside.size).toBe(1);
    expect(log.plays).toBe(3);
  });
});

describe('boss backing (pure)', () => {
  it('builds a two-chord vamp on the scale root with only notes of the scale, for each root', () => {
    for (const rootPc of [9, 0]) {
      const info = scaleInfo(generate('scales', { instrument: 'guitar', level: rootPc === 9 ? 1 : 3, seed: 1 }));
      const plan = backingPlan(info.rootPc, 80, 8);
      expect(plan.duration).toBeCloseTo((8 * 4 * 60) / 80);
      expect(plan.notes.length).toBeGreaterThan(8 * 3);
      for (const n of plan.notes) {
        expect(inScale(info, n.midi)).toBe(true);
        expect(n.time).toBeGreaterThanOrEqual(0);
        expect(n.time).toBeLessThan(plan.duration);
      }
      // The first bar is on the root; bar 3 moves up a fourth.
      const root = vampRoot(info.rootPc);
      expect(isRoot(info, root)).toBe(true);
      const spb = 60 / 80;
      expect(plan.notes.filter((n) => n.time === 0).map((n) => n.midi)).toContain(root);
      expect(plan.notes.filter((n) => Math.abs(n.time - 8 * spb) < 1e-9).map((n) => n.midi)).toContain(root + 5);
    }
  });
});
