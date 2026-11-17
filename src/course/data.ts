/**
 * The course as data (docs/DISENO.md, "Estructura del curso"): modules in order, each with Aprender, Practicar,
 * Repasar and Jefe, plus the rule that opens it. One course for the guitar and one for both basses.
 *
 * Opening rule: a module opens when the PRACTICE step of every module in `requires` is complete (e.g. two stars
 * in the arcade at a given level). Besides that, a module also opens by placement test, by hand from the
 * settings, or because the profile already shows play in that skill (see progress.ts).
 *
 * Guitar order follows the table of the design document: Ritmo, Trastes, Cuerdas, Acordes, Escalas.
 * Bass: rhythm is the bassist's job, so its bar is higher (level 4) and it comes first; Escalas come BEFORE
 * Acordes because root, fifth and octave (what Forja and Hechicero ask on bass) are degrees 1-5-8 of a scale
 * the player already knows by then.
 */
import { GAMES } from '../game/registry';
import type { InstrumentId } from '../model/instrument';
import type { Course, CourseModule, PlacementProbe, Step } from './types';

const learn = (game: string, levels: number[], minStars = 1): Step => ({ id: 'learn', kind: 'learn', game, goals: levels.map((level) => ({ level, minStars })) });
const practice = (game: string, level: number, minStars = 2): Step => ({ id: 'practice', kind: 'practice', game, goals: [{ level, minStars }] });
const review = (rounds = 2): Step => ({ id: 'review', kind: 'review', rounds, minStars: 2 });
const boss = (title: string, phases: [string, number][]): Step => ({ id: 'boss', kind: 'boss', title, phases: phases.map(([game, level]) => ({ game, level })), passStars: 2 });

const PREP: CourseModule = {
  id: 'prep',
  title: 'Preparación',
  skill: null,
  cabinet: 'tuner',
  accent: 'magenta',
  requires: [],
  blurb: 'Afina y calibra la latencia.',
  steps: [
    { id: 'tuner', kind: 'tool', label: 'Afinar', scene: 'tuner' },
    { id: 'calibration', kind: 'tool', label: 'Calibrar', scene: 'calibration' },
  ],
};

interface ModuleSpec {
  id: string;
  title: string;
  skill: NonNullable<CourseModule['skill']>;
  cabinet: string;
  accent: CourseModule['accent'];
  blurb: string;
  learn: string;
  arcade: string;
  /** Learn levels to clear, and the practice level that opens the next module. */
  learnLevels: number[];
  practiceLevel: number;
  bossTitle: string;
  /** [practice, learn, practice]: the boss alternates the arcade and the sober game, one level harder each time. */
  bossLevels: [number, number, number];
  /** Where in the course it opens. */
  requires: string[];
}

function build(s: ModuleSpec): CourseModule {
  return {
    id: s.id,
    title: s.title,
    skill: s.skill,
    cabinet: s.cabinet,
    accent: s.accent,
    requires: s.requires,
    blurb: s.blurb,
    steps: [
      learn(s.learn, s.learnLevels),
      practice(s.arcade, s.practiceLevel),
      review(2),
      boss(s.bossTitle, [
        [s.arcade, s.bossLevels[0]],
        [s.learn, s.bossLevels[1]],
        [s.arcade, s.bossLevels[2]],
      ]),
    ],
  };
}

const RHYTHM = (practiceLevel: number): ModuleSpec => ({
  id: 'rhythm', title: 'Ritmo', skill: 'rhythm', cabinet: 'pulse', accent: 'cyan', blurb: 'Tocar en el golpe: negras, corcheas, síncopa.',
  learn: 'pulso', arcade: 'salto', learnLevels: [1, 2, 3], practiceLevel, bossTitle: 'EL METRÓNOMO LOCO', bossLevels: [practiceLevel + 1, practiceLevel + 2, practiceLevel + 2], requires: [],
});
const FRETS = (requires: string[]): ModuleSpec => ({
  id: 'frets', title: 'Trastes', skill: 'frets', cabinet: 'fireflies', accent: 'lime', blurb: 'Encontrar cada traste de una cuerda.',
  learn: 'fireflies', arcade: 'ninja', learnLevels: [1, 2, 3], practiceLevel: 3, bossTitle: 'EL REY DEL PUENTE', bossLevels: [4, 5, 5], requires,
});
const STRINGS = (requires: string[]): ModuleSpec => ({
  id: 'strings', title: 'Cuerdas', skill: 'strings', cabinet: 'loom', accent: 'blue', blurb: 'Cambiar y saltar de cuerda sin mirar.',
  learn: 'telar', arcade: 'portero', learnLevels: [1, 2, 3], practiceLevel: 3, bossTitle: 'LA ARAÑA DEL TELAR', bossLevels: [4, 5, 5], requires,
});
const CHORDS = (requires: string[], bass: boolean): ModuleSpec => ({
  id: 'chords', title: bass ? 'Raíz, quinta y octava' : 'Acordes', skill: 'chords', cabinet: 'forge', accent: 'amber',
  blurb: bass ? 'Fundamental, quinta y octava de cada acorde.' : 'Formar los acordes abiertos y limpios.',
  learn: 'forge', arcade: 'wizard', learnLevels: [1, 2, 3], practiceLevel: 3, bossTitle: 'EL HERRERO OSCURO', bossLevels: [4, 4, 5], requires,
});
const SCALES = (requires: string[]): ModuleSpec => ({
  id: 'scales', title: 'Escalas', skill: 'scales', cabinet: 'climb', accent: 'violet', blurb: 'Pentatónica y escala mayor en el mástil.',
  learn: 'climb', arcade: 'tower', learnLevels: [1, 2, 3], practiceLevel: 3, bossTitle: 'EL GUARDIÁN DE LA TORRE', bossLevels: [4, 4, 5], requires,
});

export const GUITAR_COURSE: Course = {
  family: 'guitar',
  modules: [
    PREP,
    build(RHYTHM(3)),
    build(FRETS(['rhythm'])),
    build(STRINGS(['frets'])),
    build(CHORDS(['strings'], false)),
    build(SCALES(['chords'])),
  ],
};

export const BASS_COURSE: Course = {
  family: 'bass',
  modules: [
    PREP,
    build(RHYTHM(4)),
    build(FRETS(['rhythm'])),
    build(STRINGS(['frets'])),
    build(SCALES(['strings'])),
    build(CHORDS(['scales'], true)),
  ],
};

export function courseFor(instrument: InstrumentId): Course {
  return instrument === 'guitar' ? GUITAR_COURSE : BASS_COURSE;
}

export function moduleById(course: Course, id: string): CourseModule | undefined {
  return course.modules.find((m) => m.id === id);
}

/** Module that owns a hub cabinet, if any (Turbo and the tuner's own cabinet aside). */
export function moduleOfCabinet(course: Course, cabinet: string): CourseModule | undefined {
  return course.modules.find((m) => m.cabinet === cabinet);
}

/** The module a game belongs to. */
export function moduleOfGame(course: Course, gameId: string): CourseModule | undefined {
  const skill = GAMES[gameId]?.skill;
  return skill ? course.modules.find((m) => m.skill === skill) : undefined;
}

/**
 * Placement test (about five minutes): per skill an easy probe and a harder one, played in the order of the
 * design document (frets on one string, string changes, chords or root-fifth-octave, a short scale run, a
 * short rhythm). The harder probe is only offered when the easy one went well. Tuning and calibration come
 * before them (the scene asks for them), not as probes.
 */
export const PLACEMENT_PROBES: PlacementProbe[][] = [
  [{ skill: 'frets', level: 2, length: 5 }, { skill: 'frets', level: 5, length: 5 }],
  [{ skill: 'strings', level: 2, length: 5 }, { skill: 'strings', level: 5, length: 5 }],
  [{ skill: 'chords', level: 2, length: 2 }, { skill: 'chords', level: 4, length: 2 }],
  [{ skill: 'scales', level: 1, length: 6 }, { skill: 'scales', level: 3, length: 6 }],
  [{ skill: 'rhythm', level: 2, length: 8 }, { skill: 'rhythm', level: 5, length: 8 }],
];
