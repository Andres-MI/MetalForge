import { describe, expect, it } from 'vitest';
import { BASS_COURSE, courseFor, GUITAR_COURSE, PLACEMENT_PROBES } from '../src/course/data';
import { emptyCourse, migrateLegacy, readCourse, readLevels, readTurbo, setManual, setPlacement, writeLevel, writeStep, writeTurbo } from '../src/course/blob';
import { deriveCourse, highestCleared, newlyCompleted, newlyUnlocked, starsAt, unlockedSkills } from '../src/course/progress';
import { advance, bossFlow, bossPassed, meanStars, reviewFlow, turboFlow, turboRecord, turboStartLevel } from '../src/course/flow';
import { nextProbe, placementFromResults, skippedPlacement, type ProbeResult } from '../src/course/placement';
import { bestExercise, dueBySkill, planReview, skillOfItem, summarizeReview } from '../src/course/review';
import { generate, MAX_LEVEL } from '../src/exercises';
import { describeTarget } from '../src/course/describe';
import { GAMES } from '../src/game/registry';
import type { InstrumentId } from '../src/model/instrument';
import { DAY_MS, emptyMastery, toJSON, updateMastery } from '../src/progress';
import type { Judgement } from '../src/model/exercise';

const INSTRUMENT_IDS: InstrumentId[] = ['guitar', 'bass4', 'bass5'];
const ctx = { calibrated: false };
const NOW = 1_700_000_000_000;

function state(blob: unknown, course = GUITAR_COURSE) {
  return deriveCourse(course, blob, ctx);
}
const star = (blob: unknown, game: string, level: number, stars: number) => writeLevel(blob, game, level, stars, NOW);
const res = (itemId: string, judgement: Judgement = 'hit') => ({ itemId, judgement, delta: 0 });

describe('datos del curso', () => {
  for (const id of INSTRUMENT_IDS) {
    describe(id, () => {
      const course = courseFor(id);

      it('cada paso apunta a un juego del registro de su habilidad y modo, con niveles 1..10', () => {
        for (const m of course.modules) {
          for (const s of m.steps) {
            if (s.kind === 'learn' || s.kind === 'practice') {
              const g = GAMES[s.game];
              expect(g, `${m.id}:${s.id}`).toBeDefined();
              expect(g.mode).toBe(s.kind);
              expect(g.skill).toBe(m.skill);
              expect(g.scene).toBeTruthy();
              expect(s.goals.length).toBeGreaterThan(0);
              for (const goal of s.goals) {
                expect(goal.level).toBeGreaterThanOrEqual(1);
                expect(goal.level).toBeLessThanOrEqual(MAX_LEVEL);
                expect([1, 2, 3]).toContain(goal.minStars);
                // The generator really makes it for this instrument.
                expect(generate(g.skill, { instrument: id, level: goal.level, seed: 1, length: g.length }).targets.length).toBeGreaterThan(0);
              }
            } else if (s.kind === 'boss') {
              expect(s.phases.length).toBeGreaterThanOrEqual(2);
              expect(s.phases.length).toBeLessThanOrEqual(3);
              expect(new Set(s.phases.map((p) => GAMES[p.game].mode)).size, 'el jefe alterna aprender y practicar').toBe(2);
              for (const p of s.phases) {
                expect(GAMES[p.game].skill).toBe(m.skill);
                expect(p.level).toBeGreaterThanOrEqual(1);
                expect(p.level).toBeLessThanOrEqual(MAX_LEVEL);
              }
              expect(s.passStars).toBeGreaterThan(1);
            } else if (s.kind === 'review') {
              expect(s.rounds).toBeGreaterThanOrEqual(1);
              expect(s.rounds).toBeLessThanOrEqual(3);
            }
          }
        }
      });

      it('cada módulo con habilidad tiene aprender, practicar, repasar y jefe y una sola máquina del salón', () => {
        for (const m of course.modules.filter((x) => x.skill)) expect(m.steps.map((s) => s.id)).toEqual(['learn', 'practice', 'review', 'boss']);
        expect(new Set(course.modules.map((m) => m.id)).size).toBe(course.modules.length);
        expect(new Set(course.modules.map((m) => m.cabinet)).size).toBe(course.modules.length);
      });

      it('el grafo de desbloqueo es acíclico y todo módulo es alcanzable jugando', () => {
        const order = new Map(course.modules.map((m, i) => [m.id, i]));
        for (const m of course.modules) for (const r of m.requires) expect(order.get(r), `${m.id} requiere ${r} antes`).toBeLessThan(order.get(m.id)!);
        // Walk: clear the practice step of every open module until nothing new opens.
        let blob: unknown = {};
        for (let guard = 0; guard < 20; guard++) {
          const st = deriveCourse(course, blob, ctx);
          const open = st.modules.find((m) => m.unlocked && !m.practiceDone && m.module.skill);
          if (!open) break;
          const p = open.module.steps.find((s) => s.kind === 'practice')!;
          if (p.kind !== 'practice') throw new Error('x');
          for (const g of p.goals) blob = star(blob, p.game, g.level, 2);
        }
        const final = deriveCourse(course, blob, ctx);
        expect(final.modules.every((m) => m.unlocked)).toBe(true);
      });

      it('las pruebas del sondeo se generan y cubren cada habilidad del curso', () => {
        const skills = new Set(course.modules.map((m) => m.skill).filter(Boolean));
        expect(new Set(PLACEMENT_PROBES.map((g) => g[0].skill))).toEqual(skills);
        for (const group of PLACEMENT_PROBES) {
          expect(group[0].level).toBeLessThan(group[1].level);
          for (const p of group) expect(generate(p.skill, { instrument: id, level: p.level, seed: 1, length: p.length }).targets.length).toBeGreaterThan(0);
        }
      });
    });
  }

  it('el orden de la guitarra sigue el documento y el del bajo pone las escalas antes que raíz-quinta-octava', () => {
    expect(GUITAR_COURSE.modules.map((m) => m.id)).toEqual(['prep', 'rhythm', 'frets', 'strings', 'chords', 'scales']);
    expect(BASS_COURSE.modules.map((m) => m.id)).toEqual(['prep', 'rhythm', 'frets', 'strings', 'scales', 'chords']);
    expect(courseFor('bass4')).toBe(courseFor('bass5'));
    // Rhythm and frets come before the chords of the bass.
    const ids = BASS_COURSE.modules.map((m) => m.id);
    expect(ids.indexOf('rhythm')).toBeLessThan(ids.indexOf('chords'));
    expect(ids.indexOf('frets')).toBeLessThan(ids.indexOf('chords'));
  });
});

describe('desbloqueo y progreso derivado', () => {
  it('un perfil vacío solo enciende Preparación y Ritmo, y recomienda afinar', () => {
    const s = state({});
    expect(s.unlocked).toEqual(['prep', 'rhythm']);
    expect(s.next?.moduleId).toBe('prep');
    expect(s.next?.stepId).toBe('tuner');
  });

  it('con el afinador usado se recomienda Ritmo / Aprender en el primer nivel', () => {
    const s = state({ course: { tuner: true } });
    expect(s.next).toMatchObject({ moduleId: 'rhythm', stepId: 'learn', level: 1 });
  });

  it('dos estrellas en el nivel de práctica abren el módulo siguiente; una no', () => {
    expect(state(star({}, 'salto', 3, 1)).unlocked).not.toContain('frets');
    expect(state(star({}, 'salto', 2, 3)).unlocked).not.toContain('frets');
    const open = state(star({}, 'salto', 3, 2));
    expect(open.unlocked).toContain('frets');
    expect(open.modules.find((m) => m.module.id === 'frets')?.reason).toBe('requires');
    expect(open.unlocked).not.toContain('strings');
  });

  it('las estrellas guardan la mejor marca y cuentan jugadas', () => {
    let b = writeLevel({}, 'pulso', 2, 3, 1);
    b = writeLevel(b, 'pulso', 2, 1, 2);
    expect(readLevels(b)['pulso:2']).toEqual({ stars: 3, plays: 2, at: 2 });
  });

  it('un nivel de práctica con estrellas da por cumplidos los niveles de aprender iguales o menores', () => {
    const s = state(star({ course: { tuner: true } }, 'salto', 3, 2));
    const learn = s.modules[1].steps[0];
    expect(learn.done).toBe(true);
    expect(s.next?.stepId).toBe('review');
  });

  it('aprender pide una estrella en cada nivel y recomienda el primero que falta', () => {
    let b: unknown = { course: { tuner: true } };
    b = star(b, 'pulso', 1, 1);
    b = star(b, 'pulso', 2, 1);
    const s = state(b);
    expect(s.modules[1].steps[0]).toMatchObject({ done: false, level: 3 });
    expect(s.modules[1].steps[0].progress).toBeCloseTo(2 / 3);
    expect(s.next).toMatchObject({ stepId: 'learn', level: 3, game: 'pulso' });
    b = star(b, 'pulso', 3, 1);
    expect(state(b).next?.stepId).toBe('practice');
  });

  it('repasar necesita haber jugado el módulo y jefe necesita la práctica hecha', () => {
    const fresh = state({ course: { tuner: true } }).modules[1];
    expect(fresh.steps.find((x) => x.id === 'review')?.open).toBe(false);
    expect(fresh.steps.find((x) => x.id === 'boss')?.open).toBe(false);
    const played = state(star({}, 'pulso', 1, 1)).modules[1];
    expect(played.steps.find((x) => x.id === 'review')?.open).toBe(true);
    expect(played.steps.find((x) => x.id === 'boss')?.open).toBe(false);
    const practiced = state(star({}, 'salto', 3, 2)).modules[1];
    expect(practiced.steps.find((x) => x.id === 'boss')?.open).toBe(true);
  });

  it('el jefe pasado completa el módulo; sin pasar no', () => {
    let b = star({}, 'salto', 3, 2);
    b = writeStep(b, 'rhythm:boss', 1.67, NOW);
    expect(state(b).modules[1].complete).toBe(false);
    b = writeStep(b, 'rhythm:boss', 2.33, NOW);
    expect(state(b).modules[1].complete).toBe(true);
  });

  it('desbloqueo manual y sondeo abren módulos sin cumplir los anteriores', () => {
    expect(state(setManual({}, 'chords', true)).unlocked).toContain('chords');
    expect(state(setManual(setManual({}, 'chords', true), 'chords', false)).unlocked).not.toContain('chords');
    const placed = setPlacement({}, { at: NOW, skipped: false, skills: { chords: 2 } });
    const s = state(placed);
    expect(s.modules.find((m) => m.module.id === 'chords')).toMatchObject({ unlocked: true, reason: 'placement' });
    expect(s.unlocked).not.toContain('strings');
  });

  it('el sondeo da por cumplidos los niveles superados: abre en cadena y marca por dónde seguir', () => {
    const blob = setPlacement({}, { at: NOW, skipped: false, skills: { rhythm: 5, frets: 2 } });
    expect(starsAt(blob, 'salto', 3)).toBe(2);
    expect(starsAt(blob, 'pulso', 5)).toBe(2);
    expect(starsAt(blob, 'salto', 6)).toBe(0);
    const s = state(blob);
    expect(s.unlocked).toEqual(['prep', 'rhythm', 'frets']);
    expect(s.modules[1].practiceDone).toBe(true);
    // Frets: levels 1 and 2 are credited, so the first level left to learn is 3.
    expect(s.modules[2].steps[0]).toMatchObject({ done: false, level: 3 });
  });

  it('empezar desde cero no desbloquea nada', () => {
    expect(state(setPlacement({}, skippedPlacement(NOW))).unlocked).toEqual(['prep', 'rhythm']);
  });

  it('un perfil antiguo sin claves nuevas carga, se migra una vez y conserva lo que tenía', () => {
    const old = {
      mastery: toJSON(updateMastery(emptyMastery(), [res('rhythm:quarters'), res('frets:guitar:s0:f3')], NOW)),
      arcadeBest: { 'salto:3': { score: 900, bestCombo: 12 }, 'ninja:2': { score: 300, bestCombo: 3 }, 'portero:1': { score: 0, bestCombo: 0 } },
    };
    expect(readLevels(old)).toEqual({});
    expect(readCourse(old)).toEqual(emptyCourse());
    // Before the migration the course reads it as the start of the course, without errors.
    expect(state(old).unlocked).toEqual(['prep', 'rhythm']);
    const m = migrateLegacy(old);
    expect(m.changed).toBe(true);
    // The arcade record of Salto level 3 becomes two stars: Trastes is open, and Ninja 2 is not enough for Cuerdas.
    expect(starsAt(m.blob, 'salto', 3)).toBe(2);
    expect(starsAt(m.blob, 'ninja', 2)).toBe(2);
    expect(starsAt(m.blob, 'ninja', 3)).toBe(0);
    expect(starsAt(m.blob, 'portero', 1)).toBe(0);
    expect(state(m.blob).unlocked).toEqual(['prep', 'rhythm', 'frets']);
    // Old keys are untouched, and a second migration does nothing (a new arcade record must not count by itself).
    expect((m.blob as typeof old).arcadeBest).toEqual(old.arcadeBest);
    expect((m.blob as typeof old).mastery).toEqual(old.mastery);
    expect(migrateLegacy(m.blob).changed).toBe(false);
    const played = { ...(m.blob as object), arcadeBest: { ...old.arcadeBest, 'ninja:3': { score: 50, bestCombo: 2 } } };
    expect(starsAt(played, 'ninja', 3)).toBe(0);
    // A fresh profile migrates to an empty course.
    expect(migrateLegacy(undefined).blob).toEqual({ course: { manual: [], steps: {}, tuner: false, migrated: true } });
    // Writing the new keys leaves the old ones alone.
    const next = writeLevel(old, 'pulso', 1, 2, NOW) as typeof old;
    expect(next.arcadeBest).toEqual(old.arcadeBest);
    expect(next.mastery).toEqual(old.mastery);
  });

  it('un blob corrupto o de otro tipo no rompe nada', () => {
    for (const junk of [undefined, null, 5, 'x', [], { levels: 3, course: 'x', turbo: [] }, { levels: { 'salto:3': { stars: 'mucho' } } }]) {
      expect(state(junk).unlocked).toEqual(['prep', 'rhythm']);
    }
  });

  it('newlyUnlocked y newlyCompleted comparan dos estados', () => {
    const before = state({});
    const after = state(star({}, 'salto', 3, 2));
    expect(newlyUnlocked(before, after).map((m) => m.id)).toEqual(['frets']);
    expect(newlyCompleted(before, after)).toEqual([]);
    const done = state(writeStep(star({}, 'salto', 3, 2), 'rhythm:boss', 3, NOW));
    expect(newlyCompleted(after, done).map((m) => m.id)).toEqual(['rhythm']);
  });

  it('la calibración y el afinador completan Preparación', () => {
    const s = deriveCourse(GUITAR_COURSE, { course: { tuner: true } }, { calibrated: true });
    expect(s.modules[0].complete).toBe(true);
    expect(s.next?.moduleId).toBe('rhythm');
  });

  it('el bajo abre Escalas antes que Acordes y exige ritmo de nivel 4', () => {
    const run = (b: unknown) => deriveCourse(BASS_COURSE, b, ctx);
    expect(run(star({}, 'salto', 3, 2)).unlocked).not.toContain('frets');
    expect(run(star({}, 'salto', 4, 2)).unlocked).toContain('frets');
    let b: unknown = {};
    for (const [g, l] of [['salto', 4], ['ninja', 3], ['portero', 3]] as const) b = star(b, g, l, 2);
    const s = run(b);
    expect(s.unlocked).toContain('scales');
    expect(s.unlocked).not.toContain('chords');
  });

  it('highestCleared y unlockedSkills', () => {
    const b = star(star({}, 'ninja', 2, 1), 'ninja', 4, 3);
    expect(highestCleared(b, 'ninja')).toBe(4);
    expect(highestCleared(b, 'salto')).toBe(0);
    expect(unlockedSkills(state({}))).toEqual(['rhythm']);
  });
});

describe('sondeo de nivel', () => {
  const pass = (skill: ProbeResult['skill'], level: number): ProbeResult => ({ skill, level, stars: 2 });
  const fail = (skill: ProbeResult['skill'], level: number): ProbeResult => ({ skill, level, stars: 1 });

  it('empieza por los trastes y solo ofrece la prueba difícil si la fácil sale bien', () => {
    expect(nextProbe([])).toMatchObject({ skill: 'frets', level: 2 });
    expect(nextProbe([pass('frets', 2)])).toMatchObject({ skill: 'frets', level: 5 });
    expect(nextProbe([fail('frets', 2)])).toMatchObject({ skill: 'strings', level: 2 });
    expect(nextProbe([pass('frets', 2), fail('frets', 5)])).toMatchObject({ skill: 'strings', level: 2 });
  });

  it('termina con la ritmo y recorre todo en el mejor caso (10 pruebas) o 5 en el peor', () => {
    let done: ProbeResult[] = [];
    let n = 0;
    for (let p = nextProbe(done); p && n < 30; p = nextProbe(done), n++) done = [...done, pass(p.skill, p.level)];
    expect(n).toBe(10);
    expect(done[done.length - 1]).toMatchObject({ skill: 'rhythm', level: 5 });
    done = [];
    n = 0;
    for (let p = nextProbe(done); p && n < 30; p = nextProbe(done), n++) done = [...done, fail(p.skill, p.level)];
    expect(n).toBe(5);
  });

  it('el resultado se convierte en el mayor nivel superado por habilidad', () => {
    const p = placementFromResults([pass('frets', 2), pass('frets', 5), pass('strings', 2), fail('strings', 5), fail('chords', 2), pass('scales', 1), pass('scales', 3), pass('rhythm', 2), fail('rhythm', 5)], NOW);
    expect(p.skills).toEqual({ frets: 5, strings: 2, chords: 0, scales: 3, rhythm: 2 });
    expect(p.skipped).toBe(false);
  });

  it('un sondeo bien jugado desbloquea varios módulos y uno flojo ninguno de más', () => {
    const good = placementFromResults(
      PLACEMENT_PROBES.flat().map((p) => pass(p.skill, p.level)),
      NOW,
    );
    const s = state(setPlacement({}, good));
    expect(s.unlocked).toEqual(['prep', 'rhythm', 'frets', 'strings', 'chords', 'scales']);
    const weak = placementFromResults(PLACEMENT_PROBES.map((g) => fail(g[0].skill, g[0].level)), NOW);
    expect(state(setPlacement({}, weak)).unlocked).toEqual(['prep', 'rhythm']);
  });
});

describe('repaso', () => {
  const day = DAY_MS;
  function masteryWith(entries: Record<string, { hits: number; daysAgo: number; misses?: number }>) {
    let m = emptyMastery();
    for (const [id, e] of Object.entries(entries)) {
      for (let i = 0; i < e.hits; i++) m = updateMastery(m, [res(id)], NOW - e.daysAgo * day);
      for (let i = 0; i < (e.misses ?? 0); i++) m = updateMastery(m, [res(id, 'miss')], NOW - e.daysAgo * day);
    }
    return m;
  }
  const guitarFrets = (s: number, f: number) => `frets:guitar:s${s}:f${f}`;

  it('elige lo más flojo y olvidado primero, solo de las habilidades abiertas', () => {
    const m = masteryWith({
      [guitarFrets(0, 1)]: { hits: 8, daysAgo: 0 }, // strong and fresh: not due
      [guitarFrets(0, 2)]: { hits: 3, daysAgo: 20 }, // forgotten
      [guitarFrets(0, 3)]: { hits: 1, daysAgo: 1, misses: 2 }, // weak
      'chords:Em': { hits: 1, daysAgo: 30 }, // chords are not open
    });
    const plan = planReview({ now: NOW, instrument: 'guitar', mastery: m, skills: ['frets', 'rhythm'], levelCap: { frets: 3 } });
    const items = plan.rounds.flatMap((r) => r.items);
    expect(items).toContain(guitarFrets(0, 2));
    expect(items).toContain(guitarFrets(0, 3));
    expect(items).not.toContain(guitarFrets(0, 1));
    expect(items.some((i) => i.startsWith('chords:'))).toBe(false);
    expect(plan.rounds.every((r) => r.skill === 'frets')).toBe(true);
    expect(plan.due).toBe(2);
  });

  it('prefiere el juego sobrio para lo flojo y el arcade para lo que ya se sabe bastante', () => {
    const weak = masteryWith({ [guitarFrets(0, 3)]: { hits: 1, daysAgo: 1, misses: 3 } });
    expect(planReview({ now: NOW, instrument: 'guitar', mastery: weak, skills: ['frets'], levelCap: { frets: 3 } }).rounds[0]).toMatchObject({ mode: 'learn', gameId: 'fireflies' });
    const fairly = masteryWith({ [guitarFrets(0, 3)]: { hits: 4, daysAgo: 2 } });
    const r = planReview({ now: NOW, instrument: 'guitar', mastery: fairly, skills: ['frets'], levelCap: { frets: 3 } });
    expect(r.rounds[0].strength).toBeGreaterThan(0.5);
    expect(r.rounds[0]).toMatchObject({ mode: 'practice', gameId: 'ninja' });
  });

  it('el ejercicio elegido contiene los elementos buscados (nivel y semilla)', () => {
    const items = [guitarFrets(0, 2), guitarFrets(0, 3)];
    const pick = bestExercise('frets', 'guitar', items, 3, 12);
    const ex = generate('frets', { instrument: 'guitar', level: pick.level, seed: pick.seed, length: 12 });
    const ids = new Set(ex.targets.map((t) => t.itemId));
    expect(items.filter((i) => ids.has(i)).length).toBe(pick.covered);
    expect(pick.covered).toBe(2);
    expect(pick.level).toBeLessThanOrEqual(3);
  });

  it('con elementos de varias habilidades hace una ronda por habilidad, la más urgente primero, y respeta el máximo', () => {
    const m = masteryWith({
      [guitarFrets(0, 2)]: { hits: 1, daysAgo: 10 },
      'chords:Em': { hits: 1, daysAgo: 40, misses: 2 },
      'rhythm:quarter': { hits: 1, daysAgo: 12 },
      'strings:adj:0>1': { hits: 1, daysAgo: 15 },
      'scales:pentatonic-minor:p1:m40': { hits: 1, daysAgo: 20 },
    });
    const skills = ['rhythm', 'frets', 'strings', 'chords', 'scales'] as const;
    const plan = planReview({ now: NOW, instrument: 'guitar', mastery: m, skills: [...skills], levelCap: { rhythm: 3, frets: 3, strings: 3, chords: 3, scales: 3 }, maxRounds: 4, budgetSeconds: 10_000 });
    expect(plan.rounds).toHaveLength(4);
    expect(new Set(plan.rounds.map((r) => r.skill)).size).toBe(4);
    expect(plan.rounds[0].skill).toBe('chords');
  });

  it('respeta el presupuesto de tiempo', () => {
    const entries: Record<string, { hits: number; daysAgo: number }> = {};
    for (let f = 0; f < 6; f++) entries[guitarFrets(0, f)] = { hits: 1, daysAgo: 30 };
    entries['rhythm:quarter'] = { hits: 1, daysAgo: 30 };
    entries['chords:Em'] = { hits: 1, daysAgo: 30 };
    entries['strings:adj:0>1'] = { hits: 1, daysAgo: 30 };
    const m = masteryWith(entries);
    const base = { now: NOW, instrument: 'guitar' as const, mastery: m, skills: ['rhythm', 'frets', 'strings', 'chords'] as const, levelCap: { rhythm: 3, frets: 3, strings: 3, chords: 3 } };
    const tight = planReview({ ...base, skills: [...base.skills], budgetSeconds: 200 });
    expect(tight.seconds).toBeLessThanOrEqual(200);
    expect(tight.rounds.length).toBeGreaterThanOrEqual(1);
    const roomy = planReview({ ...base, skills: [...base.skills], budgetSeconds: 2000, maxRounds: 5 });
    expect(roomy.rounds.length).toBeGreaterThan(tight.rounds.length);
    expect(roomy.rounds.length).toBeLessThanOrEqual(5);
    // Between five and ten minutes with the defaults.
    const normal = planReview({ ...base, skills: [...base.skills] });
    expect(normal.seconds).toBeLessThanOrEqual(600);
  });

  it('con pocos elementos flojos de una sola habilidad reparte en varias rondas (mínimo 3 si hay elementos)', () => {
    const entries: Record<string, { hits: number; daysAgo: number }> = {};
    for (let f = 0; f < 20; f++) entries[guitarFrets(0, f)] = { hits: 1, daysAgo: 30 };
    const plan = planReview({ now: NOW, instrument: 'guitar', mastery: masteryWith(entries), skills: ['frets'], levelCap: { frets: 5 }, budgetSeconds: 1000 });
    expect(plan.rounds.length).toBe(3);
    const all = plan.rounds.flatMap((r) => r.items);
    expect(new Set(all).size).toBe(all.length);
  });

  it('es determinista con el mismo tiempo inyectado y cambia si el tiempo pasa', () => {
    const m = masteryWith({ [guitarFrets(0, 2)]: { hits: 3, daysAgo: 2 }, [guitarFrets(1, 2)]: { hits: 1, daysAgo: 5 } });
    const o = { now: NOW, instrument: 'guitar' as const, mastery: m, skills: ['frets' as const], levelCap: { frets: 4 } };
    expect(planReview(o)).toEqual(planReview(o));
    expect(planReview({ ...o, now: NOW + 60 * day }).due).toBeGreaterThanOrEqual(planReview(o).due);
    // Nothing seen, nothing to review.
    expect(planReview({ ...o, mastery: emptyMastery() }).rounds).toEqual([]);
  });

  it('el repaso de módulo siempre incluye la habilidad del módulo aunque no haya nada flojo', () => {
    const plan = planReview({ now: NOW, instrument: 'guitar', mastery: emptyMastery(), skills: ['rhythm'], must: { skill: 'rhythm', level: 3 }, maxRounds: 2 });
    expect(plan.rounds).toHaveLength(1);
    expect(plan.rounds[0]).toMatchObject({ skill: 'rhythm', mode: 'learn', level: 3, gameId: 'pulso' });
  });

  it('skillOfItem, dueBySkill y el resumen de lo que mejoró', () => {
    expect(skillOfItem('frets:guitar:s0:f3')).toBe('frets');
    expect(skillOfItem('nada:1')).toBeNull();
    const before = masteryWith({ [guitarFrets(0, 2)]: { hits: 1, daysAgo: 20 }, 'chords:Em': { hits: 1, daysAgo: 20 } });
    expect(dueBySkill(before, NOW, ['frets', 'chords', 'rhythm'])).toEqual({ frets: 1, chords: 1 });
    const after = updateMastery(before, [res(guitarFrets(0, 2)), res(guitarFrets(0, 2))], NOW);
    const sum = summarizeReview(before, after, [guitarFrets(0, 2), 'chords:Em'], NOW);
    expect(sum.items).toBe(2);
    expect(sum.improved).toBe(1);
    expect(sum.meanAfter).toBeGreaterThan(sum.meanBefore);
    expect(sum.bySkill.find((s) => s.skill === 'frets')!.after).toBeGreaterThan(sum.bySkill.find((s) => s.skill === 'frets')!.before);
  });
});

describe('flujos: jefes, repasos y Turbo', () => {
  const out = (gameId: string, level: number, stars: number, score: number | null = null) => ({ gameId, level, stars, accuracy: stars / 3, score });
  const rhythm = GUITAR_COURSE.modules[1];
  const bossStep = rhythm.steps.find((s) => s.kind === 'boss')!;

  it('el jefe recorre sus fases y se aprueba con dos estrellas de media', () => {
    if (bossStep.kind !== 'boss') throw new Error('x');
    let f = bossFlow(rhythm, bossStep, NOW);
    expect(f.phases.map((p) => p.gameId)).toEqual(['salto', 'pulso', 'salto']);
    for (const [i, stars] of [3, 2, 2].entries()) {
      expect(f.over).toBe(false);
      expect(f.index).toBe(i);
      f = advance(f, out(f.phases[f.index].gameId, f.phases[f.index].level, stars));
    }
    expect(f.over).toBe(true);
    expect(meanStars(f)).toBeCloseTo(7 / 3);
    expect(bossPassed(f)).toBe(true);
  });

  it('un jefe con una media de menos de dos estrellas no se aprueba', () => {
    if (bossStep.kind !== 'boss') throw new Error('x');
    let f = bossFlow(rhythm, bossStep, NOW);
    for (const stars of [1, 2, 2]) f = advance(f, out(f.phases[f.index].gameId, f.phases[f.index].level, stars));
    expect(bossPassed(f)).toBe(false);
  });

  it('el repaso lleva sus rondas y los elementos que cubre', () => {
    const plan = planReview({ now: NOW, instrument: 'guitar', mastery: updateMastery(emptyMastery(), [res('frets:guitar:s0:f2')], NOW - 20 * DAY_MS), skills: ['frets'], levelCap: { frets: 3 } });
    const f = reviewFlow(plan, 'daily', 'REPASO DE HOY', 'cyan', NOW);
    expect(f.phases).toHaveLength(plan.rounds.length);
    expect(f.items).toContain('frets:guitar:s0:f2');
    expect(f.phases[0].seed).toBe(plan.rounds[0].seed);
  });

  it('Turbo sube un nivel por ronda hasta el 10 y acaba en la primera ronda floja', () => {
    let f = turboFlow('salto', 8, NOW);
    expect(f.phases).toHaveLength(1);
    for (const stars of [3, 2, 3, 3]) f = advance(f, out('salto', f.phases[f.index].level, stars, 100));
    expect(f.phases.map((p) => p.level)).toEqual([8, 9, 10, 10, 10]);
    expect(f.over).toBe(false);
    f = advance(f, out('salto', 10, 1, 40));
    expect(f.over).toBe(true);
    const rec = turboRecord(f, NOW);
    expect(rec).toMatchObject({ score: 4 * 100 + 40, rounds: 4, startLevel: 8, level: 10 });
  });

  it('Turbo perdido en la primera ronda guarda 0 rondas', () => {
    let f = turboFlow('ninja', 2, NOW);
    f = advance(f, out('ninja', 2, 1, 55));
    expect(f.over).toBe(true);
    expect(turboRecord(f, NOW)).toMatchObject({ rounds: 0, score: 55, level: 2 });
  });

  it('turboStartLevel parte del nivel superado, entre 1 y 9', () => {
    expect([turboStartLevel(0), turboStartLevel(4), turboStartLevel(10)]).toEqual([1, 4, 9]);
  });

  it('la tabla de récords de Turbo ordena por puntos, guarda cinco por arcade y no admite ceros', () => {
    let blob: unknown = { mastery: { version: 1, items: {} } };
    const rec = (score: number, rounds = 1) => ({ score, rounds, startLevel: 1, level: rounds, at: score });
    const ranks: number[] = [];
    for (const s of [100, 300, 200, 50, 400, 250, 10]) {
      const w = writeTurbo(blob, 'salto', rec(s));
      blob = w.blob;
      ranks.push(w.rank);
    }
    expect(ranks).toEqual([0, 0, 1, 3, 0, 2, -1]);
    expect(readTurbo(blob, 'salto').map((r) => r.score)).toEqual([400, 300, 250, 200, 100]);
    expect(readTurbo(blob, 'ninja')).toEqual([]);
    const zero = writeTurbo(blob, 'ninja', rec(0));
    expect(zero.rank).toBe(-1);
    expect(readTurbo(zero.blob, 'ninja')).toEqual([]);
    // Other keys survive.
    expect((blob as { mastery: unknown }).mastery).toEqual({ version: 1, items: {} });
  });

});

describe('texto neutro del sondeo', () => {
  it('describe notas, acordes de guitarra, raíz-quinta-octava del bajo y golpes', () => {
    const frets = generate('frets', { instrument: 'guitar', level: 2, seed: 1, length: 5 });
    const n = describeTarget(frets, 0);
    expect(n.midis).toHaveLength(1);
    expect(n.small).toMatch(/^Cuerda \d · traste \d+$/);
    expect(n.chord).toBeNull();

    const chords = generate('chords', { instrument: 'guitar', level: 2, seed: 1, length: 2 });
    const c = describeTarget(chords, 0);
    expect(c.chord).toBeTruthy();
    expect(c.big).toMatch(/mayor|menor/);
    expect(c.midis.length).toBeGreaterThanOrEqual(3);
    expect(c.small).toMatch(/^Cuerdas \(grave a aguda\): (\d|x)( (\d+|x)){5}$/);

    const bass = generate('chords', { instrument: 'bass4', level: 2, seed: 1, length: 2 });
    const roles = bass.targets.map((_, i) => describeTarget(bass, i).big.match(/\((.*)\)/)?.[1]);
    expect(roles.slice(0, 3)).toEqual(['fundamental', 'quinta', 'octava']);
    expect(describeTarget(bass, 0).midis).toHaveLength(1);

    const rhythm = generate('rhythm', { instrument: 'bass5', level: 2, seed: 1, length: 8 });
    expect(describeTarget(rhythm, 0)).toMatchObject({ midis: [], chord: null });
  });
});
