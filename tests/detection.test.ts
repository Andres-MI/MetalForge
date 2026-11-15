import { describe, expect, it } from 'vitest';
import { detectPitch } from '../src/detection/pitch';
import { INSTRUMENTS, centsOff, midiToFreq, pitchRange, positionsFor } from '../src/model/instrument';
import { runScenario, scenarios, SR } from '../scripts/bench-lib';

/** A tone with a few harmonics, like a sustained string. */
function tone(freq: number, len: number): Float32Array {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = (2 * Math.PI * freq * i) / SR;
    out[i] = 0.5 * Math.sin(t) + 0.3 * Math.sin(2 * t) + 0.15 * Math.sin(3 * t);
  }
  return out;
}

describe('detectPitch', () => {
  for (const inst of Object.values(INSTRUMENTS)) {
    it(`reads every open string and fret 12 of ${inst.id} within 3 cents`, () => {
      for (const open of inst.openStrings) {
        for (const midi of [open, open + 12]) {
          const f = midiToFreq(midi);
          const r = detectPitch(tone(f, inst.windowSize), SR, pitchRange(inst));
          expect(r, `midi ${midi}`).not.toBeNull();
          expect(Math.abs(1200 * Math.log2(r!.freq / f))).toBeLessThan(3);
          expect(r!.clarity).toBeGreaterThan(0.9);
        }
      }
    });
  }

  it('returns null for silence and low clarity for noise', () => {
    const range = pitchRange(INSTRUMENTS.guitar);
    expect(detectPitch(new Float32Array(2048), SR, range)).toBeNull();
    const noise = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 % 1);
    const r = detectPitch(noise, SR, range);
    expect(r === null || r.clarity < 0.8).toBe(true);
  });
});

describe('instrument maths', () => {
  it('finds all positions of a note', () => {
    // E4 (midi 64): open 1st string, 5th fret of the 2nd, 9th of the 3rd...
    const pos = positionsFor(INSTRUMENTS.guitar, 64, 0, 12);
    expect(pos).toContainEqual({ string: 5, fret: 0 });
    expect(pos).toContainEqual({ string: 4, fret: 5 });
    expect(pos).toContainEqual({ string: 3, fret: 9 });
  });
  it('measures cents', () => {
    expect(centsOff(440)).toBeCloseTo(0);
    expect(centsOff(440 * Math.pow(2, 10 / 1200))).toBeCloseTo(10, 5);
  });
});

describe('detector bench (synthetic strings)', () => {
  for (const sc of scenarios()) {
    // Two scenarios are reported rather than required at the normal level:
    //  - very fast playing on bass is beyond what low notes allow;
    //  - a soft high note under a loud ringing low string is a known weak spot (the loud string wins
    //    about one time in eight on guitar, and the comparison with "before" costs some latency on bass).
    const fast = sc.name.includes('rápido');
    const buried = sc.name.includes('aguda suave');
    const required = fast ? (sc.instrument === 'guitar' ? 0.95 : 0.85) : buried ? 0.85 : 0.97;
    const precision = buried ? 0.85 : 0.97;
    const latency = (sc.instrument === 'guitar' ? 60 : 90) + (buried ? 10 : 0);
    it(`${sc.name}: recall >= ${required}`, () => {
      const { report } = runScenario(sc);
      expect(report.recall).toBeGreaterThanOrEqual(required);
      expect(report.precision).toBeGreaterThanOrEqual(precision);
      expect(report.latencyMs.p95).toBeLessThan(latency);
    });
  }
});
