/**
 * "Night aquarium" background: a dithered dark gradient, drifting specks and bubbles, slowly cycling
 * coloured glows and a gentle wobble. Everything lives on its own depth layer far behind the scene, so
 * it can never distort foreground gameplay. `energy` (0..1) makes it livelier.
 */
import Phaser from 'phaser';
import { PALETTE, paletteInt } from '../ui/palette';
import { hexToRgb } from '../art/pixels';

const W = 320;
const H = 180;
const MARGIN = 12; // extra gradient on each side so the wobble never shows an edge
const STRIP = 4;
const DEPTH = -1000;
const GRAD = 'aq:grad';
const GLOW = 'aq:glow';

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function ensureTextures(scene: Phaser.Scene): void {
  const tm = scene.textures;
  if (!tm.exists(GRAD)) {
    const gw = W + MARGIN * 2;
    const tex = tm.createCanvas(GRAD, gw, H)!;
    const img = tex.context.createImageData(gw, H);
    const levels = [PALETTE.water, PALETTE.deep, PALETTE.abyss].map(hexToRgb);
    for (let y = 0; y < H; y++) {
      // 0 at the top (a little lit from above) to 2 at the bottom (the abyss).
      const t = Math.min(2, 0.45 + Math.pow(y / H, 0.8) * 1.9);
      const lo = Math.min(1, Math.floor(t));
      const frac = t - lo;
      for (let x = 0; x < gw; x++) {
        const pick = frac * 16 > BAYER[y & 3][x & 3] ? lo + 1 : lo;
        const [r, g, b] = levels[pick];
        const p = (y * gw + x) * 4;
        img.data[p] = r;
        img.data[p + 1] = g;
        img.data[p + 2] = b;
        img.data[p + 3] = 255;
      }
    }
    tex.context.putImageData(img, 0, 0);
    tex.refresh();
    for (let i = 0; i < H / STRIP; i++) tex.add(`s${i}`, 0, 0, i * STRIP, gw, STRIP);
  }
  if (!tm.exists(GLOW)) {
    const size = 96;
    const tex = tm.createCanvas(GLOW, size, size)!;
    const c = tex.context;
    c.fillStyle = 'rgba(255,255,255,0.05)';
    for (let r = 46; r >= 10; r -= 9) {
      c.beginPath();
      c.arc(size / 2, size / 2, r, 0, Math.PI * 2);
      c.fill();
    }
    tex.refresh();
  }
}

interface Speck {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  speed: number;
  sway: number;
  phase: number;
}

export interface AquariumOptions {
  enabled: boolean;
  /** Read every frame; 0..1. */
  energy?: () => number;
}

export class AquariumBackground {
  private enabled: boolean;
  private energy = 0;
  private t = 0;
  private readonly strips: Phaser.GameObjects.Image[] = [];
  private readonly still: Phaser.GameObjects.Image;
  private readonly glows: { img: Phaser.GameObjects.Image; cx: number; cy: number; ph: number }[] = [];
  private readonly specks: Speck[] = [];
  private readonly layer: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene, private readonly opts: AquariumOptions) {
    this.enabled = opts.enabled;
    ensureTextures(scene);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.layer.push(o);
      return o;
    };
    this.still = add(scene.add.image(-MARGIN, 0, GRAD).setOrigin(0, 0).setDepth(DEPTH));
    for (let i = 0; i < H / STRIP; i++) {
      this.strips.push(add(scene.add.image(-MARGIN, i * STRIP, GRAD, `s${i}`).setOrigin(0, 0).setDepth(DEPTH)));
    }
    const glowColors = [paletteInt('cyan'), paletteInt('violet'), paletteInt('magenta')];
    glowColors.forEach((color, i) => {
      const img = add(scene.add.image(0, 0, GLOW).setTint(color).setBlendMode(Phaser.BlendModes.ADD).setScale(4, 3).setDepth(DEPTH + 1));
      this.glows.push({ img, cx: 70 + i * 90, cy: 60 + (i % 2) * 40, ph: i * 2.1 });
    });
    const colors = [paletteInt('foam'), paletteInt('cyan'), paletteInt('violet'), paletteInt('foam')];
    for (let i = 0; i < 44; i++) {
      const img = add(scene.add.image(0, 0, 'px').setTint(colors[i % colors.length]).setDepth(DEPTH + 2));
      this.specks.push({ img, x: Math.random() * W, y: Math.random() * H, speed: 3 + Math.random() * 9, sway: 1 + Math.random() * 3, phase: Math.random() * 6.28 });
    }
    for (let i = 0; i < 5; i++) {
      const img = add(scene.add.image(0, 0, 'bubble').setAlpha(0.22).setDepth(DEPTH + 2));
      this.specks.push({ img, x: Math.random() * W, y: Math.random() * H, speed: 4 + Math.random() * 5, sway: 3 + Math.random() * 3, phase: Math.random() * 6.28 });
    }
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.apply();
    this.update(0, 0);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.apply();
    this.update(0, 0);
  }

  private apply(): void {
    this.still.setVisible(!this.enabled);
    this.strips.forEach((s) => s.setVisible(this.enabled));
    this.glows.forEach((g) => g.img.setVisible(this.enabled));
    this.specks.forEach((s) => s.img.setVisible(this.enabled));
    if (!this.enabled) this.strips.forEach((s) => s.setX(-MARGIN));
  }

  private update(_time: number, delta: number): void {
    if (!this.enabled) return;
    const dt = Math.min(delta, 100) / 1000;
    this.t += dt;
    const target = Math.max(0, Math.min(1, this.opts.energy?.() ?? 0));
    this.energy += (target - this.energy) * Math.min(1, dt * 4);
    const e = this.energy;
    // Wobble: whole 4-pixel strips of the background slide sideways. Foreground is untouched.
    const amp = 0.7 + e * 4.5;
    for (let i = 0; i < this.strips.length; i++) {
      this.strips[i].setX(-MARGIN + Math.round(Math.sin(this.t * (0.9 + e * 1.5) + i * 0.4) * amp));
    }
    // Colour cycling: three coloured lights fade in and out of phase, so the tide of colour drifts.
    for (const g of this.glows) {
      const s = Math.sin(this.t * 0.35 + g.ph);
      g.img.setAlpha(0.1 + 0.4 * (0.5 + 0.5 * s) + e * 0.35);
      g.img.setPosition(g.cx + Math.sin(this.t * 0.18 + g.ph) * 30, g.cy + Math.cos(this.t * 0.14 + g.ph) * 14);
    }
    for (const p of this.specks) {
      p.y -= p.speed * (1 + e * 2.5) * dt;
      if (p.y < -8) {
        p.y = H + 8;
        p.x = Math.random() * W;
      }
      p.img.setPosition(Math.round(p.x + Math.sin(this.t * 0.6 + p.phase) * p.sway), Math.round(p.y));
      if (p.img.texture.key === 'px') p.img.setAlpha(0.18 + 0.32 * (0.5 + 0.5 * Math.sin(this.t * 1.3 + p.phase)));
    }
  }

  private destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    this.layer.forEach((o) => o.destroy());
    this.layer.length = 0;
  }
}
