/** Every minigame the launcher knows. Adding a game = adding one entry (and registering its scene in main.ts). */
import type { GameDef } from './types';

export const GAMES: Record<string, GameDef> = {
  pulso: { id: 'pulso', title: 'Pulso', skill: 'rhythm', mode: 'learn', scene: 'pulso', accent: 'cyan', length: 16, cabinet: 'pulse' },
  salto: { id: 'salto', title: 'Salto', skill: 'rhythm', mode: 'practice', scene: 'salto', accent: 'cyan', length: 16, cabinet: 'pulse' },
  telar: { id: 'telar', title: 'Telar', skill: 'strings', mode: 'learn', scene: 'telar', accent: 'blue', length: 16, cabinet: 'loom' },
  portero: { id: 'portero', title: 'Portero', skill: 'strings', mode: 'practice', scene: 'portero', accent: 'blue', length: 16, cabinet: 'loom' },
  fireflies: { id: 'fireflies', title: 'Luciérnagas', skill: 'frets', mode: 'learn', scene: 'fireflies', accent: 'lime', length: 12, cabinet: 'fireflies' },
  ninja: { id: 'ninja', title: 'Ninja', skill: 'frets', mode: 'practice', scene: 'ninja', accent: 'lime', length: 10, cabinet: 'fireflies' },
  forge: { id: 'forge', title: 'Forja', skill: 'chords', mode: 'learn', scene: 'forge', accent: 'amber', length: 8, cabinet: 'forge' },
  wizard: { id: 'wizard', title: 'Hechicero', skill: 'chords', mode: 'practice', scene: 'wizard', accent: 'amber', length: 5, cabinet: 'forge' },
  climb: { id: 'climb', title: 'Escalada', skill: 'scales', mode: 'learn', scene: 'climb', accent: 'violet', length: 40, cabinet: 'climb' },
  tower: { id: 'tower', title: 'Torre', skill: 'scales', mode: 'practice', scene: 'tower', accent: 'violet', length: 40, cabinet: 'climb' },
};

/** The game of a cabinet for a mode, if any. */
export function gameFor(cabinet: string, mode: 'learn' | 'practice'): GameDef | undefined {
  return Object.values(GAMES).find((g) => g.cabinet === cabinet && g.mode === mode);
}
