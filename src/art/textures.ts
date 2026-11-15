/** Turns the sprite and font data into Phaser textures and animations. Called once, from the boot scene. */
import Phaser from 'phaser';
import { spriteStrip, type Legend, type SpriteDef } from './pixels';
import { SPRITES } from './sprites';
import { ADVANCE, FONT_CHARS, GLYPH_H, GLYPH_W, glyphCell } from './font';
import type { PaletteKey } from '../ui/palette';

export const FONT_KEY = 'mf';
/** Accent colours cabinets and icons are generated in. */
export const ACCENTS: PaletteKey[] = ['cyan', 'magenta', 'violet', 'lime', 'amber', 'blue'];

export function cabinetKey(accent: PaletteKey | 'locked'): string {
  return `cab:${accent}`;
}
export function iconKey(icon: string, accent: PaletteKey): string {
  return `${icon}:${accent}`;
}

function addSprite(game: Phaser.Game, key: string, def: SpriteDef, override: Legend = {}): void {
  const strip = spriteStrip(def, override, key);
  const tex = game.textures.createCanvas(key, strip.width, strip.height);
  if (!tex) return;
  tex.context.putImageData(new ImageData(strip.data as unknown as Uint8ClampedArray<ArrayBuffer>, strip.width, strip.height), 0, 0);
  tex.refresh();
  const n = def.frames.length;
  if (n > 1) {
    const fw = strip.width / n;
    for (let i = 0; i < n; i++) tex.add(`f${i}`, 0, i * fw, 0, fw, strip.height);
    game.anims.create({
      key,
      frames: Array.from({ length: n }, (_, i) => ({ key, frame: `f${i}` })),
      frameRate: def.fps ?? 4,
      repeat: -1,
    });
  }
}

function addFont(game: Phaser.Game, scene: Phaser.Scene): void {
  const chars = [...FONT_CHARS];
  const perRow = 16;
  const cw = ADVANCE;
  const rows = Math.ceil(chars.length / perRow);
  const tex = game.textures.createCanvas('font', cw * perRow, GLYPH_H * rows);
  if (!tex) return;
  const img = tex.context.createImageData(cw * perRow, GLYPH_H * rows);
  chars.forEach((ch, i) => {
    const ox = (i % perRow) * cw;
    const oy = Math.floor(i / perRow) * GLYPH_H;
    glyphCell(ch).forEach((row, y) => {
      for (let x = 0; x < GLYPH_W; x++) {
        if (row[x] !== '#') continue;
        const p = ((oy + y) * img.width + ox + x) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = img.data[p + 3] = 255;
      }
    });
  });
  tex.context.putImageData(img, 0, 0);
  tex.refresh();
  const entry = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: 'font',
    width: cw,
    height: GLYPH_H,
    chars: chars.join(''),
    charsPerRow: perRow,
    'offset.x': 0,
    'offset.y': 0,
    'spacing.x': 0,
    'spacing.y': 0,
    lineSpacing: 0,
  });
  game.cache.bitmapFont.add(FONT_KEY, entry);
}

/** One 1x1 white pixel, handy for particles and rectangles that need a texture. */
function addPixel(game: Phaser.Game): void {
  const tex = game.textures.createCanvas('px', 1, 1);
  if (!tex) return;
  tex.context.fillStyle = '#ffffff';
  tex.context.fillRect(0, 0, 1, 1);
  tex.refresh();
}

export function registerArt(scene: Phaser.Scene): void {
  const game = scene.game;
  addPixel(game);
  addFont(game, scene);
  for (const [name, def] of Object.entries(SPRITES)) {
    if (name === 'cabinet' || name.startsWith('icon-')) continue;
    addSprite(game, name, def);
  }
  for (const accent of ACCENTS) {
    addSprite(game, cabinetKey(accent), SPRITES.cabinet, { a: accent });
    for (const name of Object.keys(SPRITES).filter((n) => n.startsWith('icon-'))) {
      addSprite(game, iconKey(name, accent), SPRITES[name], { x: accent });
    }
  }
  addSprite(game, cabinetKey('locked'), SPRITES.cabinet, { a: 'water', d: 'abyss', w: 'deep', f: 'dim' });
}
