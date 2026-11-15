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
} as const;

/** One fixed colour per string in every game, lowest-pitched string first. */
export const STRING_COLORS = ['#ff3fb4', '#ff9a3d', '#c8ff3d', '#2ef2e2', '#4d8dff', '#9a5cff'];
