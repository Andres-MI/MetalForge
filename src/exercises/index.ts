/** Exercise generators for the first batch of skills. Pure and deterministic: no browser APIs. */
import type { Exercise, SkillId } from '../model/exercise';
import { generateChords } from './chords';
import type { GenerateOptions } from './common';
import { generateFrets } from './frets';
import { generateRhythm } from './rhythm';
import { generateScales } from './scales';
import { generateStrings } from './strings';

export { MAX_LEVEL, type GenerateOptions } from './common';
export { generateChords, bassNotes, chordShape, CHORDS } from './chords';
export { generateFrets, fretsZone } from './frets';
export { generateRhythm, rhythmBpm } from './rhythm';
export { generateScales, scalesZone } from './scales';
export { generateStrings, stringsZone } from './strings';

export const FIRST_BATCH: SkillId[] = ['rhythm', 'frets', 'strings', 'chords', 'scales'];

export function generate(skill: SkillId, opts: GenerateOptions): Exercise {
  switch (skill) {
    case 'rhythm':
      return generateRhythm(opts);
    case 'frets':
      return generateFrets(opts);
    case 'strings':
      return generateStrings(opts);
    case 'chords':
      return generateChords(opts);
    case 'scales':
      return generateScales(opts);
    default:
      throw new Error(`Habilidad sin generador todavía: ${skill}`);
  }
}

const LEVELS: Partial<Record<SkillId, string[]>> = {
  rhythm: [
    'Negras', 'Negras y silencios', 'Corcheas seguidas', 'Negras, corcheas y silencios', 'Sincopa',
    'Semicorcheas', 'Corcheas con semicorcheas', 'Semicorcheas sincopadas', 'Tresillos', 'Mezcla densa',
  ],
  frets: [
    'Una cuerda, trastes 0-3', 'Trastes 0-5', 'Trastes 0-7', 'Trastes 0-9', 'Trastes 0-12',
    'Dos cuerdas, hasta el 4', 'Dos cuerdas, hasta el 7', 'Dos cuerdas, hasta el 12', 'Dos cuerdas con saltos grandes', 'Dos cuerdas no contiguas',
  ],
  strings: [
    'Cuerdas al aire contiguas', 'Saltando una cuerda', 'Saltos de cualquier distancia', 'Traste fijo', 'Al aire y con traste',
    'Púa alterna entre dos cuerdas', 'Púa alterna a tempo', 'Púa alterna por tres cuerdas', 'Púa alterna con saltos', 'Púa alterna en corcheas',
  ],
  chords: [
    'Mi menor y La menor', 'Mi y La', 'Re', 'Sol', 'Do',
    'Cambio entre dos acordes', 'Cambios entre acordes abiertos', 'Fa con cejilla', 'Acordes de potencia', 'Progresión a tempo',
  ],
  scales: [
    'Pentatónica menor, primera posición', 'Subir y bajar', 'Escala mayor', 'Terceras en la pentatónica', 'Terceras en la mayor',
    'Pentatónica, segunda posición', 'Pentatónica, otra posición', 'Mayor, posición del traste 7', 'Terceras en otra posición', 'Escala a tempo',
  ],
};

/** Short Spanish description of what a level adds, for menus and lesson headers. */
export function levelLabel(skill: SkillId, level: number): string {
  return LEVELS[skill]?.[Math.min(10, Math.max(1, Math.round(level))) - 1] ?? '';
}
