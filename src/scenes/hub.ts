import Phaser from 'phaser';
import { CABINET_H, CABINET_SCREEN, CABINET_W } from '../art/sprites';
import { cabinetKey, iconKey } from '../art/textures';
import { drawText, placeText } from '../art/text';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { paletteInt } from '../ui/palette';
import { gameFor } from '../game/registry';
import { HUB_GAMES, SHORT_LABEL, type HubGame } from './hubData';

const PITCH = 42;
const CAB_TOP = 50;
const FLOOR_Y = CAB_TOP + CABINET_H;
const PANEL_Y = 132;

const cabX = (i: number) => W / 2 + (i - (HUB_GAMES.length - 1) / 2) * PITCH;

/** The arcade hall: a dark room lit like an aquarium, one cabinet per game. */
export class HubScene extends Phaser.Scene {
  private index = 0;
  private hero!: Phaser.GameObjects.Sprite;
  private marker!: Phaser.GameObjects.Graphics;
  private arrow!: Phaser.GameObjects.BitmapText;
  private title!: Phaser.GameObjects.BitmapText;
  private skill!: Phaser.GameObjects.BitmapText;
  private desc!: Phaser.GameObjects.BitmapText;
  private screens: Phaser.GameObjects.Rectangle[] = [];
  private glows: Phaser.GameObjects.Image[] = [];
  private arrowX = 0;
  private flash: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super('hub');
  }

  create(): void {
    enterScene(this, 'hub');
    const store = profileStore(this);
    const bg = addBackground(this);
    this.screens = [];
    this.glows = [];
    this.flash = null;

    this.drawRoom();
    drawText(this, W / 2 + 1, 9, 'METALFORGE', { scale: 2, color: 'violet', align: 'center' });
    drawText(this, W / 2, 8, 'METALFORGE', { scale: 2, color: 'magenta', align: 'center' });
    drawText(this, W / 2, 27, 'SALÓN RECREATIVO', { color: 'cyan', align: 'center' });
    const inst = store.profile.instrument;
    if (inst) drawText(this, 8, 8, SHORT_LABEL[inst], { color: 'cyan' });
    const fx = drawText(this, W - 8, 8, '', { color: 'foam', align: 'right' });
    const showFx = () => placeText(fx, W - 8, 8, `Fondo: ${bg.isEnabled ? 'sí' : 'no'}`, { color: 'foam', align: 'right' });
    showFx();

    HUB_GAMES.forEach((game, i) => this.addCabinet(game, i));

    this.hero = this.add.sprite(cabX(this.index), FLOOR_Y + 5, 'hero').setOrigin(0.5, 0).setDepth(5);
    this.hero.play('hero');
    this.marker = this.add.graphics().setDepth(6);
    this.arrow = drawText(this, 0, 0, '↓', { color: 'lime', align: 'center', depth: 6 });

    this.add.graphics().setDepth(7).fillStyle(paletteInt('abyss'), 0.88).fillRect(4, PANEL_Y, W - 8, H - PANEL_Y - 4).lineStyle(1, paletteInt('dim'), 1).strokeRect(4.5, PANEL_Y + 0.5, W - 9, H - PANEL_Y - 5);
    this.title = drawText(this, 12, PANEL_Y + 6, '', { scale: 2, depth: 8 });
    this.skill = drawText(this, 12, PANEL_Y + 25, '', { color: 'dim', depth: 8 });
    this.desc = drawText(this, 12, PANEL_Y + 35, '', { color: 'foam', depth: 8 });
    this.add.rectangle(0, PANEL_Y - 14, W, 12, paletteInt('abyss'), 0.7).setOrigin(0, 0).setDepth(7);
    drawText(this, W / 2, PANEL_Y - 10, '←→ elegir  Enter  I instr.  B fondo  C calibrar', { color: 'dim', align: 'center', depth: 8 });

    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.select((this.index + HUB_GAMES.length - 1) % HUB_GAMES.length));
    kb.on('keydown-RIGHT', () => this.select((this.index + 1) % HUB_GAMES.length));
    kb.on('keydown-ENTER', () => this.activate());
    kb.on('keydown-SPACE', () => this.activate());
    kb.on('keydown-I', () => this.scene.start('picker'));
    kb.on('keydown-C', () => this.scene.start('calibration', {}));
    kb.on('keydown-B', () => {
      bg.setEnabled(!bg.isEnabled);
      hooks.backgroundEffects = bg.isEnabled;
      showFx();
      void store.setSettings({ backgroundEffects: bg.isEnabled });
    });

    this.select(this.index, true);
  }

  update(time: number): void {
    // Screens flicker softly; the lit ones breathe, the dark ones stay dead.
    this.screens.forEach((s, i) => {
      s.setAlpha(0.1 + 0.12 * (0.5 + 0.5 * Math.sin(time / 380 + i * 1.7)));
    });
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
    const lit = game.unlocked;
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
    const zone = this.add.zone(left, CAB_TOP, CABINET_W, CABINET_H).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => this.select(i));
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
    this.glows.forEach((g, k) => g.setAlpha(HUB_GAMES[k].unlocked ? (k === i ? 0.6 : 0.3) : k === i ? 0.12 : 0));
    this.marker.clear();
    this.marker.lineStyle(1, paletteInt(game.unlocked ? game.accent : 'dim'), 1);
    this.marker.strokeRect(Math.round(cx - CABINET_W / 2) - 2.5, CAB_TOP - 2.5, CABINET_W + 5, CABINET_H + 5);
    this.arrowX = cx;
    this.showInfo(game);
  }

  private showInfo(game: HubGame): void {
    this.flash?.remove();
    this.flash = null;
    placeText(this.title, 12, PANEL_Y + 6, game.title, { scale: 2, color: game.unlocked ? 'foam' : 'dim' });
    placeText(this.skill, 12, PANEL_Y + 25, game.unlocked ? `Habilidad: ${game.skill}` : `Habilidad: ${game.skill}  (apagada)`, { color: game.unlocked ? game.accent : 'dim' });
    placeText(this.desc, 12, PANEL_Y + 35, game.description, { color: game.unlocked ? 'foam' : 'dim' });
  }

  private activate(): void {
    const game = HUB_GAMES[this.index];
    if (!game.unlocked) {
      placeText(this.desc, 12, PANEL_Y + 35, 'Está apagada: se enciende al avanzar en el curso.', { color: 'amber' });
      this.flash?.remove();
      this.flash = this.time.delayedCall(1800, () => placeText(this.desc, 12, PANEL_Y + 35, game.description, { color: 'dim' }));
      this.cameras.main.shake(120, 0.004);
      return;
    }
    if (gameFor(game.id, 'learn') || gameFor(game.id, 'practice')) this.scene.start('modechoice', { id: game.id });
    else if (game.scene) this.scene.start(game.scene);
    else this.scene.start('soon', { id: game.id });
  }
}
