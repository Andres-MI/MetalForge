import { describe, expect, it } from 'vitest';
import { CHORDS, FIRST_BATCH, MAX_LEVEL, bassNotes, fretsZone, generate, levelLabel, scalesZone, stringsZone } from '../src/exercises';
import { PAIRS } from '../src/exercises/chords';
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
    const names = (level: number, seed = 1, length = 12) => generate('chords', { instrument: 'guitar', level, seed, length }).targets.map((t) => (t.kind.type === 'chord' ? t.kind.name : ''));
    const l4 = names(4);
    expect(l4).toContain('G');
    expect(l4).not.toContain('C'); // G and C come in separate levels
    expect(names(5)).toContain('C');
    const l6 = generate('chords', { instrument: 'guitar', level: 6, seed: 1 });
    expect(l6.targets.slice(1).every((t) => /^chords:\w+>\w+$/.test(t.itemId))).toBe(true);
    const l8 = generate('chords', { instrument: 'guitar', level: 8, seed: 1 });
    expect(l8.targets.some((t) => t.kind.type === 'chord' && t.kind.name === 'F')).toBe(true);
    const l9 = generate('chords', { instrument: 'guitar', level: 9, seed: 1 });
    expect(l9.targets.every((t) => t.kind.type === 'chord' && /5$/.test(t.kind.name))).toBe(true);
    const em = generate('chords', { instrument: 'guitar', level: 1, seed: 1 }).targets.find((t) => t.kind.type === 'chord' && t.kind.name === 'Em')!;
    if (em.kind.type === 'chord') expect(em.kind.midis).toEqual([40, 47, 52, 55, 59, 64]);
  });

  it('guitar levels 1-5: every chord is repeated 2-4 times in a row, so level 1 is not a change exercise', () => {
    for (let level = 1; level <= 5; level++)
      for (let seed = 1; seed <= 20; seed++) {
        const seq = generate('chords', { instrument: 'guitar', level, seed, length: 8 }).targets.map((t) => (t.kind.type === 'chord' ? t.kind.name : ''));
        const runs: number[] = [];
        seq.forEach((c, i) => (i > 0 && c === seq[i - 1] ? runs[runs.length - 1]++ : runs.push(1)));
        // every run but the last (cut by the length) has 2-4 repetitions
        for (const n of runs.slice(0, -1)) expect(n, `L${level} s${seed} ${seq}`).toBeGreaterThanOrEqual(2);
        expect(Math.max(...runs), `L${level} s${seed} ${seq}`).toBeLessThanOrEqual(4);
        expect(runs.length).toBeGreaterThanOrEqual(2); // but there is more than one chord
      }
  });

  it('guitar: the first levels introduce one thing each (Em+Am, +E+A, +D, +G, +C) and never use chords from later levels', () => {
    const allowed: string[][] = [['Em', 'Am'], ['Em', 'Am', 'E', 'A'], ['Em', 'Am', 'E', 'A', 'D'], ['Em', 'Am', 'E', 'A', 'D', 'G'], ['Em', 'Am', 'E', 'A', 'D', 'G', 'C']];
    const fresh = [['Em', 'Am'], ['E', 'A'], ['D'], ['G'], ['C']];
    for (let level = 1; level <= 5; level++)
      for (let seed = 1; seed <= 20; seed++) {
        const seq = new Set(generate('chords', { instrument: 'guitar', level, seed, length: 8 }).targets.map((t) => (t.kind.type === 'chord' ? t.kind.name : '')));
        for (const c of seq) expect(allowed[level - 1]).toContain(c);
        for (const c of fresh[level - 1]) expect(seq.has(c), `L${level} s${seed} lacks the new chord ${c}`).toBe(true);
      }
  });

  it('guitar level 6 (change between two chords) takes its pair from the easiest of the progressive list', () => {
    const easy = new Set(PAIRS.slice(0, 5).map((p) => p.join('-')));
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const seq = generate('chords', { instrument: 'guitar', level: 6, seed, length: 8 }).targets.map((t) => (t.kind.type === 'chord' ? t.kind.name : ''));
      const pair = [seq[0], seq[1]].join('-');
      expect(easy.has(pair), pair).toBe(true);
      seq.forEach((c, i) => expect(c).toBe(seq[i % 2]));
      seen.add(pair);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('a short exercise (placement probe) still has two different chords', () => {
    for (let level = 1; level <= 5; level++)
      for (let seed = 1; seed <= 20; seed++) {
        const t = generate('chords', { instrument: 'guitar', level, seed, length: 4 }).targets;
        expect(new Set(t.map((x) => x.itemId)).size, `L${level} s${seed}`).toBeGreaterThanOrEqual(2);
      }
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

  it('bass: the closed 1-5-8 shape (fret r, r+2, r+2 on adjacent strings), compact for every root and register', () => {
    for (const id of ['bass4', 'bass5'] as const) {
      const inst = INSTRUMENTS[id];
      for (const name of ['E', 'A', 'D', 'G', 'C', 'F'])
        for (const reg of ['near', 'A'] as const) {
          const [r, f, o] = bassNotes(inst, name, reg);
          const tag = `${id} ${name} ${reg}`;
          expect(f.midi - r.midi, tag).toBe(7);
          expect(o.midi - r.midi, tag).toBe(12);
          expect(f.pos.fret, tag).toBe(r.pos.fret + 2);
          expect(o.pos.fret, tag).toBe(r.pos.fret + 2);
          expect(f.pos.string, tag).toBe(r.pos.string + 1);
          expect(o.pos.string, tag).toBe(r.pos.string + 2);
          expect(midiAt(inst, r.pos), tag).toBe(r.midi);
          expect(midiAt(inst, o.pos), tag).toBe(o.midi);
          expect(r.pos.fret, tag).toBeLessThanOrEqual(12);
        }
    }
    // D no longer jumps 7 frets (was D2 open, A2 at 7, D3 at 7): root on the A string at 5, shape 5-7-7
    expect(bassNotes(INSTRUMENTS.bass4, 'D').map((n) => n.pos.fret)).toEqual([5, 7, 7]);
    // open roots only where they keep the shape compact: E and A
    expect(bassNotes(INSTRUMENTS.bass4, 'E')[0].pos).toEqual({ string: 0, fret: 0 });
    expect(bassNotes(INSTRUMENTS.bass4, 'A')[0].pos).toEqual({ string: 1, fret: 0 });
  });

  it('bass levels: 1 is E and A, 2 adds D, G, C (different content), and no itemId splits E from Em', () => {
    for (const id of ['bass4', 'bass5'] as const)
      for (let seed = 1; seed <= 10; seed++) {
        const roots = (level: number) => new Set(generate('chords', { instrument: id, level, seed, length: 8 }).targets.map((t) => t.itemId.replace('chords:', '')));
        expect([...roots(1)].every((n) => n === 'E' || n === 'A')).toBe(true);
        expect(roots(1).size).toBe(2);
        for (const c of ['D', 'G', 'C']) expect(roots(2).has(c), `${id} s${seed} L2 lacks ${c}`).toBe(true);
        for (let level = 1; level <= 10; level++)
          for (const t of generate('chords', { instrument: id, level, seed, length: 8 }).targets) expect(t.itemId).not.toMatch(/m\b|m>|>\w*m$/);
      }
  });

  it('bass levels 1, 2 and 4 repeat each chord; 3 is a pair; 4 uses four notes; 5 keeps every root on the A string', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = (level: number) => {
        const ex = generate('chords', { instrument: 'bass4', level, seed, length: 8 });
        const per = level === 4 || level >= 8 ? 4 : 3;
        return { ex, chords: ex.targets.filter((_, i) => i % per === 0) };
      };
      for (const level of [1, 2, 4]) {
        const { chords } = g(level);
        expect(chords.some((t, i) => i > 0 && t.itemId === chords[i - 1].itemId), `L${level} s${seed}`).toBe(true);
      }
      const l3 = g(3).chords.map((t) => t.itemId.replace('chords:', '').split('>').pop());
      expect(new Set(l3).size).toBe(2);
      expect(generate('chords', { instrument: 'bass4', level: 4, seed }).targets.length % 4).toBe(0);
      const l5 = generate('chords', { instrument: 'bass4', level: 5, seed, length: 8 });
      for (let i = 0; i < l5.targets.length; i += 3) expect((l5.targets[i].kind as { pos: { string: number } }).pos.string).toBe(1);
    }
  });

  it('bass level 10 is a timed I-IV-V-I line, four notes per bar', () => {
    for (const id of ['bass4', 'bass5'] as const)
      for (let seed = 1; seed <= 8; seed++) {
        const ex = generate('chords', { instrument: id, level: 10, seed });
        expect(ex.timed).toBe(true);
        expect(ex.targets).toHaveLength(16);
        expect(ex.targets.map((t) => t.beat)).toEqual(Array.from({ length: 16 }, (_, i) => i));
        const names = ex.targets.filter((_, i) => i % 4 === 0).map((t) => t.itemId.split('>').pop()!.replace('chords:', ''));
        const pc = (n: string) => CHORDS[n].rootPc;
        expect([0, 1, 2, 3].map((i) => (pc(names[i]) - pc(names[0]) + 12) % 12)).toEqual([0, 5, 7, 0]);
      }
  });

  it('level labels: the bass has its own for chords and "Alternancia" instead of "Púa alterna"', () => {
    expect(levelLabel('chords', 2, 'bass4')).not.toBe(levelLabel('chords', 2, 'guitar'));
    for (let l = 1; l <= 10; l++) {
      expect(levelLabel('chords', l, 'bass5')).not.toMatch(/cejilla|potencia/i);
      expect(levelLabel('chords', l, 'bass4')).not.toBe('');
    }
    expect(levelLabel('strings', 6, 'guitar')).toMatch(/Púa alterna/);
    expect(levelLabel('strings', 6, 'bass4')).toBe('Alternancia entre dos cuerdas');
    expect(levelLabel('chords', 8)).toBe('Fa con cejilla');
  });

  it('level 10 is a timed progression on every instrument', () => {
    for (const instrument of INSTS) {
      const ex = generate('chords', { instrument, level: 10, seed: 2 });
      expect(ex.timed).toBe(true);
      expect(ex.bpm).toBeGreaterThan(0);
    }
  });
});

describe('rhythm: el primer compás empieza en el tiempo 1', () => {
  it('siempre hay un ataque en el pulso 0 (todas las semillas, niveles, longitudes e instrumentos)', () => {
    for (const instrument of INSTS)
      for (const level of levels)
        for (let seed = 1; seed <= 40; seed++)
          for (const length of [4, 8, 16]) {
            const ex = generate('rhythm', { instrument, level, seed, length });
            expect(ex.targets[0].beat, `${instrument} L${level} s${seed} len${length}`).toBe(0);
          }
  });
});

describe('scales', () => {
  it('level 10 adds only the clock: the first position of level 2 (up and down, now up to two octaves), timed (the random positions stay in levels 7 and 9)', () => {
    for (let seed = 1; seed <= 8; seed++) {
      for (const instrument of INSTS) {
        const l2 = generate('scales', { instrument, level: 2, seed });
        const l10 = generate('scales', { instrument, level: 10, seed });
        expect(l10.timed).toBe(true);
        expect(l2.timed).toBe(false);
        expect(l10.targets[0].itemId).toBe(l2.targets[0].itemId);
        const known = new Set(l2.targets.map((t) => t.itemId));
        expect(l10.targets.filter((t) => known.has(t.itemId)).length).toBeGreaterThan(l2.targets.length - 1);
        expect(new Set(l10.targets.map((t) => t.itemId.split(':m')[0]))).toEqual(new Set(l2.targets.map((t) => t.itemId.split(':m')[0])));
        expect(l10.targets.length).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('the ordered run starts and ends on the tonic, in every level, instrument and seed (thirds: only the start)', () => {
    const rootOf = (id: string) => (id.startsWith('scales:major') ? 0 : 9);
    for (const instrument of ['guitar', 'bass4', 'bass5'] as const)
      for (const level of levels)
        for (let seed = 1; seed <= 8; seed++) {
          const ex = generate('scales', { instrument, level, seed });
          const midis = ex.targets.map((t) => (t.kind as { midi: number }).midi);
          const root = rootOf(ex.targets[0].itemId);
          const thirds = level === 4 || level === 5 || level === 9;
          expect(midis[0] % 12, `${instrument} L${level} s${seed} start`).toBe(root);
          if (!thirds) expect(midis[midis.length - 1] % 12, `${instrument} L${level} s${seed} end`).toBe(root);
          // never longer than two octaves up and down (one octave for levels 1-3)
          const span = Math.max(...midis) - Math.min(...midis);
          expect(span).toBeLessThanOrEqual(level <= 3 ? 12 : 24);
          if (level >= 2 && !thirds) expect(midis[midis.length - 1]).toBe(midis[0]); // down to the starting tonic
        }
  });

  it('level 3 (C major) is a one-octave run C..C and back, not 33 targets starting on E', () => {
    const ex = generate('scales', { instrument: 'guitar', level: 3, seed: 1 });
    const midis = ex.targets.map((t) => (t.kind as { midi: number }).midi);
    expect(midis.slice(0, 8)).toEqual([48, 50, 52, 53, 55, 57, 59, 60]);
    expect(midis).toHaveLength(15);
  });

  it('free variant uses anyOf', () => {
    const ex = generate('scales', { instrument: 'bass4', level: 3, seed: 1, free: true, length: 6 });
    expect(ex.targets.length).toBe(6);
    expect(ex.targets.every((t) => t.kind.type === 'anyOf')).toBe(true);
  });
  it('rhythm tempo changes per tier of three levels, never together with a new cell', () => {
    const bpms = levels.map((l) => generate('rhythm', { instrument: 'guitar', level: l, seed: 1 }).bpm!);
    expect(bpms).toEqual([60, 60, 60, 66, 66, 66, 72, 72, 72, 78]);
    for (let i = 1; i < bpms.length; i++) expect(bpms[i]).toBeGreaterThanOrEqual(bpms[i - 1]);
    expect(bpms[9] - bpms[0]).toBeLessThanOrEqual(40);
  });
});
