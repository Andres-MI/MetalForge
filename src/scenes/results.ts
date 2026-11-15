import Phaser from 'phaser';
import { drawText } from '../art/text';
import { addBackground, enterScene, H, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { levelLabel, MAX_LEVEL } from '../exercises';
import { launchGame } from '../game/launch';
import { GAMES } from '../game/registry';
import type { ResultsData } from '../game/scene';
import { fmtMs, panel, star, STAR_SIZE } from '../game/ui';
import { paletteInt, type PaletteKey } from '../ui/palette';

const BTN_W = 98;
const BTN_H = 20;
const BTN_Y = 146;
const BTN_GAP = 4;

/** Results shared by every game: stars, accuracy, rush/drag tendency, strays and what to do next. */
export class ResultsScene extends Phaser.Scene {
  private buttons: { label: string; enabled: boolean; act: () => void }[] = [];
  private index = 0;
  private frames!: Phaser.GameObjects.Graphics;
  private busy = false;

  constructor() {
    super('results');
  }

  create(data: ResultsData): void {
    enterScene(this, 'results');
    addBackground(this);
    this.busy = false;
    const s = data.summary;
    const def = GAMES[data.params.gameId];

    drawText(this, W / 2, 8, 'RESULTADOS', { scale: 2, color: def.accent, align: 'center' });
    drawText(this, W / 2, 26, `${def.title} · Nivel ${data.level} · ${levelLabel(data.skill, data.level)}`, { color: 'dim', align: 'center' });

    // Stars appear one after another.
    const sg = this.add.graphics();
    const scale = 3;
    const sx = Math.round(W / 2 - (3 * STAR_SIZE * scale + 2 * 8) / 2);
    for (let i = 0; i < 3; i++) {
      const earned = i < s.stars;
      this.time.delayedCall(250 + i * 280, () => {
        star(sg, sx + i * (STAR_SIZE * scale + 8), 40, scale, earned ? 'amber' : 'dim', earned ? 1 : 0.5);
        if (earned) this.cameras.main.flash(60, 255, 154, 61, false);
      });
    }

    const pct = Math.round(s.accuracy * 100);
    drawText(this, 64, 84, `${pct} %`, { scale: 3, color: pct >= 85 ? 'lime' : pct >= 60 ? 'foam' : 'amber', align: 'center' });
    drawText(this, 64, 112, 'PRECISIÓN', { color: 'dim', align: 'center' });

    const x = 130;
    let tendency = 'Sin datos';
    let tColor: PaletteKey = 'dim';
    if (s.meanTimingError !== null) {
      const ms = s.meanTimingError * 1000;
      if (s.tendency === 'rush') [tendency, tColor] = [`Te adelantas  ${fmtMs(ms)} de media`, 'amber'];
      else if (s.tendency === 'drag') [tendency, tColor] = [`Te retrasas  ${fmtMs(ms)} de media`, 'magenta'];
      else [tendency, tColor] = [`Vas en el pulso  ${fmtMs(ms)} de media`, 'lime'];
    }
    drawText(this, x, 76, 'TENDENCIA', { color: 'dim' });
    drawText(this, x, 87, tendency, { color: tColor });
    drawText(this, x, 102, 'GOLPES', { color: 'dim' });
    drawText(this, x, 113, `${s.hits} a tiempo  ${s.early} pronto  ${s.late} tarde`, { color: 'foam' });
    drawText(this, x, 124, `${s.miss} sin tocar  ${s.strays} sueltas`, { color: s.strays > 0 ? 'amber' : 'foam' });

    // Arcade games add their score line; without `arcade` the screen is the same as before.
    if (data.arcade) {
      const a = data.arcade;
      const record = a.newBest ? '¡NUEVO RÉCORD!' : `RÉCORD ${a.previousBest}`;
      drawText(this, W / 2, 135, `PUNTOS ${a.score}  ·  MEJOR RACHA ${a.bestCombo}  ·  ${record}`, { color: a.newBest ? 'amber' : 'cyan', align: 'center' });
    }

    const last = data.level >= MAX_LEVEL;
    this.buttons = [
      { label: 'Repetir', enabled: true, act: () => this.go({ ...data.params, seed: undefined }) },
      { label: 'Siguiente nivel', enabled: !last, act: () => this.go({ ...data.params, level: data.level + 1, seed: undefined }) },
      { label: 'Volver al salón', enabled: true, act: () => this.scene.start('hub') },
    ];
    this.frames = this.add.graphics();
    const bx0 = Math.round((W - (3 * BTN_W + 2 * BTN_GAP)) / 2);
    this.buttons.forEach((b, i) => {
      const x0 = bx0 + i * (BTN_W + BTN_GAP);
      drawText(this, x0 + BTN_W / 2, BTN_Y + 7, b.label, { color: b.enabled ? 'foam' : 'dim', align: 'center' });
      const zone = this.add.zone(x0, BTN_Y, BTN_W, BTN_H).setOrigin(0, 0).setInteractive({ useHandCursor: b.enabled });
      zone.on('pointerover', () => this.select(i));
      zone.on('pointerdown', () => {
        this.select(i);
        this.press();
      });
    });
    drawText(this, W / 2, H - 10, '←→ elegir  Enter aceptar  R repetir  N siguiente', { color: 'dim', align: 'center' });

    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.select((this.index + 2) % 3));
    kb.on('keydown-RIGHT', () => this.select((this.index + 1) % 3));
    kb.on('keydown-ENTER', () => this.press());
    kb.on('keydown-SPACE', () => this.press());
    kb.on('keydown-R', () => this.buttons[0].act());
    kb.on('keydown-N', () => this.buttons[1].enabled && this.buttons[1].act());
    kb.on('keydown-ESC', () => this.scene.start('hub'));
    this.select(0);
    hooks.results = hooks.results ?? null;
  }

  private select(i: number): void {
    this.index = i;
    hooks.selected = ['repeat', 'next', 'hub'][i];
    const bx0 = Math.round((W - (3 * BTN_W + 2 * BTN_GAP)) / 2);
    this.frames.clear();
    this.buttons.forEach((b, k) => {
      const x0 = bx0 + k * (BTN_W + BTN_GAP);
      panel(this.frames, x0, BTN_Y, BTN_W, BTN_H, k === i ? (b.enabled ? 'cyan' : 'dim') : 'water', 'deep', k === i ? 0.95 : 0.7);
      if (k === i && b.enabled) this.frames.lineStyle(1, paletteInt('cyan'), 0.5).strokeRect(x0 - 1.5, BTN_Y - 1.5, BTN_W + 3, BTN_H + 3);
    });
  }

  private press(): void {
    const b = this.buttons[this.index];
    if (b.enabled) b.act();
  }

  private go(params: Parameters<typeof launchGame>[1]): void {
    if (this.busy) return;
    this.busy = true;
    void launchGame(this, params).then((err) => {
      if (err) this.busy = false;
    });
  }
}
