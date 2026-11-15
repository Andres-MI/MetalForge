import { describe, expect, it } from 'vitest';
import { DAY_MS, currentStrength, emptyMastery, fromJSON, pickForReview, toJSON, updateMastery } from '../src/progress';
import type { TargetResult } from '../src/model/exercise';

const hit = (itemId: string): TargetResult => ({ itemId, judgement: 'hit', delta: 0 });
const miss = (itemId: string): TargetResult => ({ itemId, judgement: 'miss', delta: 0 });
const T0 = 1_700_000_000_000;

describe('mastery', () => {
  it('rises with hits, falls with misses', () => {
    let m = emptyMastery();
    const s: number[] = [];
    for (let i = 0; i < 4; i++) {
      m = updateMastery(m, [hit('a')], T0);
      s.push(currentStrength(m.items.a, T0));
    }
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
    const before = s[3];
    m = updateMastery(m, [miss('a')], T0);
    expect(currentStrength(m.items.a, T0)).toBeLessThan(before * 0.6);
  });

  it('decays with time, and well-learned items decay slower', () => {
    let weak = updateMastery(emptyMastery(), [hit('a')], T0);
    let strong = emptyMastery();
    for (let i = 0; i < 6; i++) strong = updateMastery(strong, [hit('a')], T0);
    const later = T0 + 3 * DAY_MS;
    expect(currentStrength(weak.items.a, later)).toBeLessThan(currentStrength(weak.items.a, T0));
    const lossWeak = currentStrength(weak.items.a, later) / currentStrength(weak.items.a, T0);
    const lossStrong = currentStrength(strong.items.a, later) / currentStrength(strong.items.a, T0);
    expect(lossStrong).toBeGreaterThan(lossWeak);
    weak = updateMastery(weak, [], later);
    expect(weak.items.a.lastSeen).toBe(T0); // nothing changes without results
  });

  it('wrong attempts weaken a hit', () => {
    const clean = updateMastery(emptyMastery(), [hit('a')], T0);
    const retried = updateMastery(emptyMastery(), [{ ...hit('a'), wrongAttempts: 2 }], T0);
    expect(currentStrength(retried.items.a, T0)).toBeLessThan(currentStrength(clean.items.a, T0));
  });

  it('picks the items most in need of review', () => {
    let m = emptyMastery();
    for (let i = 0; i < 5; i++) m = updateMastery(m, [hit('strong')], T0);
    m = updateMastery(m, [hit('old')], T0 - 10 * DAY_MS);
    m = updateMastery(m, [hit('weak'), miss('weak')], T0);
    const picks = pickForReview(m, T0, 2);
    expect(picks).toHaveLength(2);
    expect(picks).not.toContain('strong');
    expect(picks[0]).toBe('old'); // forgotten
    expect(pickForReview(m, T0, 10, { candidates: ['never', 'strong'] })).toEqual(['never']);
    expect(pickForReview(m, T0, 10, { prefix: 'w' })).toEqual(['weak']);
    // a month later even the strong one is due
    expect(pickForReview(m, T0 + 60 * DAY_MS, 10)).toContain('strong');
  });

  it('round-trips through JSON and survives garbage', () => {
    let m = emptyMastery();
    m = updateMastery(m, [hit('a'), miss('b'), hit('a')], T0);
    const text = JSON.stringify(toJSON(m));
    expect(fromJSON(JSON.parse(text))).toEqual(m);
    expect(fromJSON(null)).toEqual(emptyMastery());
    expect(fromJSON({ items: { x: { strength: 'bad' }, y: 3 } }).items.x.strength).toBe(0);
  });
});
