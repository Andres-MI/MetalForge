/** A row of buttons for the course scenes: ← → choose, Enter/Space press, mouse works too. Palette colours only. */
import type Phaser from 'phaser';
import { drawText } from '../art/text';
import { hooks } from '../engine/hooks';
import { W } from '../engine/kit';
import { panel } from '../game/ui';
import { paletteInt } from '../ui/palette';

export interface ButtonSpec {
  /** Text on the button (about 14 characters fit in 70 px). */
  label: string;
  /** Written to `window.__metalforge.selected` while it is highlighted. */
  id: string;
  act: () => void;
  enabled?: boolean;
}

export interface ButtonRow {
  select(i: number): void;
  press(): void;
  readonly index: number;
}

/** Draws the buttons centred at `y` and wires the keys. `h` is the button height. */
export function addButtons(scene: Phaser.Scene, specs: ButtonSpec[], y: number, opts: { w?: number; h?: number; gap?: number } = {}): ButtonRow {
  const n = specs.length;
  const gap = opts.gap ?? 4;
  const h = opts.h ?? 18;
  const w = opts.w ?? Math.min(100, Math.floor((W - 16 - (n - 1) * gap) / n));
  const x0 = Math.round((W - (n * w + (n - 1) * gap)) / 2);
  const g = scene.add.graphics();
  let index = 0;
  const row: ButtonRow = {
    get index() {
      return index;
    },
    select(i) {
      index = i;
      hooks.selected = specs[i].id;
      g.clear();
      specs.forEach((b, k) => {
        const x = x0 + k * (w + gap);
        const on = k === i;
        const ok = b.enabled !== false;
        panel(g, x, y, w, h, on ? (ok ? 'cyan' : 'dim') : 'water', 'deep', on ? 0.95 : 0.7);
        if (on && ok) g.lineStyle(1, paletteInt('cyan'), 0.5).strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
      });
    },
    press() {
      if (specs[index].enabled !== false) specs[index].act();
    },
  };
  specs.forEach((b, i) => {
    const x = x0 + i * (w + gap);
    drawText(scene, x + w / 2, y + Math.round((h - 7) / 2), b.label, { color: b.enabled === false ? 'dim' : 'foam', align: 'center' });
    const zone = scene.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: b.enabled !== false });
    zone.on('pointerover', () => row.select(i));
    zone.on('pointerdown', () => {
      row.select(i);
      row.press();
    });
  });
  const kb = scene.input.keyboard!;
  kb.on('keydown-LEFT', () => row.select((index + n - 1) % n));
  kb.on('keydown-RIGHT', () => row.select((index + 1) % n));
  kb.on('keydown-ENTER', () => row.press());
  kb.on('keydown-SPACE', () => row.press());
  row.select(0);
  return row;
}
