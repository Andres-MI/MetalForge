/**
 * Original 5x7 bitmap font, defined in code. Pure data and maths (no Phaser).
 *
 * Every glyph lives in a 5-wide, 11-row cell:
 *   rows 0-1  accent zone (accents on capitals sit here)
 *   rows 2-8  letter body: capitals are 7 rows tall, lowercase x-height is rows 4-8
 *   rows 9-10 descenders (g j p q y, comma)
 * `#` is an ink pixel, anything else is empty; rows are separated by `/` in the source tables.
 * Text is drawn with the origin at the top of the capitals (row 2).
 */

export const GLYPH_W = 5;
export const GLYPH_H = 11;
export const ADVANCE = 6;
/** Row inside the cell where capitals start. */
export const CAP_TOP = 2;

interface Glyph {
  top: number;
  rows: string[];
}

const g = (top: number, rows: string): Glyph => ({ top, rows: rows.split('/') });

const CAPS: Record<string, string> = {
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.',
  D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../#..../####./#..../#..../#####',
  F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.###.',
  H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '.###./..#../..#../..#../..#../..#../.###.',
  J: '..###/...#./...#./...#./...#./#..#./.##..',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
  L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
  N: '#...#/##..#/#.#.#/#.#.#/#..##/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
  R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.',
  T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#',
  X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..',
  Z: '#####/....#/...#./..#../.#.../#..../#####',
};

const DIGITS: Record<string, string> = {
  '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
  '1': '..#../.##../..#../..#../..#../..#../.###.',
  '2': '.###./#...#/....#/...#./..#../.#.../#####',
  '3': '####./....#/....#/.###./....#/....#/####.',
  '4': '...#./..##./.#.#./#..#./#####/...#./...#.',
  '5': '#####/#..../####./....#/....#/#...#/.###.',
  '6': '.###./#..../#..../####./#...#/#...#/.###.',
  '7': '#####/....#/...#./..#../.#.../.#.../.#...',
  '8': '.###./#...#/#...#/.###./#...#/#...#/.###.',
  '9': '.###./#...#/#...#/.####/....#/....#/.###.',
};

/** Lowercase letters with x-height only (5 rows, top = 4). */
const SMALL: Record<string, string> = {
  a: '.###./....#/.####/#...#/.####',
  c: '.###./#..../#..../#...#/.###.',
  e: '.###./#...#/#####/#..../.###.',
  m: '##.#./#.#.#/#.#.#/#...#/#...#',
  n: '####./#...#/#...#/#...#/#...#',
  o: '.###./#...#/#...#/#...#/.###.',
  r: '#.##./##..#/#..../#..../#....',
  s: '.####/#..../.###./....#/####.',
  u: '#...#/#...#/#...#/#..##/.##.#',
  v: '#...#/#...#/#...#/.#.#./..#..',
  w: '#...#/#...#/#.#.#/#.#.#/.#.#.',
  x: '#...#/.#.#./..#../.#.#./#...#',
  z: '#####/...#./..#../.#.../#####',
};

/** Lowercase letters with an ascender (7 rows, top = 2). */
const TALL: Record<string, string> = {
  b: '#..../#..../####./#...#/#...#/#...#/####.',
  d: '....#/....#/.####/#...#/#...#/#...#/.####',
  f: '..##./.#..#/.#.../###../.#.../.#.../.#...',
  h: '#..../#..../####./#...#/#...#/#...#/#...#',
  i: '..#../...../.##../..#../..#../..#../.###.',
  k: '#..../#..../#..#./#.#../##.../#.#../#..#.',
  l: '.##../..#../..#../..#../..#../..#../.###.',
  t: '.#.../.#.../###../.#.../.#.../.#..#/..##.',
};

/** Lowercase letters with a descender (7 rows, top = 4). */
const DESC: Record<string, string> = {
  g: '.####/#...#/#...#/.####/....#/#...#/.###.',
  p: '####./#...#/#...#/####./#..../#..../#....',
  q: '.####/#...#/#...#/.####/....#/....#/....#',
  y: '#...#/#...#/#...#/.####/....#/#...#/.###.',
};

const OTHER: Record<string, Glyph> = {
  ' ': g(0, '.....'),
  j: g(2, '...#./...../..##./...#./...#./...#./...#./#..#./.##..'),
  '¿': g(2, '..#../...../..#../...#./....#/#...#/.###.'),
  '¡': g(2, '..#../...../..#../..#../..#../..#../..#..'),
  '.': g(7, '.##../.##..'),
  ',': g(7, '.##../..#../.#...'),
  ':': g(4, '.##../.##../...../.##../.##..'),
  ';': g(4, '.##../.##../...../.##../..#../.#...'),
  '!': g(2, '..#../..#../..#../..#../..#../...../..#..'),
  '?': g(2, '.###./#...#/....#/...#./..#../...../..#..'),
  "'": g(2, '..#../..#../.#...'),
  '"': g(2, '.#.#./.#.#./.#.#.'),
  '-': g(5, '.###.'),
  '+': g(3, '..#../..#../#####/..#../..#..'),
  '/': g(2, '....#/....#/...#./..#../.#.../#..../#....'),
  '(': g(2, '...#./..#../.#.../.#.../.#.../..#../...#.'),
  ')': g(2, '.#.../..#../...#./...#./...#./..#../.#...'),
  '[': g(2, '.###./.#.../.#.../.#.../.#.../.#.../.###.'),
  ']': g(2, '.###./...#./...#./...#./...#./...#./.###.'),
  '%': g(2, '##..#/##.#./...#./..#../.#.../.#.##/#..##'),
  '#': g(2, '.#.#./.#.#./#####/.#.#./#####/.#.#./.#.#.'),
  '·': g(5, '..#..'),
  '=': g(4, '#####/...../#####'),
  '*': g(3, '..#../#.#.#/.###./#.#.#/..#..'),
  _: g(9, '#####'),
  '<': g(3, '...#./..#../.#.../..#../...#.'),
  '>': g(3, '.#.../..#../...#./..#../.#...'),
  '&': g(2, '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#'),
  '←': g(3, '..#../.#.../#####/.#.../..#..'),
  '→': g(3, '..#../...#./#####/...#./..#..'),
  '↑': g(3, '..#../.###./#.#.#/..#../..#..'),
  '↓': g(3, '..#../..#../#.#.#/.###./..#..'),
};

/** Dotless i, base of í. */
const DOTLESS_I = g(4, '.##../..#../..#../..#../.###.');

type Mark = readonly [string, string];
const ACUTE: Mark = ['...#.', '..#..'];
const DIAERESIS: Mark = ['.#.#.', '.....'];
const TILDE: Mark = ['.##.#', '#.##.'];

const g5 = (rows: string): Glyph => g(4, rows);

/** base glyph + mark, mark sits in rows 2-3 (lowercase) or 0-1 (capitals). */
function accented(base: Glyph, mark: Mark, capital: boolean): Glyph {
  const markTop = capital ? 0 : 2;
  const top = Math.min(base.top, markTop);
  const bottom = Math.max(base.top + base.rows.length, markTop + 2);
  const rows: string[] = [];
  for (let r = top; r < bottom; r++) {
    const fromBase = base.rows[r - base.top];
    const fromMark = mark[r - markTop];
    rows.push(fromBase ?? fromMark ?? '.....');
  }
  return { top, rows };
}

function buildGlyphs(): Record<string, Glyph> {
  const out: Record<string, Glyph> = {};
  for (const [k, v] of Object.entries(CAPS)) out[k] = g(CAP_TOP, v);
  for (const [k, v] of Object.entries(DIGITS)) out[k] = g(CAP_TOP, v);
  for (const [k, v] of Object.entries(SMALL)) out[k] = g5(v);
  for (const [k, v] of Object.entries(TALL)) out[k] = g(CAP_TOP, v);
  for (const [k, v] of Object.entries(DESC)) out[k] = g(4, v);
  Object.assign(out, OTHER);
  const lower = (c: string) => out[c];
  out['á'] = accented(lower('a'), ACUTE, false);
  out['é'] = accented(lower('e'), ACUTE, false);
  out['í'] = accented(DOTLESS_I, ACUTE, false);
  out['ó'] = accented(lower('o'), ACUTE, false);
  out['ú'] = accented(lower('u'), ACUTE, false);
  out['ü'] = accented(lower('u'), DIAERESIS, false);
  out['ñ'] = accented(lower('n'), TILDE, false);
  out['Á'] = accented(out['A'], ACUTE, true);
  out['É'] = accented(out['E'], ACUTE, true);
  out['Í'] = accented(out['I'], ACUTE, true);
  out['Ó'] = accented(out['O'], ACUTE, true);
  out['Ú'] = accented(out['U'], ACUTE, true);
  out['Ü'] = accented(out['U'], DIAERESIS, true);
  out['Ñ'] = accented(out['N'], TILDE, true);
  return out;
}

const GLYPHS = buildGlyphs();

/** Every character the game's UI text may use. */
export const FONT_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
  'áéíóúÁÉÍÓÚñÑüÜ¿¡' +
  ' .,;:!?\'"-+/()[]%#·=*_<>&←→↑↓';

/** Characters that must have a glyph (the brief): letters, digits, Spanish accents, punctuation. */
export const REQUIRED_CHARS = FONT_CHARS;

export function hasGlyph(ch: string): boolean {
  return ch in GLYPHS;
}

/** The glyph as GLYPH_H rows of GLYPH_W booleans-as-strings ('#' ink, '.' empty). */
export function glyphCell(ch: string): string[] {
  const glyph = GLYPHS[ch] ?? GLYPHS['?'];
  const cell: string[] = Array.from({ length: GLYPH_H }, () => '.'.repeat(GLYPH_W));
  glyph.rows.forEach((row, i) => {
    const y = glyph.top + i;
    if (y < 0 || y >= GLYPH_H) throw new Error(`glyph '${ch}' leaves its cell (row ${y})`);
    if (row.length !== GLYPH_W) throw new Error(`glyph '${ch}' row ${i} is ${row.length} wide`);
    cell[y] = row.replace(/[^#]/g, '.');
  });
  return cell;
}

/** Width in pixels of a one-line string at scale 1 (trailing gap excluded). */
export function measureText(text: string): number {
  return text.length === 0 ? 0 : text.length * ADVANCE - (ADVANCE - GLYPH_W);
}

/** Greedy word wrap to at most `maxChars` characters per line. */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
