import Phaser from 'phaser';
import { drawText } from '../art/text';
import { addBackground, enterScene, H, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { gameFor } from '../game/registry';
import { panel } from '../game/ui';
import { paletteInt } from '../ui/palette';
import { HUB_GAMES } from './hubData';

const BOX_W = 140;
const BOX_H = 70;
const GAP = 12;
const BOX_Y = 66;

interface Choice {
  mode: 'learn' | 'practice';
  word: string;
  label: string;
  line: string;
  scene: string | null;
}

/** Small choice shown when entering a cabinet that has two games: learn (sober) or practice (arcade). */
export class ModeChoiceScene extends Phaser.Scene {
  private index = 0;
  private frames!: Phaser.GameObjects.Graphics;
  private choices: Choice[] = [];

  constructor() {
    super('modechoice');
  }

  create(data: { id?: string }): void {
    enterScene(this, 'modechoice');
    addBackground(this);
    const cabinet = HUB_GAMES.find((g) => g.id === data.id) ?? HUB_GAMES[0];
    const learn = gameFor(cabinet.id, 'learn');
    const practice = gameFor(cabinet.id, 'practice');
    this.choices = [
      { mode: 'learn', word: 'APRENDER', label: `Aprender (${learn?.title ?? '?'})`, line: 'Sin reloj ni castigo.', scene: learn ? 'levelselect' : null },
      { mode: 'practice', word: 'PRACTICAR', label: `Practicar (${practice?.title ?? '?'})`, line: practice?.scene ? 'Arcade con tiempo.' : 'Próximamente.', scene: practice?.scene ? 'levelselect' : null },
    ];
    this.index = 0;

    drawText(this, W / 2, 14, cabinet.title.toUpperCase(), { scale: 2, color: cabinet.accent, align: 'center' });
    drawText(this, W / 2, 34, `Habilidad: ${cabinet.skill}`, { color: 'dim', align: 'center' });
    drawText(this, W / 2, 48, '¿Cómo quieres jugar?', { color: 'foam', align: 'center' });

    this.frames = this.add.graphics();
    this.choices.forEach((c, i) => {
      const x = this.boxX(i);
      drawText(this, x + BOX_W / 2, BOX_Y + 12, c.word, { scale: 2, color: c.scene ? cabinet.accent : 'dim', align: 'center' });
      drawText(this, x + BOX_W / 2, BOX_Y + 34, c.label, { color: c.scene ? 'foam' : 'dim', align: 'center' });
      drawText(this, x + BOX_W / 2, BOX_Y + 48, c.line, { color: c.scene ? 'dim' : 'amber', align: 'center' });
      const zone = this.add.zone(x, BOX_Y, BOX_W, BOX_H).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.select(i));
      zone.on('pointerdown', () => {
        this.select(i);
        this.choose(data.id ?? cabinet.id);
      });
    });
    drawText(this, W / 2, H - 22, '← → elegir   Enter entrar   Esc volver', { color: 'dim', align: 'center' });

    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.select(0));
    kb.on('keydown-RIGHT', () => this.select(1));
    kb.on('keydown-ENTER', () => this.choose(cabinet.id));
    kb.on('keydown-SPACE', () => this.choose(cabinet.id));
    kb.on('keydown-ESC', () => this.scene.start('hub'));
    this.select(0);
  }

  private boxX(i: number): number {
    return Math.round(W / 2 - BOX_W - GAP / 2) + i * (BOX_W + GAP);
  }

  private select(i: number): void {
    this.index = i;
    hooks.selected = this.choices[i].mode;
    this.frames.clear();
    this.choices.forEach((c, k) => {
      panel(this.frames, this.boxX(k), BOX_Y, BOX_W, BOX_H, k === i ? (c.scene ? 'cyan' : 'amber') : 'dim', 'abyss', k === i ? 0.92 : 0.7);
      if (k === i) this.frames.lineStyle(1, paletteInt(c.scene ? 'cyan' : 'amber'), 0.5).strokeRect(this.boxX(k) - 1.5, BOX_Y - 1.5, BOX_W + 3, BOX_H + 3);
    });
  }

  private choose(cabinetId: string): void {
    const c = this.choices[this.index];
    const game = gameFor(cabinetId, c.mode);
    if (!game?.scene) this.scene.start('soon', { id: cabinetId });
    else this.scene.start('levelselect', { gameId: game.id });
  }
}
