import { describe, expect, it } from 'vitest';
import { FIRST_BATCH, MAX_LEVEL, fretsZone, generate, scalesZone, stringsZone } from '../src/exercises';
import type { Exercise, SkillId } from '../src/model/exercise';
import { INSTRUMENTS, midiAt, type InstrumentId } from '../src/model/instrument';

const INSTS: InstrumentId[] = ['guitar', 'bass4', 'bass5'];
const SEEDS = [1, 2, 3, 4, 5, 6];
const levels = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);
const sig = (e: Exercise) => JSON.stringify(e.targets) + e.bpm;

describe('generators', () => {
  for (const skill of FIRST_BATCH) {
    for (const instrument of INSTS) {
      it(`${skill}/${instrument}: deterministic, every level differs from the previous, well formed`, () => {
        for (const seed of SEEDS) {
          let prev = '';
          for (const level of levels) {
            const a = generate(skill, { instrument, level, seed });
            const b = generate(skill, { instrument, level, seed });
            expect(sig(a), `determinism L${level}`).toBe(sig(b));
            expect(a.targets.length).toBeGreaterThan(0);
            expect(a.skill).toBe(skill);
            expect(a.instrument).toBe(instrument);
            for (const t of a.targets) {
              expect(t.itemId.startsWith(`${skill}:`)).toBe(true);
              if (a.timed) expect(t.beat).toBeDefined();
              else expect(t.beat).toBeUndefined();
            }
            expect(sig(a), `L${level} must differ from L${level - 1} (seed ${seed})`).not.toBe(prev);
            prev = sig(a);
          }
        }
      });
    }
  }

  it('different seeds give different exercises', () => {
    for (const skill of FIRST_BATCH) {
      const set = new Set(SEEDS.map((seed) => sig(generate(skill, { instrument: 'guitar', level: 7, seed }))));
      expect(set.size, skill).toBeGreaterThan(1);
    }
  });

  it('refuses skills without generator', () => {
    expect(() => generate('ear', { instrument: 'guitar', level: 1, seed: 1 })).toThrow();
  });
});

describe('pitch rule: the detector hears pitch, not string', () => {
  const unique = (instrument: InstrumentId, zone: { string: number; fret: number }[]) => {
    const inst = INSTRUMENTS[instrument];
    const pitches = zone.map((p) => midiAt(inst, p));
    return new Set(pitches).size === pitches.length;
  };

  for (const instrument of INSTS) {
    it(`${instrument}: frets and strings zones never repeat a pitch, targets stay inside the zone`, () => {
      const inst = INSTRUMENTS[instrument];
      for (const level of levels) {
        for (const seed of SEEDS) {
          const fz = fretsZone(instrument, level, seed);
          expect(unique(instrument, fz), `frets L${level} s${seed}`).toBe(true);
          const ex = generate('frets', { instrument, level, seed, length: 20 });
          for (const t of ex.targets) {
            expect(t.kind.type).toBe('note');
            if (t.kind.type !== 'note') continue;
            expect(fz).toContainEqual(t.kind.pos);
            expect(midiAt(inst, t.kind.pos!)).toBe(t.kind.midi);
          }
        }
        const sz = stringsZone(instrument, level);
        expect(unique(instrument, sz), `strings L${level}`).toBe(true);
        for (const seed of SEEDS) {
          const ex = generate('strings', { instrument, level, seed, length: 16 });
          for (const t of ex.targets) {
            if (t.kind.type !== 'note') throw new Error('note expected');
            expect(sz).toContainEqual(t.kind.pos);
          }
        }
      }
    });

    it(`${instrument}: any two different itemIds of an exercise ask for different pitches`, () => {
      for (const skill of ['frets', 'strings', 'scales'] as SkillId[]) {
        for (const level of levels) {
          for (const seed of SEEDS) {
            const ex = generate(skill, { instrument, level, seed, length: 24 });
            const byPitch = new Map<number, Set<string>>();
            for (const t of ex.targets) {
              if (t.kind.type !== 'note') continue;
              if (!byPitch.has(t.kind.midi)) byPitch.set(t.kind.midi, new Set());
              byPitch.get(t.kind.midi)!.add(t.kind.pos ? `${t.kind.pos.string}:${t.kind.pos.fret}` : '');
            }
            // Same pitch must always be the same position inside one exercise.
            for (const [midi, positions] of byPitch) expect(positions.size, `${skill} L${level} midi ${midi}`).toBe(1);
          }
        }
      }
    });

    it(`${instrument}: scale zones have unique pitches and stay on the neck`, () => {
      const inst = INSTRUMENTS[instrument];
      for (const level of levels)
        for (const seed of SEEDS) {
          const z = scalesZone(instrument, level, seed);
          expect(z.length).toBeGreaterThanOrEqual(5);
          expect(new Set(z.map((n) => n.midi)).size).toBe(z.length);
          for (const n of z) expect(n.pos.fret).toBeLessThanOrEqual(inst.frets);
        }
    });
  }

  it('single-string frets levels cover a growing, then two-string zone', () => {
    const sizes = levels.map((l) => fretsZone('guitar', l, 1).length);
    for (let i = 1; i < 5; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    expect(new Set(fretsZone('guitar', 7, 1).map((p) => p.string)).size).toBe(2);
  });
});

describe('physical playability', () => {
  it('low levels keep jumps small and positions inside the neck', () => {
    for (const instrument of INSTS) {
      const inst = INSTRUMENTS[instrument];
      for (const seed of SEEDS) {
        for (const level of [1, 2, 3, 4, 5]) {
          const ex = generate('frets', { instrument, level, seed, length: 30 });
          const midis = ex.targets.map((t) => (t.kind.type === 'note' ? t.kind.midi : 0));
          for (let i = 1; i < midis.length; i++) expect(Math.abs(midis[i] - midis[i - 1])).toBeLessThanOrEqual(5);
        }
        for (const level of levels) {
          for (const skill of FIRST_BATCH) {
            const ex = generate(skill, { instrument, level, seed });
            for (const t of ex.targets) {
              const k = t.kind;
              const ps = k.type === 'note' ? (k.pos ? [k.pos] : []) : k.type === 'chord' ? k.shape ?? [] : [];
              for (const p of ps) {
                expect(p.fret).toBeGreaterThanOrEqual(0);
                expect(p.fret).toBeLessThanOrEqual(inst.frets);
                expect(p.string).toBeLessThan(inst.openStrings.length);
              }
            }
          }
        }
      }
    }
  });

  it('guitar chord shapes span at most four frets (barre and open shapes)', () => {
    for (const level of levels) {
      const ex = generate('chords', { instrument: 'guitar', level, seed: 3, length: 12 });
      for (const t of ex.targets) {
        if (t.kind.type !== 'chord') throw new Error('chord expected');
        const fretted = t.kind.shape!.map((p) => p.fret).filter((f) => f > 0);
        if (fretted.length) expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('chords', () => {
  it('guitar: shapes match midis; changes get "A>B" ids; new chords appear by level', () => {
    const l4 = generate('chords', { instrument: 'guitar', level: 4, seed: 1, length: 12 });
    const names = new Set(l4.targets.map((t) => (t.kind.type === 'chord' ? t.kind.name : '')));
    expect(names.has('G') && names.has('C')).toBe(true);
    const l5 = generate('chords', { instrument: 'guitar', level: 5, seed: 1 });
    expect(l5.targets.slice(1).every((t) => /^chords:\w+>\w+$/.test(t.itemId))).toBe(true);
    const l7 = generate('chords', { instrument: 'guitar', level: 7, seed: 1 });
    expect(l7.targets.some((t) => t.kind.type === 'chord' && t.kind.name === 'F')).toBe(true);
    const l8 = generate('chords', { instrument: 'guitar', level: 8, seed: 1 });
    expect(l8.targets.every((t) => t.kind.type === 'chord' && /5$/.test(t.kind.name))).toBe(true);
    const em = generate('chords', { instrument: 'guitar', level: 1, seed: 1 }).targets.find((t) => t.kind.type === 'chord' && t.kind.name === 'Em')!;
    if (em.kind.type === 'chord') expect(em.kind.midis).toEqual([40, 47, 52, 55, 59, 64]);
  });

  it('bass: root, fifth, octave as note targets', () => {
    for (const instrument of ['bass4', 'bass5'] as InstrumentId[]) {
      const ex = generate('chords', { instrument, level: 1, seed: 1, length: 4 });
      expect(ex.targets.length).toBe(12);
      for (let i = 0; i < ex.targets.length; i += 3) {
        const [r, f, o] = ex.targets.slice(i, i + 3).map((t) => (t.kind.type === 'note' ? t.kind.midi : -1));
        expect(f - r).toBe(7);
        expect(o - r).toBe(12);
        expect(r).toBeGreaterThanOrEqual(28);
        expect(r).toBeLessThan(40);
      }
    }
  });

  it('level 10 is a timed progression on every instrument', () => {
    for (const instrument of INSTS) {
      const ex = generate('chords', { instrument, level: 10, seed: 2 });
      expect(ex.timed).toBe(true);
      expect(ex.bpm).toBeGreaterThan(0);
    }
  });
});

describe('scales', () => {
  it('free variant uses anyOf', () => {
    const ex = generate('scales', { instrument: 'bass4', level: 3, seed: 1, free: true, length: 6 });
    expect(ex.targets.length).toBe(6);
    expect(ex.targets.every((t) => t.kind.type === 'anyOf')).toBe(true);
  });
  it('rhythm tempo rises gently', () => {
    const bpms = levels.map((l) => generate('rhythm', { instrument: 'guitar', level: l, seed: 1 }).bpm!);
    for (let i = 1; i < bpms.length; i++) expect(bpms[i]).toBeGreaterThan(bpms[i - 1]);
    expect(bpms[9] - bpms[0]).toBeLessThanOrEqual(40);
  });
});
