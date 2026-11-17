import Phaser from 'phaser';
import { drawText } from '../art/text';
import { load, setModuleManual } from '../course/service';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { panel } from '../game/ui';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { SHORT_LABEL } from './hubData';
import { clearFlow } from './courseNav';

type Mode = 'main' | 'unlock' | 'confirm';

interface Row {
  id: string;
  label: string;
  value?: string;
  color?: PaletteKey;
  act: () => unknown;
}

const ROW_Y = 28;
const ROW_H = 16;

/** Settings: background, metronome, instrument, calibration, placement test, manual module unlock and reset. */
export class SettingsScene extends Phaser.Scene {
  private index = 0;
  private mode: Mode = 'main';
  private rows: Row[] = [];
  private frame!: Phaser.GameObjects.Graphics;
  private note!: Phaser.GameObjects.BitmapText;

  constructor() {
    super('settings');
  }

  create(data: { mode?: Mode; index?: number }): void {
    enterScene(this, 'settings');
    addBackground(this);
    this.mode = data.mode ?? 'main';
    this.index = data.index ?? 0;
    void this.build();
  }

  private async build(): Promise<void> {
    const store = profileStore(this);
    const l = await load(store);
    if (!this.scene.isActive()) return;
    const s = store.profile.settings;
    const title = this.mode === 'unlock' ? 'DESBLOQUEAR MÓDULOS' : this.mode === 'confirm' ? 'BORRAR PROGRESO' : 'AJUSTES';
    drawText(this, W / 2, 8, title, { scale: 2, color: 'magenta', align: 'center' });
    const again = (index = this.index) => this.scene.restart({ mode: this.mode, index });
    const go = (mode: Mode, index = 0) => this.scene.restart({ mode, index });

    if (this.mode === 'main') {
      this.rows = [
        { id: 'bg', label: 'Fondo animado', value: s.backgroundEffects ? 'sí' : 'no', act: async () => { await store.setSettings({ backgroundEffects: !s.backgroundEffects }); again(); } },
        { id: 'metro', label: 'Metrónomo en los juegos', value: (s.metronomeOn ?? true) ? 'sí' : 'no', act: async () => { await store.setSettings({ metronomeOn: !(s.metronomeOn ?? true) }); again(); } },
        { id: 'instrument', label: 'Instrumento', value: SHORT_LABEL[l.instrument], act: () => this.scene.start('picker') },
        { id: 'calibrate', label: 'Calibrar la latencia', value: s.latencyOffset === undefined ? 'sin hacer' : `${Math.round(s.latencyOffset * 1000)} ms`, act: () => this.scene.start('calibration', { then: { scene: 'settings' } }) },
        { id: 'placement', label: 'Repetir el sondeo de nivel', act: () => this.scene.start('placement', { stage: 'intro', retake: true }) },
        { id: 'unlock', label: 'Desbloquear módulos a mano', value: `${l.state.unlocked.length}/${l.state.modules.length} abiertos`, act: () => go('unlock') },
        { id: 'reset', label: 'Borrar el progreso', value: SHORT_LABEL[l.instrument], color: 'magenta', act: () => go('confirm') },
      ];
    } else if (this.mode === 'unlock') {
      this.rows = l.state.modules
        .filter((m) => m.module.skill !== null)
        .map((m) => ({
          id: m.module.id,
          label: m.module.title,
          value: m.unlocked ? (m.reason === 'manual' ? 'abierto a mano' : 'abierto') : 'cerrado',
          color: m.module.accent,
          act: async () => {
            if (m.unlocked && m.reason !== 'manual') {
              this.note.setText('');
              drawText(this, W / 2, H - 22, 'Ya está abierto por el curso.', { color: 'amber', align: 'center' });
              return;
            }
            await setModuleManual(store, m.module.id, !m.unlocked);
            again();
          },
        }));
      this.rows.push({ id: 'back', label: 'Volver', act: () => go('main', 5) });
    } else {
      this.rows = [
        { id: 'cancel', label: 'No, conservar mi progreso', color: 'lime', act: () => go('main', 6) },
        {
          id: 'confirm',
          label: `Sí, borrar todo de ${SHORT_LABEL[l.instrument]}`,
          color: 'magenta',
          act: async () => {
            await store.clearProgress(l.instrument);
            clearFlow(this);
            this.scene.start('placement', { stage: 'intro' });
          },
        },
      ];
      drawText(this, W / 2, 26, 'Se pierden estrellas, dominio y récords.', { color: 'amber', align: 'center' });
      drawText(this, W / 2, 38, 'No se puede deshacer. Otros instrumentos: intactos.', { color: 'foam', align: 'center' });
    }

    const top = this.mode === 'confirm' ? 56 : ROW_Y;
    this.frame = this.add.graphics();
    this.rows.forEach((r, i) => {
      const y = top + i * ROW_H;
      drawText(this, 18, y + 4, r.label, { color: r.color ?? 'foam' });
      if (r.value) drawText(this, W - 18, y + 4, r.value, { color: 'cyan', align: 'right' });
      this.add.zone(8, y, W - 16, ROW_H - 2).setOrigin(0, 0).setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        this.select(i);
        void r.act();
      });
    });
    this.note = drawText(this, W / 2, H - 22, '', { color: 'amber', align: 'center' });
    drawText(this, W / 2, H - 9, this.mode === 'main' ? '↑↓ elegir  Enter cambiar  Esc salón' : '↑↓ elegir  Enter aceptar  Esc volver', { color: 'dim', align: 'center' });
    const kb = this.input.keyboard!;
    kb.on('keydown-UP', () => this.select((this.index + this.rows.length - 1) % this.rows.length));
    kb.on('keydown-DOWN', () => this.select((this.index + 1) % this.rows.length));
    kb.on('keydown-ENTER', () => void this.rows[this.index].act());
    kb.on('keydown-SPACE', () => void this.rows[this.index].act());
    kb.on('keydown-ESC', () => (this.mode === 'main' ? this.scene.start('hub') : go('main', this.mode === 'unlock' ? 5 : 6)));
    this.index = Math.min(this.index, this.rows.length - 1);
    this.select(this.index);
  }

  private select(i: number): void {
    this.index = i;
    hooks.selected = this.rows[i].id;
    const top = this.mode === 'confirm' ? 56 : ROW_Y;
    this.frame.clear();
    this.rows.forEach((_, k) => panel(this.frame, 8, top + k * ROW_H, W - 16, ROW_H - 2, k === i ? 'cyan' : 'water', 'deep', k === i ? 0.95 : 0.6));
    this.frame.lineStyle(1, paletteInt('cyan'), 0.4).strokeRect(6.5, top + i * ROW_H - 1.5, W - 13, ROW_H + 1);
  }
}
