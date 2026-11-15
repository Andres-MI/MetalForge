/** Data for the arcade hall: one cabinet per entry. Adding a game means adding a line here. */
import type { PaletteKey } from '../ui/palette';
import type { InstrumentId } from '../model/instrument';

export interface HubGame {
  id: string;
  /** Cabinet name shown in the info panel (Spanish). */
  title: string;
  /** Skill it trains (Spanish). */
  skill: string;
  /** One line, at most about 46 characters so it fits the panel. */
  description: string;
  /** Lit (true) or dark (false). Later this comes from course progress. */
  unlocked: boolean;
  /** Scene key to start when implemented; without it the cabinet leads to "Próximamente". */
  scene?: string;
  accent: PaletteKey;
  /** Sprite name of the icon on the cabinet screen. */
  icon: string;
}

export const HUB_GAMES: HubGame[] = [
  { id: 'pulse', title: 'Pulso / Salto', skill: 'Ritmo', description: 'Toca en cada golpe y salta los obstáculos.', unlocked: true, accent: 'cyan', icon: 'icon-pulse' },
  { id: 'fireflies', title: 'Luciérnagas / Ninja', skill: 'Trastes en una cuerda', description: 'Toca el traste donde se enciende la luz.', unlocked: true, accent: 'lime', icon: 'icon-fireflies' },
  { id: 'loom', title: 'Telar / Portero', skill: 'Cambio de cuerda', description: 'Salta de cuerda en cuerda sin perder el hilo.', unlocked: false, accent: 'blue', icon: 'icon-loom' },
  { id: 'forge', title: 'Forja / Hechicero', skill: 'Acordes y cambios', description: 'Forma el acorde y rasguéalo hasta que suene.', unlocked: false, accent: 'amber', icon: 'icon-forge' },
  { id: 'climb', title: 'Escalada / Torre', skill: 'Escalas', description: 'Sube la pared tocando la escala en orden.', unlocked: false, accent: 'violet', icon: 'icon-climb' },
  { id: 'tuner', title: 'Afinador', skill: 'Herramienta', description: 'Afina cada cuerda con la aguja de cents.', unlocked: true, scene: 'tuner', accent: 'magenta', icon: 'icon-fork' },
  { id: 'turbo', title: 'Turbo', skill: 'Velocidad', description: 'El tempo sube en bucle hasta que caigas.', unlocked: false, accent: 'amber', icon: 'icon-bolt' },
];

export const SHORT_LABEL: Record<InstrumentId, string> = { guitar: 'Guitarra', bass4: 'Bajo 4', bass5: 'Bajo 5' };
