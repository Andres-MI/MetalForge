/** Data hooks on `window.__metalforge`: the canvas has no DOM, so automation and tests read state from here. */
export interface MetalforgeHooks {
  /** MIDI notes the detector reported as attacks, most recent last (the tuner scene fills it). */
  heard: number[];
  /** Key of the scene on screen, e.g. 'hub' or 'tuner'. */
  scene: string;
  /** Chosen instrument id, or null before the first pick. */
  instrument: string | null;
  /** Hub: id of the highlighted cabinet. Picker: id of the highlighted instrument. */
  selected: string | null;
  /** Whether the background effects are running. */
  backgroundEffects: boolean;
}

declare global {
  interface Window {
    __metalforge: MetalforgeHooks;
  }
}

export const hooks: MetalforgeHooks = {
  heard: [],
  scene: '',
  instrument: null,
  selected: null,
  backgroundEffects: true,
};

export function installHooks(): void {
  window.__metalforge = hooks;
}
