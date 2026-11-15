import { describe, expect, it } from 'vitest';
import { generate } from '../src/exercises';
import type { SkillId } from '../src/model/exercise';
import type { InstrumentId } from '../src/model/instrument';
import { runRobot } from './helpers/robot';

const SKILLS: SkillId[] = ['frets', 'strings', 'rhythm', 'scales'];
const LEVELS = [1, 5, 10];
const INSTS: InstrumentId[] = ['guitar', 'bass4'];
const LOG = process.env.ROBOT_LOG === '1';

// Keep audio short: scales are the longest runs, so they are capped.
const lengthFor = (skill: SkillId) => (skill === 'scales' ? 12 : 8);

describe('perfect robot', () => {
  for (const skill of SKILLS)
    for (const instrument of INSTS)
      for (const level of LEVELS) {
        it(`${skill} L${level} on ${instrument} scores > 95%`, () => {
          const ex = generate(skill, { instrument, level, seed: 7, length: lengthFor(skill) });
          const run = runRobot(ex, { seed: 3 });
          if (LOG) console.log(`PERFECT ${skill} L${level} ${instrument}: n=${ex.targets.length} acc=${run.summary.accuracy.toFixed(3)} clean=${run.summary.cleanliness.toFixed(3)} strays=${run.summary.strays} stars=${run.summary.stars}`);
          expect(run.summary.accuracy).toBeGreaterThan(0.95);
          expect(run.summary.stars).toBe(3);
        });
      }
});

describe('imperfect robots', () => {
  for (const instrument of INSTS) {
    const ex = generate('strings', { instrument, level: 10, seed: 5, length: 20 });

    it(`${instrument}: a 150 ms late robot gets late/miss and a clearly lower score`, () => {
      const perfect = runRobot(ex, { seed: 3 });
      const late = runRobot(ex, { seed: 3, delayMs: 150 });
      const s = late.summary;
      if (LOG) console.log(`DELAY150 ${instrument}: perfect=${perfect.summary.accuracy.toFixed(3)} late: acc=${s.accuracy.toFixed(3)} hits=${s.hits} late=${s.late} miss=${s.miss} meanErr=${s.meanTimingError?.toFixed(3)} score=${s.score.toFixed(3)} vs ${perfect.summary.score.toFixed(3)}`);
      expect(s.late + s.miss).toBeGreaterThanOrEqual(0.7 * s.total);
      expect(s.accuracy).toBeLessThan(perfect.summary.accuracy - 0.3);
      expect(s.score).toBeLessThan(perfect.summary.score - 0.1);
      expect(s.tendency).toBe('drag');
    });

    it(`${instrument}: calibrating the latency offset recovers the score`, () => {
      const run = runRobot(ex, { seed: 3, delayMs: 150, judge: { latencyOffset: 0.15 } });
      expect(run.summary.accuracy).toBeGreaterThan(0.95);
    });

    it(`${instrument}: 30% wrong notes score about 70% (timed)`, () => {
      const run = runRobot(ex, { seed: 3, wrongRate: 0.3 });
      if (LOG) console.log(`WRONG30 timed ${instrument}: acc=${run.summary.accuracy.toFixed(3)} wrong=${run.summary.wrong} miss=${run.summary.miss} strays=${run.summary.strays}`);
      expect(run.summary.accuracy).toBeGreaterThanOrEqual(0.6);
      expect(run.summary.accuracy).toBeLessThanOrEqual(0.8);
    });

    it(`${instrument}: 30% wrong notes score about 70% (untimed, retries count as unclean)`, () => {
      const un = generate('frets', { instrument, level: 5, seed: 5, length: 20 });
      const run = runRobot(un, { seed: 3, wrongRate: 0.3 });
      if (LOG) console.log(`WRONG30 untimed ${instrument}: acc=${run.summary.accuracy.toFixed(3)} clean=${run.summary.cleanliness.toFixed(3)}`);
      expect(run.summary.accuracy).toBeGreaterThanOrEqual(0.6);
      expect(run.summary.accuracy).toBeLessThanOrEqual(0.8);
    });

    it(`${instrument}: 20% skipped notes are reported as misses`, () => {
      const run = runRobot(ex, { seed: 3, skipRate: 0.2 });
      expect(run.summary.miss).toBe(4);
      expect(run.summary.accuracy).toBeGreaterThan(0.7);
      expect(run.summary.accuracy).toBeLessThan(0.85);
    });
  }
});

describe('chords (informative, pitch-based verification)', () => {
  it('guitar strummed chords are recognised by the real detector', () => {
    const ex = generate('chords', { instrument: 'guitar', level: 4, seed: 2, length: 6 });
    const run = runRobot(ex, { seed: 3, untimedGap: 1.2 });
    if (LOG) console.log(`CHORDS guitar L4: acc=${run.summary.accuracy.toFixed(3)} wrong=${run.summary.wrong}`);
    expect(run.summary.accuracy).toBeGreaterThan(0.8);
  });
  it('bass chord notes (root, fifth, octave) are recognised', () => {
    const ex = generate('chords', { instrument: 'bass4', level: 2, seed: 2, length: 3 });
    const run = runRobot(ex, { seed: 3 });
    expect(run.summary.accuracy).toBeGreaterThan(0.95);
  });
});
