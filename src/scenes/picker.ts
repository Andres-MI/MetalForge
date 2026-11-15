import Phaser from 'phaser';
import { drawText } from '../art/text';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { INSTRUMENTS, type InstrumentId } from '../model/instrument';
import { paletteInt, STRING_COLOR_KEYS } from '../ui/palette';
import { SHORT_LABEL } from './hubData';

const ORDER: InstrumentId[] = ['guitar', 'bass4', 'bass5'];
const PANEL_W = 92;
const PANEL_H = 92;
const PANEL_Y = 44;

/** First run (and the I key in the hub): choose guitar, 4-string bass or 5-string bass. */
export class PickerScene extends Phaser.Scene {
  private index = 0;
  private frames: Phaser.GameObjects.Graphics[] = [];
  private fromHub = false;

  constructor() {
    super('picker');
  }

  create(): void {
    enterScene(this, 'picker');
    addBackground(this);
    const current = profileStore(this).profile.instrument;
    this.fromHub = current !== null;
    this.index = current ? ORDER.indexOf(current) : 0;
    this.frames = [];

    drawText(this, W / 2, 10, 'ELIGE TU INSTRUMENTO', { scale: 2, color: 'magenta', align: 'center' });
    drawText(this, W / 2, 30, 'Cada instrumento guarda su propio progreso.', { color: 'foam', align: 'center' });

    ORDER.forEach((id, i) => {
      const cx = W / 2 + (i - 1) * (PANEL_W + 6);
      const left = cx - PANEL_W / 2;
      const frame = this.add.graphics();
      this.frames.push(frame);
      const inst = INSTRUMENTS[id];
      // The neck: one coloured line per string, lowest-pitched on the left.
      const n = inst.openStrings.length;
      const gap = 7;
      const x0 = cx - ((n - 1) * gap) / 2;
      const neck = this.add.graphics();
      neck.fillStyle(paletteInt('foam'), 1);
      neck.fillRect(x0 - 4, PANEL_Y + 10, (n - 1) * gap + 9, 2);
      for (let s = 0; s < n; s++) {
        neck.fillStyle(paletteInt(STRING_COLOR_KEYS[s % STRING_COLOR_KEYS.length]), 1);
        neck.fillRect(x0 + s * gap, PANEL_Y + 12, 2, 46);
      }
      neck.fillStyle(paletteInt('dim'), 1);
      for (let f = 1; f <= 3; f++) neck.fillRect(x0 - 4, PANEL_Y + 12 + f * 14, (n - 1) * gap + 9, 1);
      drawText(this, cx, PANEL_Y + 66, SHORT_LABEL[id], { color: 'foam', align: 'center' });
      drawText(this, cx, PANEL_Y + 78, `${n} cuerdas`, { color: 'dim', align: 'center' });

      const zone = this.add.zone(left, PANEL_Y, PANEL_W, PANEL_H).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.select(i));
      zone.on('pointerdown', () => {
        this.select(i);
        this.confirm();
      });
    });

    const hint = this.fromHub ? '← → elegir   Enter confirmar   Esc volver' : '← → elegir   Enter confirmar';
    drawText(this, W / 2, H - 22, hint, { color: 'dim', align: 'center' });
    if (!this.fromHub) drawText(this, W / 2, H - 12, 'Podrás cambiarlo con la tecla I en el salón.', { color: 'dim', align: 'center' });

    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.select((this.index + ORDER.length - 1) % ORDER.length));
    kb.on('keydown-RIGHT', () => this.select((this.index + 1) % ORDER.length));
    kb.on('keydown-ENTER', () => this.confirm());
    kb.on('keydown-SPACE', () => this.confirm());
    kb.on('keydown-ESC', () => {
      if (this.fromHub) this.scene.start('hub');
    });
    this.select(this.index);
  }

  private select(i: number): void {
    this.index = i;
    hooks.selected = ORDER[i];
    this.frames.forEach((g, k) => {
      const cx = W / 2 + (k - 1) * (PANEL_W + 6);
      const on = k === i;
      g.clear();
      g.fillStyle(paletteInt('deep'), 0.85);
      g.fillRect(cx - PANEL_W / 2, PANEL_Y, PANEL_W, PANEL_H);
      g.lineStyle(on ? 2 : 1, paletteInt(on ? 'magenta' : 'dim'), 1);
      g.strokeRect(cx - PANEL_W / 2 + 1, PANEL_Y + 1, PANEL_W - 2, PANEL_H - 2);
    });
  }

  private confirm(): void {
    const id = ORDER[this.index];
    void profileStore(this)
      .setInstrument(id)
      .then(() => this.scene.start('hub'));
  }
}
