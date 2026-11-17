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
    for (let i = 0; i < 6; i++) strong = updateMastery(strong, [hit('a')], T0 - (5 - i) * 2 * DAY_MS); // spaced rounds
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
    for (let i = 0; i < 9; i++) m = updateMastery(m, [hit('strong')], T0 - (8 - i) * DAY_MS);
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

describe('mastery: una ronda cuenta una vez por itemId', () => {
  const late = (itemId: string): TargetResult => ({ itemId, judgement: 'late', delta: 0.1 });
  const round = (n: number, f: (i: number) => TargetResult) => Array.from({ length: n }, (_, i) => f(i));

  it('una ronda perfecta de 16 notas iguales no llega a fuerza 1 ni a estabilidad de meses', () => {
    const m = updateMastery(emptyMastery(), round(16, () => hit('rhythm:eighths')), T0);
    const it = m.items['rhythm:eighths'];
    expect(it.strength).toBeLessThan(0.6);
    expect(it.stability).toBeLessThan(2);
    expect(it.seen).toBe(16); // se sigue contando lo oído, pero una sola actualización
  });

  it('una ronda con la mitad tarde puntúa menos que una perfecta, y un fallo en la ronda la penaliza', () => {
    const perfect = updateMastery(emptyMastery(), round(16, () => hit('x')), T0).items.x;
    const half = updateMastery(emptyMastery(), round(16, (i) => (i % 2 ? late('x') : hit('x'))), T0).items.x;
    const withMiss = updateMastery(emptyMastery(), round(16, (i) => (i === 0 ? miss('x') : hit('x'))), T0).items.x;
    expect(half.strength).toBeLessThan(perfect.strength);
    expect(withMiss.strength).toBeLessThan(half.strength);
  });

  it('repetir en el mismo instante no construye estabilidad; con tiempo entre rondas sí', () => {
    let crammed = emptyMastery();
    for (let i = 0; i < 10; i++) crammed = updateMastery(crammed, [hit('a')], T0);
    let spaced = emptyMastery();
    for (let i = 0; i < 10; i++) spaced = updateMastery(spaced, [hit('a')], T0 + i * 3 * DAY_MS);
    expect(crammed.items.a.stability).toBeLessThan(3);
    expect(spaced.items.a.stability).toBeGreaterThan(crammed.items.a.stability * 3);
  });

  it('un acorde de bajo con 3 notas iguales y una fallada no sube como tres aciertos', () => {
    const m = updateMastery(emptyMastery(), [hit('chords:E'), hit('chords:E'), miss('chords:E'), hit('chords:E')], T0);
    expect(m.items['chords:E'].strength).toBeLessThan(0.3);
    expect(m.items['chords:E'].misses).toBe(1);
  });

  it('el repaso vuelve a pedir una ronda a medias y un acorde flojo', () => {
    const half = updateMastery(emptyMastery(), round(16, (i) => (i % 2 ? late('rhythm:eighths') : hit('rhythm:eighths'))), T0);
    const chord = updateMastery(half, [hit('chords:Em'), miss('chords:Em'), miss('chords:Em')], T0);
    for (const days of [1, 3, 10]) {
      expect(pickForReview(chord, T0 + days * DAY_MS, 10).sort()).toEqual(['chords:Em', 'rhythm:eighths']);
    }
  });

  it('el formato JSON no cambia', () => {
    const m = updateMastery(emptyMastery(), [hit('a'), hit('a')], T0);
    expect(Object.keys(toJSON(m).items.a).sort()).toEqual(['hits', 'lastSeen', 'misses', 'seen', 'stability', 'strength']);
    expect(toJSON(m).version).toBe(1);
  });
});
