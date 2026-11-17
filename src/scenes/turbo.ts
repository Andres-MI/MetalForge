import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { readTurbo, type TurboRecord } from '../course/blob';
import { turboStartLevel } from '../course/flow';
import { highestCleared } from '../course/progress';
import { load } from '../course/service';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { MAX_LEVEL } from '../exercises';
import { GAMES } from '../game/registry';
import { panel } from '../game/ui';
import { startTurbo } from './courseNav';
import type { PaletteKey } from '../ui/palette';

interface Row {
  gameId: string;
  title: string;
  accent: PaletteKey;
  open: boolean;
  records: TurboRecord[];
  start: number;
}

const ROW_Y = 45;
const ROW_H = 18;

/** Turbo cabinet: pick one of the open arcades, see its record table and start the survival ladder. */
export class TurboScene extends Phaser.Scene {
  private rows: Row[] = [];
  private index = 0;
  private frame!: Phaser.GameObjects.Graphics;
  private table: Phaser.GameObjects.BitmapText[] = [];
  private startText!: Phaser.GameObjects.BitmapText;
  private status!: Phaser.GameObjects.BitmapText;
  private busy = false;

  constructor() {
    super('turbo');
  }

  create(): void {
    enterScene(this, 'turbo');
    addBackground(this);
    this.busy = false;
    this.rows = [];
    this.table = [];
    drawText(this, W / 2 + 1, 9, 'TURBO', { scale: 3, color: 'violet', align: 'center' });
    drawText(this, W / 2, 8, 'TURBO', { scale: 3, color: 'amber', align: 'center' });
    drawText(this, W / 2, 31, 'Cada ronda sube un nivel hasta que caigas.', { color: 'foam', align: 'center' });
    void load(profileStore(this)).then((l) => {
      if (!this.scene.isActive()) return;
      const arcades = Object.values(GAMES).filter((g) => g.mode === 'practice' && g.scene);
      this.rows = arcades.map((g) => {
        const mod = l.state.modules.find((m) => m.module.skill === g.skill);
        return { gameId: g.id, title: g.title, accent: g.accent, open: !!mod?.unlocked, records: readTurbo(l.blob, g.id), start: turboStartLevel(highestCleared(l.blob, g.id)) };
      });
      this.build();
    });
  }

  private build(): void {
    this.frame = this.add.graphics();
    this.rows.forEach((r, i) => {
      const y = ROW_Y + 8 + i * ROW_H;
      drawText(this, 14, y + 6, r.title, { scale: 1, color: r.open ? r.accent : 'dim' });
      drawText(this, 120, y + 6, r.open ? (r.records[0] ? `${r.records[0].score}` : '-') : 'apagado', { color: r.open ? 'foam' : 'dim', align: 'right' });
      this.add.zone(8, y, 120, ROW_H - 2).setOrigin(0, 0).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        this.select(i);
        void this.go();
      });
    });
    drawText(this, 14, ROW_Y - 2, 'ARCADE', { color: 'dim' });
    drawText(this, 120, ROW_Y - 2, 'MEJOR', { color: 'dim', align: 'right' });
    for (let i = 0; i < 6; i++) this.table.push(drawText(this, 150, ROW_Y + 8 + i * 12, '', { color: 'foam' }));
    this.startText = drawText(this, 150, ROW_Y + 90, '', { color: 'cyan' });
    this.status = drawText(this, W / 2, H - 22, '', { color: 'amber', align: 'center' });
    drawText(this, W / 2, H - 9, '↑↓ arcade  ←→ nivel  Enter empezar  Esc salón', { color: 'dim', align: 'center' });
    const kb = this.input.keyboard!;
    kb.on('keydown-UP', () => this.select((this.index + this.rows.length - 1) % this.rows.length));
    kb.on('keydown-DOWN', () => this.select((this.index + 1) % this.rows.length));
    kb.on('keydown-LEFT', () => this.level(-1));
    kb.on('keydown-RIGHT', () => this.level(1));
    kb.on('keydown-ENTER', () => void this.go());
    kb.on('keydown-SPACE', () => void this.go());
    kb.on('keydown-ESC', () => this.scene.start('hub'));
    this.select(Math.max(0, this.rows.findIndex((r) => r.open)));
  }

  private level(d: number): void {
    const r = this.rows[this.index];
    r.start = Math.max(1, Math.min(MAX_LEVEL, r.start + d));
    this.select(this.index);
  }

  private select(i: number): void {
    this.index = i;
    const r = this.rows[i];
    hooks.selected = r.gameId;
    this.frame.clear();
    panel(this.frame, 8, ROW_Y + 8 + i * ROW_H, 120, ROW_H - 2, r.open ? r.accent : 'dim', 'deep', 0.9);
    panel(this.frame, 144, ROW_Y, W - 152, 108, 'water', 'abyss', 0.8);
    this.table.forEach((t, k) => {
      if (k === 0) return placeText(t, 150, ROW_Y + 6, `RÉCORDS DE ${r.title.toUpperCase()}`, { color: r.accent });
      const rec = r.records[k - 1];
      placeText(t, 150, ROW_Y + 8 + k * 12, rec ? `${k}.  ${rec.score} · ${rec.rounds} rondas` : `${k}.  -`, { color: rec ? (k === 1 ? 'lime' : 'foam') : 'dim' });
    });
    placeText(this.startText, 150, ROW_Y + 92, r.open ? `Salida: nivel ${r.start} (← →)` : 'Apagado: abre su módulo en el curso.', { color: r.open ? 'cyan' : 'amber' });
    placeText(this.status, W / 2, H - 22, '', { color: 'amber', align: 'center' });
  }

  private async go(): Promise<void> {
    const r = this.rows[this.index];
    if (!r.open) {
      this.cameras.main.shake(100, 0.004);
      placeText(this.status, W / 2, H - 22, 'Ese arcade está apagado: desbloquea su módulo.', { color: 'amber', align: 'center' });
      return;
    }
    if (this.busy) return;
    this.busy = true;
    await startTurbo(this, r.gameId, r.start);
  }
}
