import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { courseFor } from '../course/data';
import { load } from '../course/service';
import type { CourseState, ModuleStatus, StepStatus } from '../course/progress';
import type { BossStep, PlayStep } from '../course/types';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { GAMES } from '../game/registry';
import { panel } from '../game/ui';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { fit } from './flow';
import { startDailyReview, startStep } from './courseNav';

const ROW_Y = 24;
const ROW_H = 17;
const NAME_X = 16;
const STEP_X = 84;
const STEP_W = 56;
const STEP_GAP = 2;

const CHECK = ['......#', '.....#.', '#...#..', '.#.#...', '..#....'];

/** The course screen: every module with its four steps, what is locked and the next recommended step. */
export class CourseScene extends Phaser.Scene {
  private state!: CourseState;
  private row = 0;
  private col = 0;
  private frame!: Phaser.GameObjects.Graphics;
  private info: Phaser.GameObjects.BitmapText[] = [];
  private busy = false;

  constructor() {
    super('course');
  }

  create(): void {
    enterScene(this, 'course');
    addBackground(this);
    this.busy = false;
    this.info = [];
    void load(profileStore(this)).then((l) => {
      if (!this.scene.isActive()) return;
      this.state = l.state;
      this.build();
    });
  }

  private build(): void {
    const inst = profileStore(this).profile.instrument ?? 'guitar';
    drawText(this, W / 2, 6, 'CURSO', { scale: 2, color: 'magenta', align: 'center' });
    drawText(this, 8, 8, courseFor(inst).family === 'guitar' ? 'Guitarra' : 'Bajo', { color: 'cyan' });
    const done = this.state.modules.filter((m) => m.complete).length;
    drawText(this, W - 8, 8, `${done}/${this.state.modules.length} módulos`, { color: 'foam', align: 'right' });

    const g = this.add.graphics();
    this.state.modules.forEach((ms, r) => {
      const y = ROW_Y + r * ROW_H;
      const color: PaletteKey = ms.unlocked ? ms.module.accent : 'dim';
      if (ms.complete) this.check(g, 6, y + 4, 'lime');
      else if (!ms.unlocked) this.add.image(6, y + 3, 'lock').setOrigin(0, 0).setAlpha(0.6);
      drawText(this, NAME_X, y + 4, ms.module.title, { color: ms.unlocked ? color : 'dim' });
      ms.steps.forEach((st, c) => this.drawStep(g, ms, st, STEP_X + c * (STEP_W + STEP_GAP), y));
      this.add.zone(0, y, W, ROW_H).setOrigin(0, 0).setInteractive({ useHandCursor: true }).on('pointerdown', (p: Phaser.Input.Pointer) => {
        this.row = r;
        this.col = Math.max(0, Math.min(ms.steps.length - 1, Math.floor((p.x - STEP_X) / (STEP_W + STEP_GAP))));
        this.refresh();
        this.activate();
      });
    });
    this.frame = this.add.graphics();
    for (let i = 0; i < 3; i++) this.info.push(drawText(this, 8, 130 + i * 12, '', { color: 'foam' }));
    drawText(this, W / 2, H - 9, '↑↓←→ elegir  Enter jugar  N siguiente  Esc salón', { color: 'dim', align: 'center' });

    const kb = this.input.keyboard!;
    kb.on('keydown-UP', () => this.move(-1, 0));
    kb.on('keydown-DOWN', () => this.move(1, 0));
    kb.on('keydown-LEFT', () => this.move(0, -1));
    kb.on('keydown-RIGHT', () => this.move(0, 1));
    kb.on('keydown-ENTER', () => this.activate());
    kb.on('keydown-SPACE', () => this.activate());
    kb.on('keydown-N', () => this.goNext());
    kb.on('keydown-R', () => void this.review());
    kb.on('keydown-ESC', () => this.scene.start('hub'));
    // Start on the recommended step.
    const next = this.state.next;
    if (next) {
      this.row = Math.max(0, this.state.modules.findIndex((m) => m.module.id === next.moduleId));
      this.col = Math.max(0, this.state.modules[this.row].steps.findIndex((s) => s.id === next.stepId));
    } else this.row = Math.max(1, this.state.modules.length - 1);
    this.refresh();
    hooks.course = {
      modules: this.state.modules.map((m) => ({ id: m.module.id, unlocked: m.unlocked, complete: m.complete, reason: m.reason, steps: m.steps.map((s) => ({ id: s.id, done: s.done, open: s.open })) })),
      unlocked: this.state.unlocked,
      next: next ? `${next.moduleId}:${next.stepId}` : null,
      lit: [],
      due: [],
    };
  }

  private check(g: Phaser.GameObjects.Graphics, x: number, y: number, color: PaletteKey): void {
    g.fillStyle(paletteInt(color), 1);
    CHECK.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') g.fillRect(x + i, y + j, 1, 1);
    });
  }

  private drawStep(g: Phaser.GameObjects.Graphics, ms: ModuleStatus, st: StepStatus, x: number, y: number): void {
    const border: PaletteKey = st.done ? 'lime' : st.open ? ms.module.accent : 'dim';
    panel(g, x, y + 1, STEP_W, ROW_H - 3, border, 'deep', st.open || st.done ? 0.85 : 0.5);
    drawText(this, x + STEP_W / 2, y + 4, st.label, { color: st.done ? 'lime' : st.open ? 'foam' : 'dim', align: 'center' });
    if (!st.done && st.progress > 0) g.fillStyle(paletteInt(ms.module.accent), 1).fillRect(x + 2, y + ROW_H - 4, Math.round((STEP_W - 4) * st.progress), 1);
  }

  private move(dr: number, dc: number): void {
    const rows = this.state.modules.length;
    this.row = (this.row + dr + rows) % rows;
    const cols = this.state.modules[this.row].steps.length;
    this.col = Math.max(0, Math.min(cols - 1, this.col + dc));
    this.refresh();
  }

  private describe(ms: ModuleStatus, st: StepStatus): string {
    const def = ms.module.steps.find((s) => s.id === st.id)!;
    if (def.kind === 'tool') return def.id === 'tuner' ? 'Afina cada cuerda con la aguja de cents.' : 'Mide la latencia de tu equipo con unos clics.';
    if (def.kind === 'learn' || def.kind === 'practice') {
      const p = def as PlayStep;
      const g = GAMES[p.game];
      const levels = p.goals.map((x) => x.level);
      const stars = p.goals[0].minStars;
      const where = levels.length > 1 ? `niveles ${levels[0]}-${levels[levels.length - 1]}` : `nivel ${levels[0]}`;
      const need = stars > 1 ? `${stars} estrellas` : '1 estrella';
      const opens = def.kind === 'practice' ? this.opensText(ms) : '';
      return `${g.title}: ${where} con ${need}.${opens}`;
    }
    if (def.kind === 'review') return `Mezcla ${def.rounds} rondas de este módulo y los anteriores.`;
    const b = def as BossStep;
    return `${b.title}: ${b.phases.length} fases seguidas, media de ${b.passStars} estrellas.`;
  }

  private opensText(ms: ModuleStatus): string {
    const i = this.state.modules.indexOf(ms);
    const next = this.state.modules.slice(i + 1).find((m) => m.module.requires.includes(ms.module.id));
    return next ? ` Abre ${next.module.title}.` : '';
  }

  private lockedReason(ms: ModuleStatus, st: StepStatus): string {
    if (!ms.unlocked) {
      const need = ms.module.requires.map((r) => this.state.modules.find((m) => m.module.id === r)!);
      const p = need[0].module.steps.find((s): s is PlayStep => s.kind === 'practice');
      const t = p ? `${GAMES[p.game].title} nivel ${p.goals[0].level}, ${p.goals[0].minStars} estrellas` : need[0].module.title;
      return `Bloqueado: ${t}.`;
    }
    if (st.kind === 'review') return 'Primero juega algo de este módulo.';
    if (st.kind === 'boss') return 'El jefe llega al superar Practicar.';
    return 'Bloqueado.';
  }

  private refresh(): void {
    const ms = this.state.modules[this.row];
    const st = ms.steps[this.col];
    hooks.selected = `${ms.module.id}:${st.id}`;
    const x = STEP_X + this.col * (STEP_W + STEP_GAP);
    const y = ROW_Y + this.row * ROW_H;
    this.frame.clear();
    this.frame.lineStyle(1, paletteInt(st.open ? 'cyan' : 'dim'), 1).strokeRect(x - 1.5, y - 0.5, STEP_W + 3, ROW_H - 1);
    this.frame.lineStyle(1, paletteInt('dim'), 0.6).strokeRect(2.5, y + 0.5, NAME_X + 64, ROW_H - 2);
    placeText(this.info[0], 8, 130, fit(`${ms.module.title}: ${ms.module.blurb}`, W - 16), { color: ms.module.accent });
    const text = st.open ? this.describe(ms, st) : this.lockedReason(ms, st);
    placeText(this.info[1], 8, 142, fit(text, W - 16), { color: st.open ? 'foam' : 'amber' });
    const next = this.state.next;
    const lvl = next?.level ? ` · nivel ${next.level}` : '';
    placeText(this.info[2], 8, 154, next ? fit(`Siguiente paso: ${next.label}${lvl}`, W - 16) : 'Curso completo: repasa y prueba Turbo.', { color: 'cyan' });
  }

  private activate(): void {
    if (this.busy) return;
    const ms = this.state.modules[this.row];
    const st = ms.steps[this.col];
    if (!st.open) {
      this.cameras.main.shake(100, 0.004);
      return;
    }
    this.busy = true;
    void startStep(this, ms.module.id, st.id).then((err) => {
      if (err) {
        this.busy = false;
        placeText(this.info[1], 8, 142, fit(err, W - 16), { color: 'magenta' });
      }
    });
  }

  private goNext(): void {
    const next = this.state.next;
    if (!next || this.busy) return;
    this.busy = true;
    void startStep(this, next.moduleId, next.stepId).then((err) => {
      if (err) this.busy = false;
    });
  }

  private async review(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const ok = await startDailyReview(this);
    if (!ok && this.scene.isActive()) {
      this.busy = false;
      placeText(this.info[1], 8, 142, 'No hay nada que repasar hoy.', { color: 'amber' });
    }
  }
}
