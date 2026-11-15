/** Every minigame the launcher knows. Adding a game = adding one entry (and registering its scene in main.ts). */
import type { GameDef } from './types';

export const GAMES: Record<string, GameDef> = {
  pulso: { id: 'pulso', title: 'Pulso', skill: 'rhythm', mode: 'learn', scene: 'pulso', accent: 'cyan', length: 16, cabinet: 'pulse' },
  salto: { id: 'salto', title: 'Salto', skill: 'rhythm', mode: 'practice', scene: 'salto', accent: 'cyan', length: 16, cabinet: 'pulse' },
};

/** The game of a cabinet for a mode, if any. */
export function gameFor(cabinet: string, mode: 'learn' | 'practice'): GameDef | undefined {
  return Object.values(GAMES).find((g) => g.cabinet === cabinet && g.mode === mode);
}
