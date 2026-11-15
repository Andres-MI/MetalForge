/** Night-aquarium palette. Every screen and sprite takes its colours from here. */
export const PALETTE = {
  abyss: '#04060f',
  deep: '#0a1128',
  water: '#122a4f',
  cyan: '#2ef2e2',
  magenta: '#ff3fb4',
  violet: '#9a5cff',
  lime: '#c8ff3d',
  foam: '#e6f7ff',
  dim: '#5b7399',
  amber: '#ff9a3d',
  blue: '#4d8dff',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** One fixed colour per string in every game, lowest-pitched string first. */
export const STRING_COLOR_KEYS: PaletteKey[] = ['magenta', 'amber', 'lime', 'cyan', 'blue', 'violet'];
export const STRING_COLORS: string[] = STRING_COLOR_KEYS.map((k) => PALETTE[k]);

/** Palette colour as a 0xRRGGBB number (what Phaser wants). */
export function paletteInt(key: PaletteKey): number {
  return parseInt(PALETTE[key].slice(1), 16);
}
