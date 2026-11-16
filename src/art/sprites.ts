/**
 * All sprites, as character grids. Characters map to palette KEY NAMES through each legend; '.' is transparent.
 * Sizes: characters 16x16, objects and icons 8x8, arcade cabinets 24x40 (scenery).
 * Original designs, replaceable one by one: only the name and the size are a contract.
 */
import type { Frame, SpriteDef } from './pixels';
import { FRETS_SPRITES } from './sprites-frets';

const repeat = (row: string, n: number): string[] => Array.from({ length: n }, () => row);

export const CABINET_W = 24;
export const CABINET_H = 40;
/** Where the 16x16 screen starts inside the cabinet sprite. */
export const CABINET_SCREEN = { x: 4, y: 7, w: 16, h: 16 } as const;

const CABINET: Frame = [
  '..kkkkkkkkkkkkkkkkkkkk..',
  '.kaaaaaaaaaaaaaaaaaaaak.',
  '.kaaaaaaaaaaaaaaaaaaaak.',
  '.kaaaaaaaaaaaaaaaaaaaak.',
  '.kddddddddddddddddddddk.',
  'kkwwwwwwwwwwwwwwwwwwwwkk',
  'kwwkkkkkkkkkkkkkkkkkkwwk',
  ...repeat('kwwkddddddddddddddddkwwk', 16),
  'kwwkkkkkkkkkkkkkkkkkkwwk',
  'kwwwwwwwwwwwwwwwwwwwwwwk',
  'kwddddddddddddddddddddwk',
  'kwdddfdddddddaddadddddwk',
  'kwdddeddddddddddddddddwk',
  'kwddddddddddddddddddddwk',
  ...repeat('kwwwwwwwwwwwwwwwwwwwwwwk', 2),
  'kwwwwwwwwwkkkkwwwwwwwwwk',
  'kwwwwwwwwwwaawwwwwwwwwwk',
  ...repeat('kwwwwwwwwwwwwwwwwwwwwwwk', 5),
  '.kddddddddddddddddddddk.',
  '.kkkkkkkkkkkkkkkkkkkkkk.',
];

const HERO_A: Frame = [
  '................',
  '......kkkk......',
  '....kkvvvvkk....',
  '...kvvvvvvvvk...',
  '..kvvkkkkkkvvk..',
  '..kvkccfccckvk..',
  '..kvkcccccckvk..',
  '..kvvkkkkkkvvk..',
  '...kvvvvvvvvk...',
  '..mmmmmmmmmmmm..',
  '..kvvvvvvvvvvk..',
  '..kvvvvddvvvvk..',
  '...kvvvkkvvvk...',
  '...kvvk..kvvk...',
  '...kcck..kcck...',
  '...kkkk..kkkk...',
];
const HERO_B: Frame = [
  '................',
  '......kkkk......',
  '....kkvvvvkk....',
  '...kvvvvvvvvk...',
  '..kvvkkkkkkvvk..',
  '..kvkcccfcckvk..',
  '..kvkcccccckvk..',
  '..kvvkkkkkkvvk..',
  '...kvvvvvvvvk...',
  '..mmmmmmmmmmmm..',
  '..kvvvvvvvvvvk..',
  '..kvvvvddvvvvk..',
  '...kvvvkkvvvk...',
  '...kvvk..kvvk...',
  '..kcck....kcck..',
  '..kkkk....kkkk..',
];

const JELLY_A: Frame = [
  '................',
  '....kkkkkkkk....',
  '..kkmmmmmmmmkk..',
  '.kmmmmmmmmmmmmk.',
  '.kmmffmmmmmmmmk.',
  'kmmmmmmmmmmmmmmk',
  'kmmmkkmmmmkkmmmk',
  'kmmmkkmmmmkkmmmk',
  'kmmmmmmmmmmmmmmk',
  '.kkkkkkkkkkkkkk.',
  '..v..v.vv.v..v..',
  '.v..v..vv..v..v.',
  '..v..v.vv.v..v..',
  '................',
  '................',
  '................',
];
const JELLY_B: Frame = [
  ...JELLY_A.slice(0, 10),
  '..v.v..vv..v.v..',
  '...v..v..v..v...',
  '.v..v..vv..v..v.',
  '................',
  '................',
  '................',
];


// ---- Salto (arcade rhythm runner) ----
// The runner is an axolotl seen from the side, facing right: three gill fronds, round head, short legs.
// Body (rows 0..10) is shared; each pose adds its 5 rows of legs.
const AXO_BODY: Frame = [
  '................',
  '......m..m......',
  '.....mm.mm......',
  '.....mmkmmkkkk..',
  '....kkvvvvvvvvk.',
  '..kkvvvvvvvvfkvk',
  '.kvvvvvvvvvvvvvk',
  'kvvvvvvvvvvvvmvk',
  'kvvvvvvvvvvvvkk.',
  '.kkvvccccccvvk..',
  '..kkkkkkkkkkk...',
];
const EMPTY16 = '................';
const axo = (legs: string[]): Frame => [...AXO_BODY, ...legs, ...repeat(EMPTY16, 5 - legs.length)];
const AXO_RUN_A = axo(['..kvvk....kvvk..', '..kvk......kvk..', '.kvk........kvk.', '.kkk........kkk.']);
const AXO_RUN_B = axo(['...kvvk...kvvk..', '...kkkk...kkkk..']);
const AXO_RUN_C = axo(['...kvvk..kvvk...', '....kvk..kvk....', '.....kvk.kvk....', '.....kkk.kkk....']);
const AXO_JUMP = axo(['.kvvvk...kvvvk..', '.kkkk....kkkk...']);
/** Flat on the ground, eye shut, legs out, sparks over the head. */
const axoDown = (sparks: string[]): Frame => [
  ...sparks,
  ...AXO_BODY.slice(1).map((row, i) => (i === 4 ? row.replace('fk', 'kk') : row)),
  'kvvk........kvvk',
  'kkkk........kkkk',
  EMPTY16,
];
const AXO_DOWN_A = axoDown(['..f.........f...', '......f.........', EMPTY16]);
const AXO_DOWN_B = axoDown(['.....f......f...', '..f.......f.....', EMPTY16]);

const icon = (rows: string[]): Frame => rows;

export const SPRITES: Record<string, SpriteDef> = {
  ...FRETS_SPRITES,
  cabinet: {
    frames: [CABINET],
    legend: { k: 'abyss', w: 'water', d: 'deep', a: 'cyan', f: 'foam', e: 'dim' },
  },
  hero: {
    frames: [HERO_A, HERO_B],
    legend: { k: 'abyss', v: 'violet', c: 'cyan', f: 'foam', m: 'magenta', d: 'deep' },
    fps: 3,
  },
  jelly: {
    frames: [JELLY_A, JELLY_B],
    legend: { k: 'abyss', m: 'magenta', f: 'foam', v: 'violet' },
    fps: 3,
  },
  bubble: {
    frames: [['..cccc..', '.c....c.', 'c..ff..c', 'c..f...c', 'c......c', 'c......c', '.c....c.', '..cccc..']],
    legend: { c: 'cyan', f: 'foam' },
  },
  firefly: {
    frames: [
      ['........', '...ll...', '..llll..', '..lffl..', '...ll...', '........', '........', '........'],
      ['........', '........', '...ll...', '..lffl..', '...ll...', '..l..l..', '........', '........'],
    ],
    legend: { l: 'lime', f: 'foam' },
    fps: 2,
  },
  lock: {
    frames: [['..xxxx..', '.x....x.', '.x....x.', 'xxxxxxxx', 'xxxxxxxx', 'xxx..xxx', 'xxxxxxxx', 'xxxxxxxx']],
    legend: { x: 'dim' },
  },
  // Salto: runner poses, obstacles, ground and hearts.
  'runner-run': {
    frames: [AXO_RUN_A, AXO_RUN_B, AXO_RUN_C, AXO_RUN_B],
    legend: { k: 'abyss', v: 'violet', m: 'magenta', f: 'foam', c: 'cyan' },
    fps: 10,
  },
  'runner-jump': {
    frames: [AXO_JUMP],
    legend: { k: 'abyss', v: 'violet', m: 'magenta', f: 'foam', c: 'cyan' },
  },
  'runner-stumble': {
    frames: [AXO_DOWN_A, AXO_DOWN_B],
    legend: { k: 'abyss', v: 'violet', m: 'magenta', f: 'foam', c: 'cyan' },
    fps: 6,
  },
  'obst-coral': {
    frames: [['m..m..m.', 'm..m..mf', '.m.m.m..', '.m.mmm..', 'f.mmm...', '.mmmm...', '...mm...', '..vvvv..']],
    legend: { m: 'magenta', f: 'foam', v: 'violet' },
  },
  'obst-urchin': {
    frames: [['a..aa..a', '.a.aa.a.', '..aaaa..', 'aaaffaaa', 'aaaaaaaa', '..aaaa..', '.a.aa.a.', 'a..aa..a']],
    legend: { a: 'amber', f: 'foam' },
  },
  // A hole in the ground: drawn over the ground tiles (see scenes/salto.ts).
  'obst-pit': {
    frames: [['lkkkkkkl', 'lkkkkkkl', '.kkckkk.', '.kkkkkk.', '.kkkkck.', '.kkkkkk.', '.kckkkk.', '.kkkkkk.']],
    legend: { k: 'abyss', l: 'lime', c: 'cyan' },
  },
  'ground-top': {
    frames: [['dddddddd', 'wwwwwwww', 'wpwwwwpw', 'wwwwwwww', 'wwpwwwpw', 'pwwwpwww', 'pppppppp', 'pppwpppp']],
    legend: { d: 'dim', w: 'water', p: 'deep' },
  },
  'ground-fill': {
    frames: [['pppppppp', 'ppwppppp', 'pppppppp', 'pppppppp', 'pppppwpp', 'pppppppp', 'pwpppppp', 'pppppppp']],
    legend: { w: 'water', p: 'deep' },
  },
  heart: {
    frames: [['.mm..mm.', 'mmmmmmmm', 'mfmmmmmm', 'mmmmmmmm', '.mmmmmm.', '..mmmm..', '...mm...', '........']],
    legend: { m: 'magenta', f: 'foam' },
  },
  'heart-empty': {
    frames: [['.dd..dd.', 'd..dd..d', 'd......d', 'd......d', '.d....d.', '..d..d..', '...dd...', '........']],
    legend: { d: 'dim' },
  },
  // Cabinet screen icons: `x` takes the cabinet's accent colour.
  'icon-pulse': {
    frames: [icon(['...xx...', '...fx...', '..xfxx..', '..xfxx..', '.xxxfxx.', '.xxxfxx.', 'xxxxxxxx', 'xxxxxxxx'])],
    legend: { x: 'cyan', f: 'foam' },
  },
  'icon-fireflies': {
    frames: [icon(['x.....x.', '........', '...xx...', '..xffx..', '..xffx..', '...xx...', '........', '.x....x.'])],
    legend: { x: 'cyan', f: 'foam' },
  },
  'icon-loom': {
    frames: [icon(['x.x.x.x.', 'x.x.x.x.', 'ffffffff', 'x.x.x.x.', 'x.x.x.x.', 'ffffffff', 'x.x.x.x.', 'x.x.x.x.'])],
    legend: { x: 'cyan', f: 'foam' },
  },
  'icon-forge': {
    frames: [icon(['.f....f.', 'xxxxxxxx', 'xxxxxxx.', '..xxxx..', '...xx...', '...xx...', '..xxxx..', '.xxxxxx.'])],
    legend: { x: 'cyan', f: 'foam' },
  },
  'icon-climb': {
    frames: [icon(['.x....x.', '.xxxxxx.', '.x....x.', '.x....x.', '.xxxxxx.', '.x....x.', '.x....x.', '.xxxxxx.'])],
    legend: { x: 'cyan', f: 'foam' },
  },
  'icon-fork': {
    frames: [icon(['..x..x..', '..x..x..', '..x..x..', '..x..x..', '..xxxx..', '...xx...', '...xx...', '...xx...'])],
    legend: { x: 'cyan', f: 'foam' },
  },
  'icon-bolt': {
    frames: [icon(['....xxxx', '...xxxx.', '..xxxx..', '.xxxxxxx', 'xxxxxxx.', '...xxx..', '..xxx...', '..xx....'])],
    legend: { x: 'cyan', f: 'foam' },
  },
};

/** Names of every icon sprite (they get one texture per accent colour, see art/textures.ts). */
export const ICON_NAMES = Object.keys(SPRITES).filter((n) => n.startsWith('icon-'));

// Telar and Portero (strings skill).
import { STRINGS_SPRITES } from './sprites-strings';
Object.assign(SPRITES, STRINGS_SPRITES);
