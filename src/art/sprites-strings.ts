/**
 * Sprites of Telar and Portero (the "strings" skill). Original designs: a little weaver spider for Telar; for
 * Portero an octopus goalkeeper (stands with its arms out, dives with them stretched) and a crab shooter.
 * Characters 16x16, objects 8x8. Merged into SPRITES at the end of sprites.ts.
 */
import type { SpriteDef } from './pixels';

const KEEPER_LEGEND = { k: 'abyss', v: 'violet', f: 'foam', m: 'magenta' } as const;
const CRAB_LEGEND = { k: 'abyss', m: 'magenta', f: 'foam', a: 'amber' } as const;

const CRAB_BODY = [
  '..kmmmmmmmmmmk..',
  '..kmmfkmmfkmmk..',
  '..kmmmmmmmmmmk..',
  '..kmmmmmmmmmmk..',
  '...kkmmmmmmkk...',
];

export const STRINGS_SPRITES: Record<string, SpriteDef> = {
  'keeper-stand': {
    frames: [
      [
        '................',
        '.....kkkkkk.....',
        '....kvvvvvvk....',
        '...kvvvvvvvvk...',
        '...kvfkvvfkvk...',
        '...kvvvvvvvvk...',
        '....kvvmmvvk....',
        '..kkkvvvvvvkkk..',
        '.kvvkvvvvvvkvvk.',
        'kvvk.kvvvvk.kvvk',
        'kvk..kvvvvk..kvk',
        'kk...kvkkvk...kk',
        '....kvk..kvk....',
        '...kvk....kvk...',
        '...kk......kk...',
        '................',
      ],
    ],
    legend: KEEPER_LEGEND,
  },
  // Facing right, arms stretched to the right; the scene flips it for a dive to the left.
  'keeper-dive': {
    frames: [
      [
        '................',
        '................',
        '................',
        '................',
        '..kkkkk.........',
        '.kvvvvvkkkkkkk..',
        'kvfkvvvvvvvvvvk.',
        'kvvvvvvkkkkkkkk.',
        'kvvmvvvk........',
        '.kvvvvvkkkkkkk..',
        '..kvvvvvvvvvvk..',
        '...kkkkkkkkkkk..',
        '................',
        '................',
        '................',
        '................',
      ],
    ],
    legend: KEEPER_LEGEND,
  },
  'shooter-aim': {
    frames: [
      [
        '.kk..........kk.',
        'kmmk........kmmk',
        'kmmk........kmmk',
        '.kmk........kmk.',
        '..kmk......kmk..',
        '...kmkkkkkkmk...',
        '...kmmmmmmmmk...',
        ...CRAB_BODY.slice(1, 5),
        '..k.kkkkkkkk.k..',
        '.k.k.k....k.k.k.',
        'k..k........k..k',
        '................',
        '................',
      ],
    ],
    legend: CRAB_LEGEND,
  },
  'shooter-kick': {
    frames: [
      [
        '.kk..........kk.',
        'kmmk........kmmk',
        'kmmk........kmmk',
        '.kmk........kmk.',
        '..kmk......kmk..',
        '...kmkkkkkkmk...',
        '...kmmmmmmmmk...',
        ...CRAB_BODY.slice(1, 5),
        '..k.kkkkkkkk.k..',
        '.k.k.k....kkkkkk',
        'k..k........kaak',
        '................',
        '................',
      ],
    ],
    legend: CRAB_LEGEND,
  },
  ball: {
    frames: [['..kkkk..', '.kffffk.', 'kfffcffk', 'kffcfffk', 'kfffffck', 'kfcfffck', '.kffffk.', '..kkkk..']],
    legend: { k: 'abyss', f: 'foam', c: 'cyan' },
  },
  weaver: {
    frames: [
      ['k......k', '.k.kk.k.', '..kmmk..', 'kkmffmkk', '..kmmk..', '.k.kk.k.', 'k......k', '........'],
      ['.k....k.', 'k..kk..k', '..kmmk..', 'kkmffmkk', '..kmmk..', 'k..kk..k', '.k....k.', '........'],
    ],
    legend: { k: 'abyss', m: 'magenta', f: 'foam' },
    fps: 3,
  },
};
