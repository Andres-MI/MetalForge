import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { addBackground, enterScene, H, profileStore, setEnergy, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { CAL_BEAT0_AFTER_CAPTURE, CAL_BPM, CAL_CLICKS, CAL_COUNT_IN, measureOffset } from '../game/calibration';
import { GameClock } from '../game/clock';
import { CALIBRATION_SKIPPED, launchGame } from '../game/launch';
import { openAudioInput, type GameInput } from '../game/input';
import { AudioClickSink, Metronome } from '../game/metronome';
import type { GameParams } from '../game/types';
import { fmtMs, panel } from '../game/ui';
import { INSTRUMENTS } from '../model/instrument';
import { paletteInt, type PaletteKey } from '../ui/palette';

type Phase = 'opening' | 'running' | 'result' | 'failed';

/** Calibration: play along with 10 clicks; the median onset-to-click offset becomes `settings.latencyOffset`. */
export class CalibrationScene extends Phaser.Scene {
  private input_: GameInput | null = null;
  private gone = false;

  constructor() {
    super('calibration');
  }

  create(data: { next?: GameParams; then?: { scene: string; data?: object } }): void {
    enterScene(this, 'calibration');
    addBackground(this);
    this.gone = false;
    this.input_ = null;
    hooks.calibration = null;
    const store = profileStore(this);
    const instId = store.profile.instrument ?? 'guitar';
    let phase: Phase = 'opening';
    const onsets: number[] = [];
    let clock: GameClock | null = null;
    let metro: Metronome | null = null;
    let energy = 0;
    let beatTimes: number[] = [];

    drawText(this, W / 2, 8, 'CALIBRACIÓN', { scale: 2, color: 'magenta', align: 'center' });
    drawText(this, W / 2, 26, 'Toca cualquier nota a cada clic.', { color: 'dim', align: 'center' });
    drawText(this, W / 2, 36, `Cuenta de ${CAL_COUNT_IN} y luego ${CAL_CLICKS} clics.`, { color: 'dim', align: 'center' });
    const status = drawText(this, W / 2, 50, 'Abriendo la entrada de audio', { color: 'foam', align: 'center' });
    const big = drawText(this, W / 2, 112, '', { scale: 4, color: 'lime', align: 'center' });
    const line1 = drawText(this, W / 2, 140, '', { color: 'foam', align: 'center' });
    const line2 = drawText(this, W / 2, 152, '', { color: 'dim', align: 'center' });
    const hint = drawText(this, W / 2, H - 10, 'Esc salir', { color: 'dim', align: 'center' });
    const g = this.add.graphics();

    const lit = (i: number): PaletteKey => (clock && clock.now() >= beatTimes[i] ? 'cyan' : 'dim');
    const BOX = 24;
    const GAP = 4;
    const x0 = Math.round((W - (CAL_CLICKS * BOX + (CAL_CLICKS - 1) * GAP)) / 2);
    const BOX_Y = 72;

    const redraw = () => {
      g.clear();
      for (let i = 0; i < CAL_CLICKS; i++) {
        const on = phase === 'running' && clock ? lit(i) : phase === 'result' ? 'cyan' : 'dim';
        panel(g, x0 + i * (BOX + GAP), BOX_Y, BOX, BOX, on, 'deep', on === 'cyan' ? 0.95 : 0.6);
        if (clock && phase === 'running') {
          const t = beatTimes[i];
          const flash = clock.now() - t;
          if (flash >= 0 && flash < 0.12) g.fillStyle(paletteInt('cyan'), 0.7).fillRect(x0 + i * (BOX + GAP) + 2, BOX_Y + 2, BOX - 4, BOX - 4);
        }
      }
      if (phase === 'running' && clock) {
        // count-in dots
        const b = clock.beat();
        for (let k = 0; k < CAL_COUNT_IN; k++) {
          const on = b >= -CAL_COUNT_IN + k;
          g.fillStyle(paletteInt(on ? 'lime' : 'dim'), on ? 1 : 0.5).fillRect(W / 2 - 30 + k * 16, 63, 8, 4);
        }
        energy *= 0.94;
        setEnergy(this, energy);
      }
    };

    const finish = () => {
      if (!clock) return;
      metro?.stop();
      const r = measureOffset(onsets, beatTimes);
      hooks.calibration = { offsetMs: r.offset * 1000, spreadMs: r.spread * 1000, used: r.used, matched: r.matched, ok: r.ok };
      if (r.ok) {
        phase = 'result';
        void store.setSettings({ latencyOffset: r.offset });
        placeText(status, W / 2, 50, 'Medido y guardado', { color: 'lime', align: 'center' });
        placeText(big, W / 2, 106, fmtMs(r.offset * 1000), { scale: 4, color: 'lime', align: 'center' });
        const stable = r.spread < 0.015 ? 'muy estable' : r.spread < 0.03 ? 'estable' : 'irregular, repite';
        placeText(line1, W / 2, 140, `Latencia total ${Math.round(r.offset * 1000)} ms, variación ${Math.round(r.spread * 1000)} ms (${stable})`, { color: 'foam', align: 'center' });
        placeText(line2, W / 2, 152, `${r.used} de ${r.beats} clics usados`, { color: 'dim', align: 'center' });
        placeText(hint, W / 2, H - 10, data.next ? 'Enter jugar   R repetir   Esc omitir' : 'Enter volver   R repetir   Esc salir', { color: 'dim', align: 'center' });
      } else {
        phase = 'failed';
        placeText(status, W / 2, 50, 'No se oyó bien', { color: 'amber', align: 'center' });
        placeText(line1, W / 2, 140, `Solo ${r.used} de ${r.beats} clics. Toca más fuerte y a cada clic.`, { color: 'foam', align: 'center' });
        placeText(hint, W / 2, H - 10, 'R repetir   Esc salir', { color: 'dim', align: 'center' });
      }
    };

    const leave = (skipped: boolean) => {
      if (skipped) this.registry.set(CALIBRATION_SKIPPED, true);
      if (data.next) void launchGame(this, data.next);
      else if (data.then) this.scene.start(data.then.scene, data.then.data);
      else this.scene.start('hub');
    };

    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', () => leave(phase !== 'result'));
    kb.on('keydown-ENTER', () => {
      if (phase === 'result') leave(false);
    });
    kb.on('keydown-R', () => {
      if (phase === 'result' || phase === 'failed') this.scene.restart(data);
    });

    const tick = () => {
      redraw();
      if (phase === 'running' && clock && clock.now() > beatTimes[CAL_CLICKS - 1] + 0.6) finish();
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, tick);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.gone = true;
      this.events.off(Phaser.Scenes.Events.UPDATE, tick);
      metro?.stop();
      this.input_?.stop();
      this.input_ = null;
      setEnergy(this, 0);
    });

    void (async () => {
      try {
        const input = await openAudioInput(INSTRUMENTS[instId]);
        if (this.gone) {
          input.stop();
          return;
        }
        this.input_ = input;
        input.subscribe((events) => {
          for (const e of events) {
            if (e.type !== 'onset') continue;
            energy = Math.min(1, e.rms * 4);
            if (phase === 'running') onsets.push(e.time);
          }
        });
        // Wait for the first captured block, then fix beat 0 relative to it.
        await new Promise<void>((res) => {
          const poll = setInterval(() => {
            if (input.captureStart() !== null || this.gone) {
              clearInterval(poll);
              res();
            }
          }, 20);
        });
        if (this.gone) return;
        const c = new GameClock(input);
        const beat0 = Math.max((input.captureStart() ?? 0) + CAL_BEAT0_AFTER_CAPTURE, input.now() + 0.3 + (CAL_COUNT_IN * 60) / CAL_BPM);
        c.startAt(beat0, { bpm: CAL_BPM, countInBeats: CAL_COUNT_IN });
        clock = c;
        beatTimes = Array.from({ length: CAL_CLICKS }, (_, i) => c.beatToTime(i));
        metro = new Metronome(c, new AudioClickSink(input.context!), { volume: store.profile.settings.metronomeVolume ?? 0.6 });
        metro.start();
        phase = 'running';
        placeText(status, W / 2, 50, 'Toca con los clics', { color: 'lime', align: 'center' });
      } catch (err) {
        phase = 'failed';
        placeText(status, W / 2, 50, 'Sin entrada de audio', { color: 'magenta', align: 'center' });
        placeText(line1, W / 2, 140, String((err as Error).message ?? err).slice(0, 50), { color: 'dim', align: 'center' });
        placeText(hint, W / 2, H - 10, 'R repetir   Esc salir', { color: 'dim', align: 'center' });
      }
    })();
  }
}
