import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { startInput, type InputHandle } from '../audio/input';
import { addBackground, enterScene, H, profileStore, setEnergy, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { INSTRUMENTS, centsOff, freqToMidi, noteName, noteNameWithOctave, type Instrument } from '../model/instrument';
import { paletteInt, STRING_COLOR_KEYS, type PaletteKey } from '../ui/palette';
import { SHORT_LABEL } from './hubData';

const METER_X = 40;
const METER_W = 240;
const METER_Y = 80;
const METER_H = 14;
const STALE_MS = 1400;

/** Tuner: note name, cents needle and the instrument's strings. Also the end-to-end test of the audio chain. */
export class TunerScene extends Phaser.Scene {
  private inst!: Instrument;
  private handle: InputHandle | null = null;
  private gone = false;
  private lastEvent = -Infinity;
  private midi: number | null = null;
  private freq = 0;
  private cents = 0;
  private shown = 0;
  private note!: Phaser.GameObjects.BitmapText;
  private detail!: Phaser.GameObjects.BitmapText;
  private status!: Phaser.GameObjects.BitmapText;
  private footer!: Phaser.GameObjects.BitmapText;
  private needle!: Phaser.GameObjects.Rectangle;
  private strings: { box: Phaser.GameObjects.Graphics; name: Phaser.GameObjects.BitmapText; color: PaletteKey }[] = [];
  private activeString = -1;

  constructor() {
    super('tuner');
  }

  create(): void {
    enterScene(this, 'tuner');
    addBackground(this);
    this.gone = false;
    this.handle = null;
    this.lastEvent = -Infinity;
    this.midi = null;
    this.shown = 0;
    this.activeString = -1;
    this.strings = [];
    this.inst = INSTRUMENTS[profileStore(this).profile.instrument ?? 'guitar'];
    hooks.heard.length = 0;

    drawText(this, W / 2, 8, 'AFINADOR', { scale: 2, color: 'cyan', align: 'center' });
    drawText(this, 8, 8, SHORT_LABEL[this.inst.id], { color: 'foam' });

    this.note = drawText(this, W / 2, 26, '---', { scale: 5, color: 'dim', align: 'center' });
    this.detail = drawText(this, W / 2, 66, 'Toca una cuerda', { color: 'foam', align: 'center' });

    // Meter: ±50 cents across 240 pixels, with a lime zone for "in tune".
    const g = this.add.graphics();
    g.fillStyle(paletteInt('deep'), 0.9).fillRect(METER_X, METER_Y, METER_W, METER_H);
    g.fillStyle(paletteInt('lime'), 0.25).fillRect(METER_X + METER_W / 2 - 12, METER_Y, 24, METER_H);
    g.lineStyle(1, paletteInt('dim'), 1).strokeRect(METER_X + 0.5, METER_Y + 0.5, METER_W - 1, METER_H - 1);
    g.fillStyle(paletteInt('dim'), 1);
    for (let c = -50; c <= 50; c += 10) {
      const x = METER_X + METER_W / 2 + c * (METER_W / 100);
      g.fillRect(Math.min(METER_X + METER_W - 2, Math.max(METER_X + 1, Math.round(x))), METER_Y + METER_H, 1, c % 50 === 0 ? 5 : 3);
    }
    g.fillStyle(paletteInt('foam'), 1).fillRect(METER_X + METER_W / 2, METER_Y - 4, 1, METER_H + 8);
    drawText(this, METER_X, METER_Y + METER_H + 7, '-50', { color: 'dim' });
    drawText(this, W / 2, METER_Y + METER_H + 7, '0', { color: 'dim', align: 'center' });
    drawText(this, METER_X + METER_W, METER_Y + METER_H + 7, '+50', { color: 'dim', align: 'right' });
    this.needle = this.add.rectangle(W / 2, METER_Y - 2, 3, METER_H + 4, paletteInt('magenta')).setOrigin(0.5, 0).setVisible(false).setDepth(2);
    this.status = drawText(this, W / 2, METER_Y + METER_H + 19, '', { color: 'dim', align: 'center' });

    this.drawStrings();

    this.footer = drawText(this, W / 2, H - 10, 'Esc volver al salón', { color: 'dim', align: 'center' });
    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', () => this.scene.start('hub'));
    kb.on('keydown-ENTER', () => {
      if (!this.handle) void this.listen();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.gone = true;
      this.handle?.stop();
      this.handle = null;
      setEnergy(this, 0);
    });
    void this.listen();
  }

  private drawStrings(): void {
    const n = this.inst.openStrings.length;
    const bw = 40;
    const gap = 4;
    const x0 = Math.round((W - (n * bw + (n - 1) * gap)) / 2);
    const y = 134;
    this.inst.openStrings.forEach((m, i) => {
      const color = STRING_COLOR_KEYS[i % STRING_COLOR_KEYS.length];
      const x = x0 + i * (bw + gap);
      const box = this.add.graphics();
      const name = drawText(this, x + bw / 2, y + 6, noteName(m), { scale: 2, color: 'dim', align: 'center' });
      this.strings.push({ box, name, color });
      this.paintString(i, false, x, y, bw);
    });
  }

  private paintString(i: number, on: boolean, x?: number, y = 134, bw = 40): void {
    const n = this.inst.openStrings.length;
    const px = x ?? Math.round((W - (n * bw + (n - 1) * 4)) / 2) + i * (bw + 4);
    const s = this.strings[i];
    s.box.clear();
    s.box.fillStyle(paletteInt('deep'), 0.9).fillRect(px, y, bw, 26);
    s.box.lineStyle(1, paletteInt(on ? s.color : 'dim'), 1).strokeRect(px + 0.5, y + 0.5, bw - 1, 25);
    s.box.fillStyle(paletteInt(s.color), on ? 1 : 0.7).fillRect(px + 2, y + 22, bw - 4, 3);
    placeText(s.name, px + bw / 2, y + 6, noteName(this.inst.openStrings[i]), { scale: 2, color: on ? s.color : 'dim', align: 'center' });
  }

  private async listen(): Promise<void> {
    placeText(this.status, W / 2, METER_Y + METER_H + 19, 'Abriendo la entrada de audio', { color: 'dim', align: 'center' });
    try {
      const handle = await startInput(this.inst, (e) => {
        if (e.type === 'note') hooks.heard.push(e.midi);
        if (e.type === 'note' || e.type === 'pitch') {
          this.lastEvent = this.time.now;
          this.freq = e.freq;
          this.midi = Math.round(freqToMidi(e.freq));
          this.cents = centsOff(e.freq);
        }
        if (e.type === 'pitch' || e.type === 'onset') setEnergy(this, Math.min(1, e.rms * 6));
      });
      if (this.gone) {
        handle.stop();
        return;
      }
      this.handle = handle;
      placeText(this.status, W / 2, METER_Y + METER_H + 19, 'Escuchando', { color: 'lime', align: 'center' });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      placeText(this.status, W / 2, METER_Y + METER_H + 19, 'Sin entrada de audio. Enter para reintentar', { color: 'magenta', align: 'center' });
      placeText(this.footer, W / 2, H - 10, msg.slice(0, 50), { color: 'dim', align: 'center' });
    }
  }

  update(time: number): void {
    const fresh = this.midi !== null && time - this.lastEvent < STALE_MS;
    if (!fresh) {
      this.needle.setVisible(false);
      if (this.activeString !== -1) this.setActive(-1);
      if (this.midi !== null) {
        this.midi = null;
        placeText(this.note, W / 2, 26, '---', { scale: 5, color: 'dim', align: 'center' });
        placeText(this.detail, W / 2, 66, 'Toca una cuerda', { color: 'foam', align: 'center' });
        if (this.handle) placeText(this.status, W / 2, METER_Y + METER_H + 19, 'Escuchando', { color: 'lime', align: 'center' });
      }
      return;
    }
    const cents = Math.max(-50, Math.min(50, this.cents));
    this.shown += (cents - this.shown) * 0.35;
    const ok = Math.abs(this.cents) < 5;
    const color: PaletteKey = ok ? 'lime' : 'magenta';
    this.needle.setVisible(true).setFillStyle(paletteInt(color)).setX(Math.round(METER_X + METER_W / 2 + this.shown * (METER_W / 100)));
    placeText(this.note, W / 2, 26, noteName(this.midi!), { scale: 5, color: ok ? 'lime' : 'foam', align: 'center' });
    placeText(this.detail, W / 2, 66, `${noteNameWithOctave(this.midi!)}  ·  ${this.freq.toFixed(1)} Hz`, { color: 'foam', align: 'center' });
    const c = Math.round(this.cents);
    placeText(this.status, W / 2, METER_Y + METER_H + 19, ok ? 'Afinada' : c < 0 ? `${c} cents · sube la cuerda` : `+${c} cents · baja la cuerda`, { color, align: 'center' });
    this.setActive(this.inst.openStrings.indexOf(this.midi!));
  }

  private setActive(i: number): void {
    if (i === this.activeString) return;
    if (this.activeString >= 0) this.paintString(this.activeString, false);
    this.activeString = i;
    if (i >= 0) this.paintString(i, true);
  }
}

