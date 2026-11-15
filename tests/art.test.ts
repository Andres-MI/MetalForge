import { describe, expect, it } from 'vitest';
import { spriteStrip, spriteToPixels, validateFrame } from '../src/art/pixels';
import { CABINET_H, CABINET_W, SPRITES } from '../src/art/sprites';
import { ADVANCE, FONT_CHARS, GLYPH_H, GLYPH_W, glyphCell, hasGlyph, measureText, REQUIRED_CHARS, wrapText } from '../src/art/font';
import { PALETTE } from '../src/ui/palette';

describe('spriteToPixels', () => {
  it('maps legend keys to palette colours and leaves dots transparent', () => {
    const px = spriteToPixels(['c.', '.m'], { c: 'cyan', m: 'magenta' });
    expect([px.width, px.height]).toEqual([2, 2]);
    expect(Array.from(px.data.slice(0, 4))).toEqual([0x2e, 0xf2, 0xe2, 255]);
    expect(px.data[7]).toBe(0);
    expect(Array.from(px.data.slice(12, 16))).toEqual([0xff, 0x3f, 0xb4, 255]);
  });

  it('rejects ragged rows, unknown characters and non-palette keys', () => {
    expect(() => validateFrame('t', ['cc', 'c'], { c: 'cyan' })).toThrow(/row 1/);
    expect(() => validateFrame('t', ['z'], { c: 'cyan' })).toThrow(/legend/);
    expect(() => validateFrame('t', ['c'], { c: '#ff0000' as never })).toThrow(/palette key/);
  });

  it('lays animation frames side by side', () => {
    const strip = spriteStrip({ frames: [['c'], ['m']], legend: { c: 'cyan', m: 'magenta' } });
    expect([strip.width, strip.height]).toEqual([2, 1]);
    expect(Array.from(strip.data.slice(0, 3))).toEqual([0x2e, 0xf2, 0xe2]);
    expect(Array.from(strip.data.slice(4, 7))).toEqual([0xff, 0x3f, 0xb4]);
  });

  it('applies a legend override', () => {
    const strip = spriteStrip({ frames: [['a']], legend: { a: 'cyan' } }, { a: 'lime' });
    expect(Array.from(strip.data.slice(0, 3))).toEqual([0xc8, 0xff, 0x3d]);
  });
});

describe('game sprites', () => {
  for (const [name, def] of Object.entries(SPRITES)) {
    it(`${name} is valid and uses only palette colours`, () => {
      const strip = spriteStrip(def, {}, name);
      const colours = new Set(Object.values(PALETTE).map((h) => h.toLowerCase()));
      for (let i = 0; i < strip.data.length; i += 4) {
        if (strip.data[i + 3] === 0) continue;
        const hex = '#' + [0, 1, 2].map((k) => strip.data[i + k].toString(16).padStart(2, '0')).join('');
        expect(colours.has(hex)).toBe(true);
      }
    });
  }

  it('uses the agreed sizes', () => {
    expect([SPRITES.cabinet.frames[0][0].length, SPRITES.cabinet.frames[0].length]).toEqual([CABINET_W, CABINET_H]);
    for (const n of ['hero', 'jelly']) for (const f of SPRITES[n].frames) expect([f[0].length, f.length]).toEqual([16, 16]);
    for (const n of ['bubble', 'firefly', 'lock']) for (const f of SPRITES[n].frames) expect([f[0].length, f.length]).toEqual([8, 8]);
  });
});

describe('bitmap font', () => {
  it('has a glyph for every required character', () => {
    const required = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789áéíóúÁÉÍÓÚñÑüÜ¿¡.,;:!?\'"-+/()%# ';
    for (const ch of required) expect(hasGlyph(ch), `missing '${ch}'`).toBe(true);
    for (const ch of REQUIRED_CHARS) expect(hasGlyph(ch), `missing '${ch}'`).toBe(true);
  });

  it('keeps every glyph inside its cell and draws something for every visible char', () => {
    for (const ch of FONT_CHARS) {
      const cell = glyphCell(ch);
      expect(cell).toHaveLength(GLYPH_H);
      for (const row of cell) expect(row).toHaveLength(GLYPH_W);
      if (ch !== ' ') expect(cell.join('').includes('#'), `'${ch}' is blank`).toBe(true);
    }
  });

  it('draws accented letters differently from their bases', () => {
    for (const [a, b] of [['a', 'á'], ['n', 'ñ'], ['u', 'ü'], ['E', 'É'], ['i', 'í']]) {
      expect(glyphCell(a)).not.toEqual(glyphCell(b));
    }
  });

  it('measures and wraps text', () => {
    expect(measureText('')).toBe(0);
    expect(measureText('AB')).toBe(ADVANCE + GLYPH_W);
    expect(wrapText('uno dos tres cuatro', 8)).toEqual(['uno dos', 'tres', 'cuatro']);
  });
});
