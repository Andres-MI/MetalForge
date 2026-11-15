/** Small helpers shared by scenes. */
import type Phaser from 'phaser';
import type { ProfileStore } from '../profile/store';
import { AquariumBackground } from './aquarium';
import { hooks } from './hooks';

export const W = 320;
export const H = 180;

export function profileStore(scene: Phaser.Scene): ProfileStore {
  return scene.registry.get('store') as ProfileStore;
}

/** Marks this scene as the current one for automation hooks. */
export function enterScene(scene: Phaser.Scene, key: string): void {
  hooks.scene = key;
  hooks.selected = null;
  hooks.instrument = profileStore(scene).profile.instrument;
  hooks.backgroundEffects = profileStore(scene).profile.settings.backgroundEffects;
}

/** Input energy 0..1 that drives the background (later: input volume). */
export function setEnergy(scene: Phaser.Scene, value: number): void {
  scene.registry.set('energy', Math.max(0, Math.min(1, value)));
}

export function addBackground(scene: Phaser.Scene): AquariumBackground {
  return new AquariumBackground(scene, {
    enabled: profileStore(scene).profile.settings.backgroundEffects,
    energy: () => (scene.registry.get('energy') as number | undefined) ?? 0,
  });
}
