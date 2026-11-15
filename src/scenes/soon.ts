import Phaser from 'phaser';
import { drawText } from '../art/text';
import { addBackground, enterScene, H, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { HUB_GAMES } from './hubData';

/** Placeholder for games that are not built yet. Esc (or a click) goes back to the hall. */
export class SoonScene extends Phaser.Scene {
  constructor() {
    super('soon');
  }

  create(data: { id?: string }): void {
    enterScene(this, 'soon');
    addBackground(this);
    const game = HUB_GAMES.find((g) => g.id === data.id);
    hooks.selected = game?.id ?? null;

    this.add.sprite(W / 2, 26, 'jelly').setOrigin(0.5, 0).play('jelly');
    drawText(this, W / 2, 58, game?.title ?? 'Juego', { scale: 2, color: game?.accent ?? 'cyan', align: 'center' });
    drawText(this, W / 2 + 1, 85, 'PRÓXIMAMENTE', { scale: 3, color: 'violet', align: 'center' });
    drawText(this, W / 2, 84, 'PRÓXIMAMENTE', { scale: 3, color: 'lime', align: 'center' });
    drawText(this, W / 2, 112, 'Esta máquina todavía se está montando.', { color: 'foam', align: 'center' });
    if (game) drawText(this, W / 2, 124, game.description, { color: 'dim', align: 'center' });

    const back = drawText(this, W / 2, H - 22, 'Esc  volver al salón', { color: 'cyan', align: 'center' });
    back.setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.scene.start('hub'));
    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', () => this.scene.start('hub'));
    kb.on('keydown-ENTER', () => this.scene.start('hub'));
  }
}
