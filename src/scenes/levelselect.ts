import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { measureText } from '../art/font';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { generate, levelLabel, MAX_LEVEL } from '../exercises';
import { launchGame } from '../game/launch';
import { GAMES } from '../game/registry';
import { panel } from '../game/ui';
import { paletteInt } from '../ui/palette';

const BOX = 26;
const GAP = 4;
const BOX_Y = 40;

/** Level selector (1..10) shared by every game: shows what the level adds and a preview of its first bar. */
export class LevelSelectScene extends Phaser.Scene {
  private level = 1;
  private gameId = 'pulso';
  private busy = false;
  private frames!: Phaser.GameObjects.Graphics;
  private preview!: Phaser.GameObjects.Graphics;
  private label!: Phaser.GameObjects.BitmapText;
  private info!: Phaser.GameObjects.BitmapText;
  private status!: Phaser.GameObjects.BitmapText;
  private metro!: Phaser.GameObjects.BitmapText;

  constructor() {
    super('levelselect');
  }

  create(data: { gameId?: string; level?: number }): void {
    enterScene(this, 'levelselect');
    addBackground(this);
    this.gameId = data.gameId ?? 'pulso';
    this.level = data.level ?? 1;
    this.busy = false;
    const def = GAMES[this.gameId];
    const store = profileStore(this);

    drawText(this, W / 2, 8, def.title.toUpperCase(), { scale: 2, color: def.accent, align: 'center' });
    drawText(this, W / 2, 26, def.mode === 'learn' ? 'Aprender: elige el nivel' : 'Practicar: elige el nivel', { color: 'dim', align: 'center' });

    this.frames = this.add.graphics();
    const x0 = Math.round((W - (MAX_LEVEL * BOX + (MAX_LEVEL - 1) * GAP)) / 2);
    for (let l = 1; l <= MAX_LEVEL; l++) {
      const x = x0 + (l - 1) * (BOX + GAP);
      drawText(this, x + BOX / 2, BOX_Y + 6, String(l), { scale: 2, color: 'foam', align: 'center' });
      const zone = this.add.zone(x, BOX_Y, BOX, BOX).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.pick(l));
      zone.on('pointerdown', () => {
        this.pick(l);
        void this.start();
      });
    }
    // Fix the "10" label: scale 1 centred reads fine but sits a little higher.
    this.label = drawText(this, W / 2, 76, '', { scale: 2, color: 'foam', align: 'center' });
    this.preview = this.add.graphics();
    this.info = drawText(this, W / 2, 128, '', { color: 'foam', align: 'center' });
    this.status = drawText(this, W / 2, 142, '', { color: 'lime', align: 'center' });
    this.metro = drawText(this, W / 2, H - 10, '', { color: 'dim', align: 'center' });
    const showMetro = () => placeText(this.metro, W / 2, H - 10, `←→ nivel  Enter empezar  M metrónomo: ${(store.profile.settings.metronomeOn ?? true) ? 'sí' : 'no'}  Esc volver`, { color: 'dim', align: 'center' });
    showMetro();

    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.pick(Math.max(1, this.level - 1)));
    kb.on('keydown-RIGHT', () => this.pick(Math.min(MAX_LEVEL, this.level + 1)));
    kb.on('keydown-UP', () => this.pick(Math.min(MAX_LEVEL, this.level + 1)));
    kb.on('keydown-DOWN', () => this.pick(Math.max(1, this.level - 1)));
    kb.on('keydown-ENTER', () => void this.start());
    kb.on('keydown-SPACE', () => void this.start());
    kb.on('keydown-M', () => {
      void store.setSettings({ metronomeOn: !(store.profile.settings.metronomeOn ?? true) }).then(showMetro);
    });
    kb.on('keydown-ESC', () => this.scene.start('modechoice', { id: def.cabinet }));
    this.pick(this.level);
  }

  private pick(l: number): void {
    this.level = l;
    hooks.selected = String(l);
    const def = GAMES[this.gameId];
    const x0 = Math.round((W - (MAX_LEVEL * BOX + (MAX_LEVEL - 1) * GAP)) / 2);
    this.frames.clear();
    for (let k = 1; k <= MAX_LEVEL; k++) panel(this.frames, x0 + (k - 1) * (BOX + GAP), BOX_Y, BOX, BOX, k === l ? def.accent : 'dim', 'deep', k === l ? 0.95 : 0.6);
    this.frames.lineStyle(1, paletteInt(def.accent), 0.5).strokeRect(x0 + (l - 1) * (BOX + GAP) - 1.5, BOX_Y - 1.5, BOX + 3, BOX + 3);
    const text = levelLabel(def.skill, l);
    const scale = measureText(text) * 2 <= W - 16 ? 2 : 1;
    placeText(this.label, W / 2, scale === 2 ? 76 : 80, text, { scale, color: def.accent, align: 'center' });

    // Preview: the first bar of this level as notes on a lane.
    const ex = generate(def.skill, { instrument: profileStore(this).profile.instrument ?? 'guitar', level: l, seed: 1, length: 4 });
    const g = this.preview;
    g.clear();
    const px = 40;
    const pw = W - 80;
    const py = 108;
    panel(g, px - 6, py - 10, pw + 12, 20, 'water', 'deep', 0.8);
    for (let b = 0; b <= 4; b++) g.fillStyle(paletteInt(b % 4 === 0 ? 'dim' : 'water'), 1).fillRect(px + Math.round((b / 4) * pw), py - 7, 1, 14);
    ex.targets.forEach((t) => {
      const x = px + Math.round((ex.timed ? (t.beat ?? 0) / 4 : (ex.targets.indexOf(t) + 0.5) / ex.targets.length) * pw);
      g.fillStyle(paletteInt(def.accent), 1).fillRect(x - 2, py - 2, 5, 5);
    });
    placeText(this.info, W / 2, 128, ex.timed ? `Tempo ${ex.bpm} BPM   ·   1 compás de ejemplo` : `Sin reloj   ·   ${ex.targets.length} notas de ejemplo`, { color: 'foam', align: 'center' });
    placeText(this.status, W / 2, 142, '', { color: 'lime', align: 'center' });
  }

  private async start(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    placeText(this.status, W / 2, 142, 'Abriendo la entrada de audio', { color: 'lime', align: 'center' });
    const err = await launchGame(this, { gameId: this.gameId, level: this.level });
    if (err && this.scene.isActive()) {
      this.busy = false;
      placeText(this.status, W / 2, 142, err, { color: 'magenta', align: 'center' });
    }
  }
}
