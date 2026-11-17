import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { levelLabel, MAX_LEVEL } from '../exercises';
import { launchGame } from '../game/launch';
import { GAMES } from '../game/registry';
import type { ResultsData } from '../game/scene';
import { fmtMs, panel, star, STAR_SIZE } from '../game/ui';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { load, recordLevel } from '../course/service';
import { completePhase, isFlowResult, startStep } from './courseNav';

const BTN_H = 20;
const BTN_Y = 146;
const BTN_GAP = 4;

/** Results shared by every game: stars, accuracy, rush/drag tendency, strays and what to do next. */
export class ResultsScene extends Phaser.Scene {
  private buttons: { id: string; label: string; enabled: boolean; act: () => void }[] = [];
  private hint!: Phaser.GameObjects.BitmapText;
  private btnW = 98;
  private btnX0 = 0;
  private index = 0;
  private frames!: Phaser.GameObjects.Graphics;
  private busy = false;

  constructor() {
    super('results');
  }

  create(data: ResultsData): void {
    // A round of a running flow (boss, review, Turbo) goes on to its bridge screen instead.
    if (isFlowResult(this, data)) {
      addBackground(this);
      void completePhase(this, data);
      return;
    }
    enterScene(this, 'results');
    addBackground(this);
    this.busy = false;
    this.buttons = [];
    this.index = 0;
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
    drawText(this, x, 79, 'TENDENCIA', { color: 'dim' });
    drawText(this, x, 89, tendency, { color: tColor });
    drawText(this, x, 102, 'GOLPES', { color: 'dim' });
    drawText(this, x, 112, `${s.hits} a tiempo  ${s.early} pronto  ${s.late} tarde`, { color: 'foam' });
    drawText(this, x, 122, `${s.miss} sin tocar  ${s.strays} sueltas`, { color: s.strays > 0 ? 'amber' : 'foam' });

    // Arcade games add their score line; without `arcade` the screen is the same as before.
    if (data.arcade) {
      const a = data.arcade;
      const record = a.newBest ? '¡NUEVO RÉCORD!' : `RÉCORD ${a.previousBest}`;
      drawText(this, W / 2, 135, `PUNTOS ${a.score}  ·  MEJOR RACHA ${a.bestCombo}  ·  ${record}`, { color: a.newBest ? 'amber' : 'cyan', align: 'center' });
    }

    this.frames = this.add.graphics();
    this.hint = drawText(this, W / 2, H - 10, '←→ elegir  Enter aceptar  R repetir  N nivel', { color: 'dim', align: 'center' });

    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.select((this.index + this.buttons.length - 1) % Math.max(1, this.buttons.length)));
    kb.on('keydown-RIGHT', () => this.select((this.index + 1) % Math.max(1, this.buttons.length)));
    kb.on('keydown-ENTER', () => this.press());
    kb.on('keydown-SPACE', () => this.press());
    kb.on('keydown-R', () => this.buttons.find((b) => b.id === 'repeat')?.act());
    kb.on('keydown-N', () => {
      const b = this.buttons.find((x) => x.id === 'next');
      if (b?.enabled) b.act();
    });
    kb.on('keydown-P', () => {
      const b = this.buttons.find((x) => x.id === 'step');
      if (b?.enabled) b.act();
    });
    kb.on('keydown-ESC', () => this.scene.start('hub'));
    hooks.results = hooks.results ?? null;
    void this.finish(data);
  }

  /** Saves the stars of the level, shows what it opened and builds the buttons (with the next course step). */
  private async finish(data: ResultsData): Promise<void> {
    const store = profileStore(this);
    let change: Awaited<ReturnType<typeof recordLevel>> | null = null;
    try {
      change = await recordLevel(store, data.params.gameId, data.level, data.summary.stars, Date.now());
    } catch {
      change = null;
    }
    if (!this.scene.isActive()) return;
    const next = change ? (await load(store)).state.next : null;
    if (!this.scene.isActive()) return;
    const titles = change?.unlocked.map((m) => m.title) ?? [];
    const done = change?.completed.map((m) => m.title) ?? [];
    const banner = titles.length ? `¡Módulo ${titles.join(' y ')} desbloqueado!` : done.length ? `¡Módulo ${done.join(' y ')} completado!` : '';
    if (banner) {
      const t = drawText(this, W / 2, 68, banner, { color: 'lime', align: 'center' });
      t.setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, duration: 300, delay: 1100 });
    }
    hooks.results = hooks.results ? { ...hooks.results, unlocked: change?.unlocked.map((m) => m.id) ?? [], completed: change?.completed.map((m) => m.id) ?? [], next: next ? `${next.moduleId}:${next.stepId}` : null } : hooks.results;

    const last = data.level >= MAX_LEVEL;
    this.buttons = [
      { id: 'repeat', label: 'Repetir', enabled: true, act: () => this.go({ ...data.params, seed: undefined }) },
      { id: 'next', label: 'Sig. nivel', enabled: !last, act: () => this.go({ ...data.params, level: data.level + 1, seed: undefined }) },
    ];
    if (next) this.buttons.push({ id: 'step', label: 'Sig. paso', enabled: true, act: () => void this.goStep(next.moduleId, next.stepId) });
    this.buttons.push({ id: 'hub', label: 'Salón', enabled: true, act: () => this.scene.start('hub') });
    if (next) placeText(this.hint, W / 2, H - 10, `P siguiente paso: ${next.label}`, { color: 'cyan', align: 'center' });
    const n = this.buttons.length;
    const bw = Math.floor((W - 16 - (n - 1) * BTN_GAP) / n);
    const bx0 = Math.round((W - (n * bw + (n - 1) * BTN_GAP)) / 2);
    this.btnW = bw;
    this.btnX0 = bx0;
    this.buttons.forEach((b, i) => {
      const x0 = bx0 + i * (bw + BTN_GAP);
      drawText(this, x0 + bw / 2, BTN_Y + 7, b.label, { color: b.enabled ? 'foam' : 'dim', align: 'center' });
      const zone = this.add.zone(x0, BTN_Y, bw, BTN_H).setOrigin(0, 0).setInteractive({ useHandCursor: b.enabled });
      zone.on('pointerover', () => this.select(i));
      zone.on('pointerdown', () => {
        this.select(i);
        this.press();
      });
    });
    this.select(0);
  }

  private select(i: number): void {
    this.index = i;
    if (!this.buttons.length) return;
    hooks.selected = this.buttons[i].id;
    this.frames.clear();
    this.buttons.forEach((b, k) => {
      const x0 = this.btnX0 + k * (this.btnW + BTN_GAP);
      panel(this.frames, x0, BTN_Y, this.btnW, BTN_H, k === i ? (b.enabled ? 'cyan' : 'dim') : 'water', 'deep', k === i ? 0.95 : 0.7);
      if (k === i && b.enabled) this.frames.lineStyle(1, paletteInt('cyan'), 0.5).strokeRect(x0 - 1.5, BTN_Y - 1.5, this.btnW + 3, BTN_H + 3);
    });
  }

  private press(): void {
    const b = this.buttons[this.index];
    if (b?.enabled) b.act();
  }

  private async goStep(moduleId: string, stepId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const err = await startStep(this, moduleId, stepId);
    if (err) this.busy = false;
  }

  private go(params: Parameters<typeof launchGame>[1]): void {
    if (this.busy) return;
    this.busy = true;
    void launchGame(this, params).then((err) => {
      if (err) this.busy = false;
    });
  }
}
