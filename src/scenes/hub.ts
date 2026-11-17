import Phaser from 'phaser';
import { CABINET_H, CABINET_SCREEN, CABINET_W } from '../art/sprites';
import { cabinetKey, iconKey } from '../art/textures';
import { drawText, placeText } from '../art/text';
import { readTurbo, type TurboRecord } from '../course/blob';
import { courseFor, moduleOfCabinet } from '../course/data';
import { bestFor, unlockedSkills, type GameBest } from '../course/progress';
import { dueBySkill } from '../course/review';
import { load } from '../course/service';
import type { PlayStep } from '../course/types';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { GAMES, gameFor } from '../game/registry';
import { star } from '../game/ui';
import { paletteInt } from '../ui/palette';
import { clearFlow, startDailyReview } from './courseNav';
import { fit } from './flow';
import { HUB_GAMES, SHORT_LABEL, type HubGame } from './hubData';

const PITCH = 42;
const CAB_TOP = 44;
const FLOOR_Y = CAB_TOP + CABINET_H;
const PANEL_Y = 120;

const cabX = (i: number) => W / 2 + (i - (HUB_GAMES.length - 1) / 2) * PITCH;

interface CabInfo {
  lit: boolean;
  /** Weak items of the cabinet's skill (blinks when > 0). */
  due: number;
  learn: GameBest | null;
  practice: GameBest | null;
}

/** The arcade hall: a dark room lit like an aquarium, one cabinet per game, lit by the course progress. */
export class HubScene extends Phaser.Scene {
  private index = 0;
  private hero!: Phaser.GameObjects.Sprite;
  private marker!: Phaser.GameObjects.Graphics;
  private arrow!: Phaser.GameObjects.BitmapText;
  private title!: Phaser.GameObjects.BitmapText;
  private skill!: Phaser.GameObjects.BitmapText;
  private skillRight!: Phaser.GameObjects.BitmapText;
  private desc!: Phaser.GameObjects.BitmapText;
  private statsG!: Phaser.GameObjects.Graphics;
  private stats: Phaser.GameObjects.BitmapText[] = [];
  private reviewBadge!: Phaser.GameObjects.BitmapText;
  private screens: Phaser.GameObjects.Rectangle[] = [];
  private glows: Phaser.GameObjects.Image[] = [];
  private dueDots: (Phaser.GameObjects.Rectangle | null)[] = [];
  private arrowX = 0;
  private flash: Phaser.Time.TimerEvent | null = null;
  private infos: CabInfo[] = [];
  private turboBest: TurboRecord | null = null;
  private dueTotal = 0;
  private ready = false;

  constructor() {
    super('hub');
  }

  create(): void {
    enterScene(this, 'hub');
    clearFlow(this);
    const store = profileStore(this);
    const bg = addBackground(this);
    this.screens = [];
    this.glows = [];
    this.dueDots = [];
    this.stats = [];
    this.flash = null;
    this.ready = false;

    this.drawRoom();
    drawText(this, W / 2 + 1, 9, 'METALFORGE', { scale: 2, color: 'violet', align: 'center' });
    drawText(this, W / 2, 8, 'METALFORGE', { scale: 2, color: 'magenta', align: 'center' });
    const inst = store.profile.instrument;
    if (inst) drawText(this, 8, 8, SHORT_LABEL[inst], { color: 'cyan' });
    this.reviewBadge = drawText(this, W - 8, 8, '', { color: 'dim', align: 'right' });

    this.hero = this.add.sprite(cabX(this.index), FLOOR_Y + 5, 'hero').setOrigin(0.5, 0).setDepth(5);
    this.hero.play('hero');
    this.marker = this.add.graphics().setDepth(6);
    this.arrow = drawText(this, 0, 0, '↓', { color: 'lime', align: 'center', depth: 6 });

    this.add.graphics().setDepth(7).fillStyle(paletteInt('abyss'), 0.88).fillRect(4, PANEL_Y, W - 8, H - PANEL_Y - 4).lineStyle(1, paletteInt('dim'), 1).strokeRect(4.5, PANEL_Y + 0.5, W - 9, H - PANEL_Y - 5);
    this.title = drawText(this, 12, PANEL_Y + 5, '', { scale: 2, depth: 8 });
    this.skill = drawText(this, 12, PANEL_Y + 24, '', { color: 'dim', depth: 8 });
    this.skillRight = drawText(this, W - 12, PANEL_Y + 24, '', { color: 'lime', align: 'right', depth: 8 });
    this.desc = drawText(this, 12, PANEL_Y + 34, '', { color: 'foam', depth: 8 });
    this.statsG = this.add.graphics().setDepth(8);
    for (let i = 0; i < 6; i++) this.stats.push(drawText(this, 0, PANEL_Y + 45, '', { color: 'dim', depth: 8 }));
    this.add.rectangle(0, PANEL_Y - 14, W, 12, paletteInt('abyss'), 0.7).setOrigin(0, 0).setDepth(7);
    drawText(this, W / 2, PANEL_Y - 10, '←→ elegir  Enter  U curso  R repaso  S ajustes', { color: 'dim', align: 'center', depth: 8 });

    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.ready && this.select((this.index + HUB_GAMES.length - 1) % HUB_GAMES.length));
    kb.on('keydown-RIGHT', () => this.ready && this.select((this.index + 1) % HUB_GAMES.length));
    kb.on('keydown-ENTER', () => this.activate());
    kb.on('keydown-SPACE', () => this.activate());
    kb.on('keydown-I', () => this.scene.start('picker'));
    kb.on('keydown-C', () => this.scene.start('calibration', {}));
    kb.on('keydown-U', () => this.scene.start('course'));
    kb.on('keydown-S', () => this.scene.start('settings', {}));
    kb.on('keydown-R', () => void this.review());
    kb.on('keydown-B', () => {
      bg.setEnabled(!bg.isEnabled);
      hooks.backgroundEffects = bg.isEnabled;
      void store.setSettings({ backgroundEffects: bg.isEnabled });
    });

    void load(store).then((l) => {
      if (!this.scene.isActive()) return;
      const course = courseFor(l.instrument);
      const due = dueBySkill(l.mastery, Date.now(), unlockedSkills(l.state));
      this.dueTotal = Object.values(due).reduce((s, n) => s + (n ?? 0), 0);
      const bestOf = (game: string | undefined) => (game ? bestFor(l.blob, game) : null);
      this.infos = HUB_GAMES.map((g) => {
        const mod = moduleOfCabinet(course, g.id);
        if (g.id === 'turbo') return { lit: l.state.modules.some((m) => m.unlocked && m.module.skill !== null), due: 0, learn: null, practice: null };
        const ms = l.state.modules.find((m) => m.module.id === mod?.id);
        const learn = mod?.steps.find((s): s is PlayStep => s.kind === 'learn');
        const practice = mod?.steps.find((s): s is PlayStep => s.kind === 'practice');
        return { lit: !!ms?.unlocked, due: mod?.skill ? (due[mod.skill] ?? 0) : 0, learn: bestOf(learn?.game), practice: bestOf(practice?.game) };
      });
      this.turboBest = Object.values(GAMES)
        .filter((g) => g.mode === 'practice')
        .flatMap((g) => readTurbo(l.blob, g.id))
        .sort((a, b) => b.score - a.score)[0] ?? null;
      HUB_GAMES.forEach((game, i) => this.addCabinet(game, i));
      placeText(this.reviewBadge, W - 8, 8, this.dueTotal > 0 ? `Repaso: ${this.dueTotal} (R)` : 'Repaso al día', { color: this.dueTotal > 0 ? 'lime' : 'dim', align: 'right' });
      hooks.course = {
        modules: l.state.modules.map((m) => ({ id: m.module.id, unlocked: m.unlocked, complete: m.complete, reason: m.reason, steps: m.steps.map((s) => ({ id: s.id, done: s.done, open: s.open })) })),
        unlocked: l.state.unlocked,
        next: l.state.next ? `${l.state.next.moduleId}:${l.state.next.stepId}` : null,
        lit: HUB_GAMES.filter((_, i) => this.infos[i].lit).map((g) => g.id),
        due: HUB_GAMES.filter((_, i) => this.infos[i].due > 0).map((g) => g.id),
      };
      this.ready = true;
      this.select(this.index, true);
    });
  }

  update(time: number): void {
    // Screens flicker softly; the lit ones breathe, the dark ones stay dead.
    this.screens.forEach((s, i) => {
      s.setAlpha(0.1 + 0.12 * (0.5 + 0.5 * Math.sin(time / 380 + i * 1.7)));
    });
    // A cabinet whose skill is due for review blinks a small lime light on its top.
    const on = Math.floor(time / 520) % 2 === 0;
    this.dueDots.forEach((d) => d?.setAlpha(on ? 1 : 0.15));
    placeText(this.arrow, this.arrowX, CAB_TOP - 12 + Math.round(Math.sin(time / 180)), '↓', { color: 'lime', align: 'center' });
  }

  private drawRoom(): void {
    const g = this.add.graphics().setDepth(-10);
    g.fillStyle(paletteInt('abyss'), 0.6).fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    g.fillStyle(paletteInt('water'), 1).fillRect(0, FLOOR_Y, W, 1);
    g.fillStyle(paletteInt('water'), 0.45);
    for (const y of [FLOOR_Y + 12, FLOOR_Y + 30]) g.fillRect(0, y, W, 1);
    // A wide cyan glow behind the row of cabinets: the light of the tank.
    this.add.image(W / 2, CAB_TOP + 20, 'aq:glow').setTint(paletteInt('cyan')).setAlpha(0.28).setScale(4.2, 1.1).setBlendMode(Phaser.BlendModes.ADD).setDepth(-9);
  }

  private addCabinet(game: HubGame, i: number): void {
    const cx = cabX(i);
    const left = Math.round(cx - CABINET_W / 2);
    const info = this.infos[i];
    const lit = info.lit;
    const key = cabinetKey(lit ? game.accent : 'locked');
    const glow = this.add
      .image(cx, CAB_TOP + 20, 'aq:glow')
      .setTint(paletteInt(game.accent))
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.9, 1)
      .setAlpha(lit ? 0.32 : 0)
      .setDepth(-5);
    this.glows.push(glow);
    this.add.image(left, FLOOR_Y, key).setOrigin(0, 0).setCrop(0, 0, CABINET_W, 22).setFlipY(true).setAlpha(lit ? 0.2 : 0.1).setDepth(-4);
    this.add.image(left, CAB_TOP, key).setOrigin(0, 0).setDepth(1);
    const sx = left + CABINET_SCREEN.x;
    const sy = CAB_TOP + CABINET_SCREEN.y;
    if (lit) {
      this.add.rectangle(sx, sy, CABINET_SCREEN.w, CABINET_SCREEN.h, paletteInt(game.accent), 0.14).setOrigin(0, 0).setDepth(2);
      this.add.image(sx + 4, sy + 4, iconKey(game.icon, game.accent)).setOrigin(0, 0).setDepth(3);
      this.screens.push(this.add.rectangle(sx, sy, CABINET_SCREEN.w, CABINET_SCREEN.h, paletteInt(game.accent), 0.15).setOrigin(0, 0).setDepth(4));
    } else {
      this.add.image(sx + 4, sy + 4, 'lock').setOrigin(0, 0).setAlpha(0.55).setDepth(3);
    }
    this.dueDots.push(info.due > 0 && lit ? this.add.rectangle(left + CABINET_W - 4, CAB_TOP + 2, 3, 3, paletteInt('lime'), 1).setOrigin(0, 0).setDepth(6) : null);
    // The best stars of the cabinet under it: three small marks.
    const best = info.practice ?? info.learn;
    if (lit && best) {
      const g = this.add.graphics().setDepth(3);
      for (let k = 0; k < 3; k++) g.fillStyle(paletteInt(k < best.stars ? 'amber' : 'dim'), k < best.stars ? 1 : 0.5).fillRect(cx - 8 + k * 6, FLOOR_Y + 2, 4, 3);
    }
    const zone = this.add.zone(left, CAB_TOP, CABINET_W, CABINET_H).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => this.ready && this.select(i));
    zone.on('pointerdown', () => {
      this.select(i);
      this.activate();
    });
  }

  private select(i: number, instant = false): void {
    this.index = i;
    const game = HUB_GAMES[i];
    hooks.selected = game.id;
    const cx = cabX(i);
    if (instant) this.hero.setX(cx);
    else this.tweens.add({ targets: this.hero, x: cx, duration: 150, ease: 'Sine.easeOut' });
    const lit = this.infos[i]?.lit ?? false;
    this.glows.forEach((g, k) => g.setAlpha(this.infos[k].lit ? (k === i ? 0.6 : 0.3) : k === i ? 0.12 : 0));
    this.marker.clear();
    this.marker.lineStyle(1, paletteInt(lit ? game.accent : 'dim'), 1);
    this.marker.strokeRect(Math.round(cx - CABINET_W / 2) - 2.5, CAB_TOP - 2.5, CABINET_W + 5, CABINET_H + 5);
    this.arrowX = cx;
    this.showInfo(game, this.infos[i]);
  }

  /** Why a cabinet is dark: the practice step of the module before it. */
  private lockedHint(game: HubGame): string {
    const course = courseFor(profileStore(this).profile.instrument ?? 'guitar');
    const mod = moduleOfCabinet(course, game.id);
    const need = mod?.requires.map((r) => course.modules.find((m) => m.id === r)).find(Boolean);
    const p = need?.steps.find((s): s is PlayStep => s.kind === 'practice');
    return p ? `Se enciende con ${GAMES[p.game].title} nivel ${p.goals[0].level} (${p.goals[0].minStars} estrellas).` : 'Está apagada: se enciende al avanzar en el curso.';
  }

  private showInfo(game: HubGame, info: CabInfo): void {
    this.flash?.remove();
    this.flash = null;
    const lit = info.lit;
    placeText(this.title, 12, PANEL_Y + 5, game.title, { scale: 2, color: lit ? 'foam' : 'dim' });
    placeText(this.skill, 12, PANEL_Y + 24, game.skill, { color: lit ? game.accent : 'dim' });
    placeText(this.skillRight, W - 12, PANEL_Y + 24, !lit ? 'apagada' : info.due > 0 ? `Repasar: ${info.due} flojos` : '', { color: lit ? 'lime' : 'dim', align: 'right' });
    placeText(this.desc, 12, PANEL_Y + 34, fit(lit ? game.description : this.lockedHint(game), W - 24), { color: lit ? 'foam' : 'amber' });
    this.statsG.clear();
    this.stats.forEach((t) => placeText(t, 0, PANEL_Y + 45, '', {}));
    if (game.id === 'turbo') {
      placeText(this.stats[0], 12, PANEL_Y + 45, this.turboBest ? `Récord: ${this.turboBest.score} puntos · ${this.turboBest.rounds} rondas` : 'Todavía sin récord', { color: 'amber' });
      return;
    }
    if (game.id === 'tuner') {
      placeText(this.stats[0], 12, PANEL_Y + 45, 'Afinar y calibrar: Preparación', { color: 'dim' });
      return;
    }
    if (!lit) return;
    const learn = gameFor(game.id, 'learn');
    const practice = gameFor(game.id, 'practice');
    let x = 12;
    const block = (k: number, label: string, best: GameBest | null, withScore: boolean): void => {
      placeText(this.stats[k], x, PANEL_Y + 45, best ? `${label} ${best.level}` : `${label} -`, { color: best ? 'foam' : 'dim' });
      x += (best ? label.length + 2 : label.length + 2) * 6 + 4;
      if (best) {
        for (let s = 0; s < 3; s++) star(this.statsG, x + s * 10, PANEL_Y + 44, 1, s < best.stars ? 'amber' : 'dim', s < best.stars ? 1 : 0.5);
        x += 33;
        if (withScore && best.score !== null) {
          placeText(this.stats[k + 1], x, PANEL_Y + 45, `${best.score} pts`, { color: 'cyan' });
          x += (String(best.score).length + 4) * 6;
        }
      }
      x += 8;
    };
    if (learn) block(0, 'Aprender', this.infos[this.index].learn, false);
    if (practice) block(2, 'Practicar', this.infos[this.index].practice, true);
  }

  private async review(): Promise<void> {
    const ok = await startDailyReview(this);
    if (!ok && this.scene.isActive()) {
      placeText(this.desc, 12, PANEL_Y + 34, 'Nada que repasar hoy: lo que has tocado está fresco.', { color: 'lime' });
      this.flash?.remove();
      this.flash = this.time.delayedCall(2200, () => this.ready && this.showInfo(HUB_GAMES[this.index], this.infos[this.index]));
    }
  }

  private activate(): void {
    if (!this.ready) return;
    const game = HUB_GAMES[this.index];
    if (!this.infos[this.index].lit) {
      placeText(this.desc, 12, PANEL_Y + 34, 'Está apagada: se enciende al avanzar en el curso.', { color: 'amber' });
      this.flash?.remove();
      this.flash = this.time.delayedCall(1800, () => this.showInfo(game, this.infos[this.index]));
      this.cameras.main.shake(120, 0.004);
      return;
    }
    if (gameFor(game.id, 'learn') || gameFor(game.id, 'practice')) this.scene.start('modechoice', { id: game.id });
    else if (game.scene) this.scene.start(game.scene);
    else this.scene.start('soon', { id: game.id });
  }
}
