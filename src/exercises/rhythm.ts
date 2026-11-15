/**
 * Rhythm (Pulso / Salto): every target is an `attack`, only timing matters. 4/4, one cell per beat.
 *
 * Levels:
 *  1 quarters   2 + rests   3 steady eighths   4 mixed quarters/eighths/rests   5 + syncopation
 *  6 + sixteenths   7 + mixed eighth/sixteenth cells   8 + syncopated sixteenths   9 + triplets
 *  10 dense mix of everything
 * Tempo rises gently: 60 bpm at level 1, +3 bpm per level.
 */
import type { Exercise, Target } from '../model/exercise';
import { clampLevel, DEFAULT_LENGTH, exerciseId, makeRng, pick, shuffle, type GenerateOptions } from './common';

interface Cell {
  offsets: number[];
  item: string;
}

export const CELLS: Record<string, Cell> = {
  q: { offsets: [0], item: 'quarters' },
  rest: { offsets: [], item: 'rests' },
  e2: { offsets: [0, 0.5], item: 'eighths' },
  off: { offsets: [0.5], item: 'syncopation' },
  s4: { offsets: [0, 0.25, 0.5, 0.75], item: 'sixteenths' },
  es: { offsets: [0, 0.5, 0.75], item: 'sixteenths' },
  se: { offsets: [0, 0.25, 0.5], item: 'sixteenths' },
  off16: { offsets: [0.25, 0.75], item: 'syncopation16' },
  t3: { offsets: [0, 1 / 3, 2 / 3], item: 'triplets' },
};

interface Spec {
  allowed: string[];
  /** Each group must appear at least once per bar (one of its cells). */
  required: string[][];
}

const SPECS: Spec[] = [
  { allowed: ['q'], required: [] },
  { allowed: ['q', 'rest'], required: [['rest']] },
  { allowed: ['e2'], required: [] },
  { allowed: ['q', 'rest', 'e2'], required: [['q'], ['e2']] },
  { allowed: ['q', 'rest', 'e2', 'off'], required: [['off']] },
  { allowed: ['q', 'rest', 'e2', 'off', 's4'], required: [['s4']] },
  { allowed: ['q', 'rest', 'e2', 'off', 's4', 'es', 'se'], required: [['es', 'se']] },
  { allowed: ['q', 'rest', 'e2', 'off', 's4', 'es', 'se', 'off16'], required: [['off16']] },
  { allowed: ['q', 'rest', 'e2', 'off', 's4', 'es', 'se', 'off16', 't3'], required: [['t3']] },
  { allowed: ['e2', 'off', 's4', 'es', 'se', 'off16', 't3'], required: [['t3'], ['off16'], ['s4']] },
];

export function rhythmBpm(level: number): number {
  return 60 + 3 * (clampLevel(level) - 1);
}

function buildBar(spec: Spec, r: () => number): string[] {
  const bar: (string | undefined)[] = [undefined, undefined, undefined, undefined];
  for (const group of spec.required) {
    const cell = pick(r, group);
    // Rests never take the first beat, which anchors the bar.
    const free = shuffle(r, [0, 1, 2, 3]).filter((b) => bar[b] === undefined && !(cell === 'rest' && b === 0));
    if (free.length) bar[free[0]] = cell;
  }
  const fillable = spec.allowed.filter((c) => c !== 'rest');
  for (let b = 0; b < 4; b++) if (bar[b] === undefined) bar[b] = b === 0 ? pick(r, fillable) : pick(r, spec.allowed);
  return bar as string[];
}

export function generateRhythm(opts: GenerateOptions): Exercise {
  const level = clampLevel(opts.level);
  const spec = SPECS[level - 1];
  const r = makeRng(opts.seed, 3);
  const bars = Math.max(1, Math.ceil((opts.length ?? DEFAULT_LENGTH) / 4));
  const targets: Target[] = [];
  let prevCell = '';
  for (let b = 0; b < bars; b++) {
    const bar = buildBar(spec, r);
    bar.forEach((name, beatInBar) => {
      const cell = CELLS[name];
      cell.offsets.forEach((off, k) => {
        // The first attack after a rest is "coming back in", tracked as its own item.
        const item = k === 0 && prevCell === 'rest' ? 'rests' : cell.item;
        targets.push({ itemId: `rhythm:${item}`, kind: { type: 'attack' }, beat: b * 4 + beatInBar + off });
      });
      prevCell = name;
    });
  }
  return {
    id: exerciseId('rhythm', opts.instrument, level, opts.seed),
    skill: 'rhythm',
    instrument: opts.instrument,
    timed: true,
    bpm: rhythmBpm(level),
    targets,
  };
}
