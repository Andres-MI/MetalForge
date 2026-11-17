/**
 * Sprites of Forja and Hechicero (skill "chords"). Same rules as sprites.ts: characters map to palette KEY NAMES.
 * Original designs: a round-hatted wizard with an orb staff, a flame wisp (drawn in foam so the scene can tint it with the
 * colour of its rune), a horned boss wisp, and a smith's hammer and anvil. Runes are drawn by code from `game/chords/rune.ts`.
 */
import type { SpriteDef } from './pixels';

const WIZARD_LEGEND = { o: 'abyss', v: 'violet', m: 'magenta', f: 'foam', a: 'amber', d: 'dim', c: 'cyan' } as const;

const wizard = (orb: string, spark: boolean): string[] => [
  '.......oo.......',
  '......ovvo......',
  `.....ovvvvo..${orb}${orb}.`,
  `....ovvvvvvo.${orb}${orb}${orb}`,
  `...ommmmmmmmo.${orb}.`,
  '....offffffod...',
  '....ofoffofod...',
  '...offffffffod..',
  '..ovvvvvffvvvvod',
  '..ovvvvfffvvvvod',
  '..ovvvvvffvvvvod',
  '..ovvvvvvvvvvvod',
  '..ovvvvvvvvvvvod',
  '.ovvvvvvvvvvvvod',
  '.ommmmmmmmmmmmod',
  spark ? '..oooooooooooood' : '..oooooooooooooood'.slice(0, 16),
];

const WISP_A = [
  '.......f........',
  '......ff.f......',
  '.....ffffff.....',
  '....ffffffff....',
  '...ffffffffff...',
  '...ffooffooff...',
  '...ffooffooff...',
  '...ffffffffff...',
  '...fffoooofff...',
  '...ffffffffff...',
  '..dffffffffffd..',
  '...ddffffffdd...',
  '...d.ffffff.d...',
  '....d.ffff.d....',
  '.....d.ff.d.....',
  '......d..d......',
];

const WISP_B = [
  '........f.......',
  '.....f.ff.......',
  '.....ffffff.....',
  '....ffffffff....',
  '...ffffffffff...',
  '...ffooffooff...',
  '...ffooffooff...',
  '...ffffffffff...',
  '...fffoooofff...',
  '...ffffffffff...',
  '..dffffffffffd..',
  '...ddffffffdd...',
  '...d.ffffff.d...',
  '.....d.ff.d.....',
  '......d..d......',
  '.......dd.......',
];

export const CHORDS_SPRITES: Record<string, SpriteDef> = {
  'wizard-idle': { frames: [wizard('a', false), wizard('f', true)], legend: WIZARD_LEGEND, fps: 3 },
  'wizard-cast': {
    frames: [
      [
        '.......oo.......',
        '......ovvo......',
        '.....ovvvvo.f.f.',
        '....ovvvvvvo.fff',
        '...ommmmmmmmo.f.',
        '....offffffod...',
        '....offoffofod..',
        '...offffffffod..',
        '..ovvvvvffvvvvod',
        '..ovvvvfffvvvvod',
        '..ovvvvvffvvvvod',
        '..ovvvvvvvvvvvod',
        '..ovvvvvvvvvvvod',
        '.ovvvvvvvvvvvvod',
        '.ommmmmmmmmmmmod',
        '..ooooooooooooood',
      ].map((r) => r.slice(0, 16)),
    ],
    legend: WIZARD_LEGEND,
  },
  wisp: { frames: [WISP_A, WISP_B], legend: { f: 'foam', o: 'abyss', d: 'dim' }, fps: 4 },
  'wisp-boss': {
    frames: [
      [
        '.d..........d...',
        '.dd........dd...',
        '..dd..ff..dd....',
        '..dfffffffffd...',
        '...ffffffffff...',
        '..ffooffffoofff.',
        '..ffooffffoofff.',
        '..ffffffffffff..',
        '..ffffoooofffff.',
        '..ffffffffffff..',
        '..dfffffffffffd.',
        '...ddffffffffdd.',
        '...d.ffffffff.d.',
        '....d.ffffff.d..',
        '.....d.ffff.d...',
        '......d.dd.d....',
      ],
    ],
    legend: { f: 'foam', o: 'abyss', d: 'dim' },
  },
  hammer: {
    frames: [
      [
        '.oooooooo...',
        'offfffffdo..',
        'offfffffdo..',
        'offfffffdo..',
        '.oooooooo...',
        '....oaao....',
        '....oaao....',
        '....oaao....',
        '....oaao....',
        '....oaao....',
        '....oaao....',
        '....oooo....',
      ],
    ],
    legend: { o: 'abyss', f: 'foam', d: 'dim', a: 'amber' },
  },
  anvil: {
    frames: [
      [
        '.oooooooooooooooooooooo.',
        'offffffffffffffffffffffo',
        'oddddddddddddddddddddddo',
        '.ooooddddddddddddooooo..',
        '....odddddddddddddo.....',
        '.....odddddddddddo......',
        '....oddddddddddddddo....',
        '...odddddddddddddddddo..',
        '...ooooooooooooooooooo..',
      ],
    ],
    legend: { o: 'abyss', f: 'foam', d: 'dim' },
  },
};
