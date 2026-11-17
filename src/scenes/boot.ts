import Phaser from 'phaser';
import { registerArt } from '../art/textures';
import { openStorage } from '../profile/idb';
import { ProfileStore } from '../profile/store';
import { hooks } from '../engine/hooks';

/** Builds textures and the font, opens the profile, then goes to the picker (first run) or the hub. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    hooks.scene = 'boot';
    registerArt(this);
    hooks.courseOpen = new URLSearchParams(window.location.search).get('curso') === 'abierto';
    void openStorage().then(async (storage) => {
      const store = new ProfileStore(storage);
      await store.load();
      this.registry.set('store', store);
      hooks.progress = {
        get: async () => store.getProgress(store.profile.instrument ?? 'guitar'),
        set: async (blob) => store.saveProgress(store.profile.instrument ?? 'guitar', blob),
        clear: async () => store.clearProgress(store.profile.instrument ?? 'guitar'),
      };
      this.scene.start(store.profile.instrument ? 'hub' : 'picker');
    });
  }
}
