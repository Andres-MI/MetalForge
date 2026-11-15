/** Phaser setup: 320x180 internal resolution, integer zoom, no smoothing, centred on the page. */
import Phaser from 'phaser';
import { installKeyboardFix } from './keyboardFix';
import { PALETTE } from '../ui/palette';
import { H, W } from './kit';

/** Largest whole-number zoom that fits the window (never below 1). */
export function integerZoom(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.min(width / W, height / H)));
}

export function createGame(parent: HTMLElement, scenes: Phaser.Types.Scenes.SceneType[]): Phaser.Game {
  installKeyboardFix();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: W,
    height: H,
    backgroundColor: PALETTE.abyss,
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    banner: false,
    audio: { noAudio: true },
    scale: { mode: Phaser.Scale.NONE, zoom: integerZoom(window.innerWidth, window.innerHeight) },
    scene: scenes,
  });
  window.addEventListener('resize', () => game.scale.setZoom(integerZoom(window.innerWidth, window.innerHeight)));
  return game;
}
