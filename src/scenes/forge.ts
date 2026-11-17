import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { levelLabel } from '../exercises';
import { makeFakeControl } from '../game/fakePlayer';
import { boardLayout, directionHint, rowY, slotX, type BoardLayout } from '../game/frets/board';
import { chordFeedback, type ChordFeedback } from '../game/chords/feedback';
import { hearChord } from '../game/chords/hear';
import { bassRoles, BASS_ROLE_ES, chordLabel, chordToneNames, groupChords, groupIndexOf, type ChordGroup } from '../game/chords/names';
import { MinuteRound, minuteExercise, readChangeBest, saveChangeBest } from '../game/forge/minute';
import { FakeInput } from '../game/input';
import { GAMES } from '../game/registry';
import { beginGame, showResults, trackEnergy } from '../game/scene';
import type { GameSession } from '../game/session';
import type { GameSceneData } from '../game/types';
import { JUDGEMENT_STYLE } from '../game/ui';
import type { Exercise } from '../model/exercise';
import { INSTRUMENTS, noteName } from '../model/instrument';
import type { RoundSummary, ScoredTarget } from '../scoring/types';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { drawBassBoard, drawChordBox, type BassBoardArt, type ChordBoxArt } from './chordsDraw';
import { stringKey } from './fretsDraw';

const HOLD_MS = 900;
const LISTEN_MS = 800;
const STRIKE_MS = 320;
const LANE_Y = 28;
const LANE_H = 20;
const HIT_X = 54;
const PX_BEAT = 21;
/** Message lines (all layouts). */
const HEAD_Y = 131;
const MSG1_Y = 148;
const MSG2_Y = 158;

type Verdict = 'none' | 'listening' | 'ok' | 'wrong';

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  color: PaletteKey;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
function mix(a: PaletteKey, b: PaletteKey, u: number): number {
  const ca = paletteInt(a);
  const cb = paletteInt(b);
  const ch = (s: number) => Math.round(lerp((ca >> s) & 255, (cb >> s) & 255, u));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
/** Ingot colour from cold to white-hot: dim, water-red ember (amber), foam. */
function heatColor(heat: number): number {
  return heat < 0.55 ? mix('dim', 'amber', heat / 0.55) : mix('amber', 'foam', (heat - 0.55) / 0.45);
}

/**
 * Forja: the sober LEARN game for chords. The chord box shows the shape; you strum until it sounds right. After each strum the
 * verdict says which tones were heard (their strings light up), which are missing and on which string, and whether a note of
 * another chord sounded. No clock, no penalty. At change levels a second part, "un minuto de cambios", counts the clean
 * changes between the two chords in 60 s; level 10 is a timed progression. Bass: the three notes of the chord, in order.
 * Keys: S skip, H hear the chord, Enter / R at the end of the round.
 */
export class ForgeScene extends Phaser.Scene {
  constructor() {
    super('forge');
  }

  create(data: GameSceneData): void {
    enterScene(this, 'forge');
    addBackground(this);
    const store = profileStore(this);
    const def = GAMES[data.params.gameId];
    const inst = INSTRUMENTS[data.exercise.instrument];
    const isBass = inst.id !== 'guitar';
    const timed = data.exercise.timed;
    const minuteDef = timed ? null : minuteExercise(data.exercise);

    let session: GameSession = data.session;
    let ex: Exercise = data.exercise;
    let groups: ChordGroup[] = groupChords(ex);
    let offs: (() => void)[] = [];
    let phase: 'round' | 'offer' | 'minute' = 'round';
    let shown = -1;
    let box: ChordBoxArt | null = null;
    let board: BassBoardArt | null = null;
    let layout: BoardLayout | null = null;
    let noteTexts: Phaser.GameObjects.BitmapText[] = [];
    let spots: { x: number; y: number; steps: number[] }[] = [];
    let step = 0; // bass: notes of the shown chord played so far
    let groupWrongs = 0;
    let verdict: Verdict = 'none';
    let fb: ChordFeedback | null = null;
    let listenUntil = 0;
    let advanceAt = 0;
    let heat = 0.12;
    let heatTarget = 0.12;
    let heatAt = 0;
    let strikeAt = -1e9;
    let strikes = 0;
    let over = false;
    let timing = '';
    let headline = '';
    let headColor: PaletteKey = 'dim';
    let msg1 = '';
    let msg1Color: PaletteKey = 'amber';
    let msg2 = '';
    let msg2Color: PaletteKey = 'violet';
    let roundSummary: RoundSummary | null = null;
    let minute: MinuteRound | null = null;
    let minuteBest = 0;
    let minuteMsg = '';
    let minuteDone = false;
    const results = new Map<number, string>();
    const sparks: Spark[] = [];

    const now = () => session.input.now();
    /** Target waiting (untimed) or next to play (timed); the last one when everything is resolved. */
    const curIndex = () => {
      const c = session.currentIndex;
      return c < 0 ? ex.targets.length - 1 : Math.min(c, ex.targets.length - 1);
    };
    const groupOf = (i: number) => groups[groupIndexOf(groups, Math.min(i, ex.targets.length - 1))];
    const targetMidi = (i: number) => {
      const k = ex.targets[i].kind;
      return k.type === 'note' ? k.midi : k.type === 'chord' ? k.midis[0] : 0;
    };
    const groupMidis = (g: ChordGroup): number[] => {
      const k = ex.targets[g.first].kind;
      if (k.type === 'chord') return k.midis;
      return ex.targets.slice(g.first, g.first + g.count).map((t) => (t.kind.type === 'note' ? t.kind.midi : 0));
    };

    // ---- static layout ----
    drawText(this, 8, 8, 'FORJA', { scale: 2, color: def.accent, depth: 10 });
    drawText(this, W - 8, 8, `NIVEL ${data.level}`, { color: 'foam', align: 'right', depth: 10 });
    drawText(this, W - 8, 18, levelLabel('chords', data.level, inst.id), { color: 'dim', align: 'right', depth: 10 });
    const progress = drawText(this, 8, 26, '', { color: 'dim', depth: 10 });
    const nameY = timed ? 54 : isBass ? 28 : 36;
    const labelY = isBass ? (timed ? 52 : 36) : nameY + 32;
    const tonesY = isBass ? (timed ? 62 : 45) : nameY + 44;
    const nameText = drawText(this, isBass ? W / 2 : 128, nameY, '', { scale: isBass ? 3 : 4, color: 'foam', align: isBass ? 'center' : 'left', depth: 10 });
    const labelText = drawText(this, isBass ? 8 : 128, labelY, '', { color: 'cyan', depth: 10 });
    const tonesText = drawText(this, isBass ? 8 : 128, tonesY, '', { color: 'dim', depth: 10 });
    const noteHelp = drawText(this, isBass ? 8 : 128, isBass ? 58 : nameY + 58, '', { color: 'dim', depth: 10 });
    const headText = drawText(this, W / 2, HEAD_Y, '', { scale: 2, color: 'dim', align: 'center', depth: 10 });
    const msg1Text = drawText(this, W / 2, MSG1_Y, '', { color: 'amber', align: 'center', depth: 10 });
    const msg2Text = drawText(this, W / 2, MSG2_Y, '', { color: 'violet', align: 'center', depth: 10 });
    const keysText = drawText(this, W / 2, H - 8, '', { color: 'dim', align: 'center', depth: 10 });
    const timerText = drawText(this, W - 8, 30, '', { scale: 3, color: 'foam', align: 'right', depth: 10 });
    const minuteInfo = [0, 1, 2].map((i) => drawText(this, W - 8, 56 + i * 10, '', { color: 'foam', align: 'right', depth: 10 }));
    const back = this.add.graphics().setDepth(3);
    const g = this.add.graphics().setDepth(9);
    const lane = this.add.graphics().setDepth(8);
    const laneTexts = timed ? groups.map((gr) => drawText(this, 0, LANE_Y + 6, gr.name, { color: 'foam', depth: 9 })) : [];
    const anvil = this.add.image(0, 0, 'anvil').setOrigin(0.5, 1).setDepth(5);
    const hammer = this.add.image(0, 0, 'hammer').setOrigin(0.5, 1).setDepth(7);
    const showKeys = () => {
      const base = phase === 'offer' ? 'Esc salir' : phase === 'minute' ? 'H oír el acorde   Esc salir' : 'H oír el acorde   S saltar   Esc salir';
      placeText(keysText, W / 2, H - 8, timed ? 'H oír el acorde   Esc salir' : base, { color: 'dim', align: 'center' });
    };
    showKeys();

    // ---- chord display ----
    const clearDisplay = () => {
      box?.destroy();
      box = null;
      board?.destroy();
      board = null;
      noteTexts.forEach((t) => t.destroy());
      noteTexts = [];
      spots = [];
      layout = null;
    };

    const showGroup = (gi: number) => {
      shown = gi;
      clearDisplay();
      const gr = groups[gi];
      step = 0;
      groupWrongs = 0;
      placeText(nameText, isBass ? W / 2 : 128, nameY, gr.name, { scale: isBass ? 3 : 4, color: 'foam', align: isBass ? 'center' : 'left' });
      placeText(labelText, isBass ? 8 : 128, labelY, chordLabel(gr.name, inst.id), { color: 'cyan' });
      if (!isBass) {
        box = drawChordBox(this, gr.name, 52, timed ? 70 : 66, { sx: 13, sy: 11, labels: true, depth: 4 });
        placeText(tonesText, 128, nameY + 44, `Notas: ${chordToneNames(gr.name).join(' · ')}`, { color: 'dim' });
        placeText(noteHelp, 128, nameY + 58, gr.from ? `Viene de ${gr.from}` : '', { color: 'dim' });
      } else {
        const targets = ex.targets.slice(gr.first, gr.first + gr.count);
        const zone = targets.map((t) => (t.kind.type === 'note' && t.kind.pos ? t.kind.pos : { string: 0, fret: 0 }));
        layout = boardLayout(zone, W, timed ? 95 : 92);
        layout.rowGap = timed ? 12 : 16;
        board = drawBassBoard(this, layout, 2);
        const roles = bassRoles(gr.count);
        const byPos = new Map<string, { x: number; y: number; steps: number[] }>();
        zone.forEach((p, k) => {
          const key = `${p.string}:${p.fret}`;
          const e = byPos.get(key) ?? { x: slotX(layout!, p.fret), y: rowY(layout!, p.string), steps: [] };
          e.steps.push(k);
          byPos.set(key, e);
        });
        spots = [...byPos.values()];
        noteTexts = spots.map((s) => drawText(this, s.x, s.y - 3, s.steps.map((k) => k + 1).join('·'), { color: 'abyss', align: 'center', depth: 10 }));
        const names = targets.map((t) => (t.kind.type === 'note' ? noteName(t.kind.midi) : '')).join(' · ');
        placeText(tonesText, 8, tonesY, timed ? names : `Notas: ${names}`, { color: 'dim' });
        placeText(noteHelp, 8, 54, timed ? '' : roles.map((r, k) => `${k + 1} ${BASS_ROLE_ES[r]}`).join('  '), { color: 'dim' });
      }
      placeText(progress, 8, 26, timed || phase === 'minute' ? '' : `Acorde ${gi + 1} de ${groups.length}`, { color: 'dim' });
    };

    // ---- messages ----
    const say = (h: string, hc: PaletteKey, m1 = '', c1: PaletteKey = 'amber', m2 = '', c2: PaletteKey = 'violet') => {
      [headline, headColor, msg1, msg1Color, msg2, msg2Color] = [h, hc, m1, c1, m2, c2];
    };
    const heatTo = (v: number) => {
      heatTarget = v;
      heatAt = this.time.now;
    };
    const strike = (color: PaletteKey) => {
      strikes++;
      strikeAt = this.time.now;
      const x = isBass ? 290 : 252;
      const y = isBass ? (timed ? 62 : 48) : 96;
      for (let i = 0; i < 16; i++) {
        const a = Math.PI + (i / 15) * Math.PI;
        sparks.push({ x, y, vx: Math.cos(a) * (0.6 + (i % 4) * 0.3), vy: Math.sin(a) * (0.8 + (i % 3) * 0.4), born: this.time.now, color: i % 3 === 0 ? 'foam' : color });
      }
      this.cameras.main.shake(70, 0.003);
    };

    // ---- events ----
    const onWrong = (s: GameSession, r: ScoredTarget) => {
      if (s !== session || over) return;
      const gr = groupOf(r.index);
      verdict = 'wrong';
      listenUntil = 0;
      if (!isBass) {
        fb = chordFeedback(gr.name, r.chord, false);
        const head = fb.missing.length ? 'FALTA ALGO' : fb.foreign.length ? 'OTRO ACORDE' : 'TODAVÍA NO';
        say(head, fb.missing.length ? 'amber' : 'violet', fb.missingText || (fb.foreign.length ? '' : `No suena como ${chordLabel(gr.name, inst.id)}`), 'amber', fb.foreignText, 'violet');
        heatTo(Math.min(0.55, fb.cleanliness));
      } else {
        const heard = r.heard?.[0];
        groupWrongs++;
        const want = targetMidi(r.index);
        fb = null;
        say('OTRA NOTA', 'violet', heard === undefined ? '' : `Tocaste ${noteName(heard)}: busca el ${noteName(want)}`, 'amber', heard === undefined ? '' : directionHint(heard, want).text, 'violet');
        heatTo(0.25);
      }
      if (phase === 'minute') minute?.wrong(now());
    };

    const onResolved = (s: GameSession, r: ScoredTarget) => {
      if (s !== session || over) return;
      hooks.judged.push({ index: r.index, judgement: r.judgement, deltaMs: Math.round(r.delta * 1000) });
      results.set(r.index, r.judgement);
      const gr = groupOf(r.index);
      const accepted = r.judgement === 'hit' || r.judgement === 'early' || r.judgement === 'late';
      const style = JUDGEMENT_STYLE[r.judgement];
      verdict = accepted ? 'ok' : 'wrong';
      listenUntil = 0;
      if (timed) {
        timing = style.label;
        if (!isBass && r.chord) fb = chordFeedback(gr.name, r.chord, accepted);
        else fb = null;
      }
      if (!accepted && !timed) {
        // Skipped (S): the next chord appears.
        fb = null;
        say('SIGUIENTE', 'dim');
        advanceAt = this.time.now + 350;
        step = 0;
        return;
      }
      if (!isBass) {
        if (!timed || accepted) fb = chordFeedback(gr.name, r.chord, accepted);
        if (timed) {
          if (accepted) {
            const f = fb!;
            say(style.label, style.color, f.clean ? 'Limpio: todas las cuerdas suenan' : f.missingText || 'Suena, pero puede sonar más limpio', f.clean ? 'lime' : 'amber', f.foreignText, 'violet');
            heatTo(Math.max(0.7, f.cleanliness));
            strike(f.clean ? 'lime' : 'amber');
          } else {
            const f = chordFeedback(gr.name, r.chord, false);
            fb = f;
            say(r.judgement === 'miss' ? 'SIN RASGUEO' : 'OTRO ACORDE', r.judgement === 'miss' ? 'dim' : 'violet', f.missingText, 'amber', f.foreignText, 'violet');
            heatTo(0.2);
          }
        } else {
          const f = fb!;
          say(f.clean ? '¡LIMPIO!' : '¡SUENA!', f.clean ? 'lime' : 'amber', f.clean ? 'Todas las cuerdas suenan a la vez' : 'Se oye, pero puede sonar más limpio: deja sonar todo', f.clean ? 'lime' : 'amber');
          heatTo(Math.max(0.72, f.cleanliness));
          strike(f.clean ? 'lime' : 'amber');
          advanceAt = this.time.now + HOLD_MS;
          if (phase === 'minute' && minute) minuteAccept(f.clean);
        }
      } else {
        // Bass: one target per note.
        if (accepted) step = r.index - gr.first + 1;
        if (!accepted) {
          fb = null;
          say(r.judgement === 'miss' ? 'SIN NOTA' : 'OTRA NOTA', 'violet');
        } else if (step >= gr.count) {
          const clean = groupWrongs === 0;
          say(timed ? style.label : '¡ACORDE!', timed ? style.color : clean ? 'lime' : 'amber', clean ? 'Las notas en orden y sin fallos' : 'Completo, con algún fallo por el camino');
          heatTo(clean ? 1 : 0.75);
          strike(clean ? 'lime' : 'amber');
          if (!timed) advanceAt = this.time.now + HOLD_MS;
          if (phase === 'minute' && minute) minuteAccept(clean);
          groupWrongs = 0;
        } else {
          say(timed ? style.label : `NOTA ${step} DE ${gr.count}`, timed ? style.color : 'cyan', `Ahora la ${BASS_ROLE_ES[bassRoles(gr.count)[step]]}: ${noteName(targetMidi(r.index + 1))}`, 'dim');
          heatTo(0.4 + 0.4 * (step / gr.count));
        }
      }
    };

    const minuteAccept = (clean: boolean) => {
      const ev = minute!.accept(now(), clean);
      if (ev === 'start') minuteMsg = 'El minuto corre: cambia de acorde';
      else if (ev === 'clean') minuteMsg = 'Cambio limpio';
      else if (ev === 'sloppy') minuteMsg = 'Cambio sucio: no cuenta';
    };

    const onFinished = (s: GameSession, summary: RoundSummary) => {
      if (s !== session || over) return;
      if (phase === 'round') {
        roundSummary = summary;
        if (minuteDef) {
          phase = 'offer';
          verdict = 'none';
          say('¡RONDA LISTA!', 'lime', `Enter: un minuto de cambios (${minuteDef.pair[0]} y ${minuteDef.pair[1]})`, 'cyan', 'R: ver los resultados', 'dim');
          showKeys();
        } else {
          over = true;
          showResults(this, { params: data.params, mode: data.mode, level: data.level, skill: data.skill, summary }, timed ? 1500 : 1300);
        }
      }
    };

    const wire = (s: GameSession) => {
      offs.forEach((f) => f());
      offs = [
        s.on('wrongAttempt', (r) => onWrong(s, r)),
        s.on('targetResolved', (r) => onResolved(s, r)),
        s.on('finished', (summary) => onFinished(s, summary)),
        s.on('heard', (e) => {
          if (s !== session || over || e.type !== 'onset') return;
          if (!isBass && (phase !== 'offer')) {
            verdict = 'listening';
            listenUntil = this.time.now + LISTEN_MS;
            fb = null;
          }
        }),
        ...(timed
          ? [
              s.on('countIn', (b) => say(`PREPARADOS ${b}`, b === s.clock.countInBeats ? 'lime' : 'foam')),
              s.on('go', () => say('¡YA!', 'lime')),
            ]
          : []),
        trackEnergy(this, s),
      ];
      hooks.fake = s.input instanceof FakeInput ? makeFakeControl(s, s.input) : null;
    };

    // ---- the one-minute round ----
    const startMinute = () => {
      if (phase !== 'offer' || !minuteDef) return;
      phase = 'minute';
      session.release();
      if (session.input instanceof FakeInput) session.input.clearPending();
      ex = minuteDef.exercise;
      groups = groupChords(ex);
      minute = new MinuteRound(minuteDef.pair);
      minuteMsg = 'Rasguea el primer acorde: el minuto empieza';
      minuteBest = 0;
      void store.getProgress(inst.id).then((b) => {
        minuteBest = readChangeBest(b, minuteDef.pair[0], minuteDef.pair[1]);
      });
      session = session.spawn(ex, { metronome: { on: false }, mastery: undefined });
      wire(session);
      session.start();
      shown = -1;
      verdict = 'none';
      fb = null;
      say('', 'dim');
      showKeys();
    };

    const finishMinute = () => {
      if (minuteDone || !minute) return;
      minuteDone = true;
      session.release();
      const m = minute;
      const open = (best: number, isNew: boolean) => {
        minuteMsg = isNew ? `¡Nuevo mejor! ${m.clean} cambios limpios` : `${m.clean} cambios limpios (mejor ${best})`;
        minuteBest = Math.max(best, m.clean);
        say('¡TIEMPO!', 'lime', `${m.clean} cambios limpios de ${m.changes}`, 'cyan', isNew ? '¡Nuevo mejor para este cambio!' : `Mejor para este cambio: ${best}`, isNew ? 'lime' : 'dim');
        this.time.delayedCall(2600, () => {
          if (!this.scene.isActive() || !roundSummary) return;
          over = true;
          showResults(this, { params: data.params, mode: data.mode, level: data.level, skill: data.skill, summary: roundSummary }, 0);
        });
      };
      saveChangeBest(store, inst.id, m.pair[0], m.pair[1], m.clean).then(
        (r) => open(Math.max(r.previous, m.clean), r.newBest),
        () => open(minuteBest, false),
      );
    };

    // ---- keys ----
    const kb = this.input.keyboard;
    kb?.on('keydown-S', () => {
      if (over || phase !== 'round' || timed) return;
      // Skips the whole chord: on bass that is every note of it still to play.
      const gr = groupOf(session.currentIndex);
      const left = Math.max(1, gr.first + gr.count - session.currentIndex);
      for (let i = 0; i < left; i++) session.skipCurrent();
    });
    kb?.on('keydown-H', () => {
      if (over || shown < 0) return;
      const gr = groups[shown];
      hearChord(groupMidis(gr), isBass ? 0.5 : 0.012, session.input.context);
    });
    kb?.on('keydown-ENTER', startMinute);
    kb?.on('keydown-R', () => {
      if (phase === 'offer' && roundSummary && !over) {
        over = true;
        showResults(this, { params: data.params, mode: data.mode, level: data.level, skill: data.skill, summary: roundSummary }, 200);
      }
    });

    // ---- drawing ----
    const drawForgeVisual = (cx: number, baseY: number, s: number, t: number) => {
      anvil.setPosition(cx, baseY).setScale(s);
      const topY = baseY - 9 * s;
      const w = 15 * s;
      const h = 3 * s;
      const col = heatColor(heat);
      if (heat > 0.3) for (let k = 0; k < 3; k++) g.fillStyle(paletteInt('amber'), (heat - 0.3) * 0.16).fillCircle(cx, topY - h, (7 + k * 4) * s * (0.6 + heat * 0.5));
      g.fillStyle(paletteInt('abyss'), 1).fillRect(cx - w / 2 - 1, topY - h - 1, w + 2, h + 1);
      g.fillStyle(col, 1).fillRect(cx - w / 2, topY - h, w, h);
      g.fillStyle(0xffffff, 0.25 * heat).fillRect(cx - w / 2, topY - h, w, 1);
      // Hammer: rests tilted away, swings down onto the ingot in a strike.
      const age = t - strikeAt;
      let ang = 52;
      if (age >= 0 && age < STRIKE_MS) ang = age < 90 ? lerp(52, -62, age / 90) : lerp(-62, 52, (age - 90) / (STRIKE_MS - 90));
      hammer.setScale(s).setPosition(cx + 10 * s, topY - 2).setAngle(ang);
      if (heat > 0.85 && Math.floor(t / 90) % 2 === 0) g.fillStyle(paletteInt('foam'), 0.8).fillRect(cx - w / 2 + ((t / 40) % w), topY - h - 2, 2, 1);
    };

    const redraw = () => {
      const t = this.time.now;
      const gt = now();
      back.clear();
      g.clear();
      lane.clear();
      heat = lerp(heat, heatTarget, 0.12);
      if (t - heatAt > 2200) heatTarget = Math.max(0.12, heatTarget - 0.004);
      // Which chord is on screen: the awaited one, after the hold that shows the accepted one.
      if (advanceAt && t >= advanceAt) advanceAt = 0;
      if (!advanceAt) {
        const cur = groupIndexOf(groups, curIndex());
        if (cur !== shown) {
          showGroup(cur);
          if (verdict !== 'listening' && phase !== 'offer' && !timed) {
            verdict = 'none';
            fb = null;
            say('', 'dim');
          }
        }
      }
      if (verdict === 'listening' && t > listenUntil) verdict = 'none';
      if (shown < 0 && !over) {
        showGroup(0);
      }

      // Box highlights: tones that sounded, tones that did not.
      if (box && fb && (verdict === 'ok' || verdict === 'wrong')) {
        const present = verdict === 'ok' ? box.diagram.strings.filter((s) => s.midi !== null).map((s) => s.string) : fb.presentStrings;
        box.mark(g, present, verdict === 'wrong' ? fb.missingStringIdx : [], t);
      }
      // Bass board: dots for the notes of the chord.
      if (isBass && layout) {
        spots.forEach((sp) => {
          const gr = groups[Math.max(0, shown)];
          const done = sp.steps.every((k) => k < step);
          const active = sp.steps.includes(step) && step < gr.count && !done;
          const stringIdx = ex.targets[gr.first + sp.steps[0]].kind;
          const col: PaletteKey = stringIdx.type === 'note' && stringIdx.pos ? stringKey(stringIdx.pos.string) : 'cyan';
          const pulse = active ? 0.6 + 0.4 * Math.sin(t / 150) : 1;
          g.fillStyle(paletteInt('abyss'), 1).fillCircle(sp.x + 0.5, sp.y + 0.5, timed ? 6 : 8);
          g.fillStyle(paletteInt(col), done ? 1 : active ? pulse : 0.45).fillCircle(sp.x + 0.5, sp.y + 0.5, timed ? 5 : 7);
          if (done) g.lineStyle(1, paletteInt('lime'), 1).strokeCircle(sp.x + 0.5, sp.y + 0.5, 9);
          if (active) g.lineStyle(1, paletteInt('foam'), pulse).strokeCircle(sp.x + 0.5, sp.y + 0.5, 10);
        });
      }

      // Forge visual.
      if (phase === 'minute' && !isBass) drawForgeVisual(268, 116, 1, t);
      else if (isBass) drawForgeVisual(292, timed ? 70 : 52, 1, t);
      else drawForgeVisual(250, 112, 2, t);

      // Sparks.
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        const age = (t - s.born) / 16;
        if (age > 36) {
          sparks.splice(i, 1);
          continue;
        }
        g.fillStyle(paletteInt(s.color), 1 - age / 36).fillRect(Math.round(s.x + s.vx * age), Math.round(s.y + s.vy * age + age * age * 0.03), 2, 2);
      }

      // Timed progression lane.
      let beat = 0;
      if (timed) {
        beat = session.beat();
        lane.fillStyle(paletteInt('abyss'), 0.8).fillRect(8, LANE_Y, W - 16, LANE_H);
        lane.lineStyle(1, paletteInt('dim'), 1).strokeRect(8.5, LANE_Y + 0.5, W - 17, LANE_H - 1);
        groups.forEach((gr, gi) => {
          const x0 = HIT_X + ((gr.beat ?? 0) - beat) * PX_BEAT;
          const w = 4 * PX_BEAT - 3;
          const res = results.get(gr.first + gr.count - 1) ?? results.get(gr.first);
          const first = results.get(gr.first);
          const col: PaletteKey = !first ? (gi === shown ? 'amber' : 'water') : first === 'hit' ? 'lime' : first === 'early' || first === 'late' ? 'amber' : first === 'wrong' ? 'violet' : 'dim';
          const visible = x0 + w > 10 && x0 < W - 10;
          const clipL = Math.max(10, x0);
          const clipR = Math.min(W - 10, x0 + w);
          if (visible) {
            lane.fillStyle(paletteInt(col), first ? 0.55 : gi === shown ? 0.45 : 0.3).fillRect(clipL, LANE_Y + 2, clipR - clipL, LANE_H - 4);
            lane.lineStyle(1, paletteInt(col), 1).strokeRect(clipL + 0.5, LANE_Y + 2.5, clipR - clipL - 1, LANE_H - 5);
            if (isBass) {
              for (let k = 0; k < gr.count; k++) {
                const tx = x0 + k * PX_BEAT + PX_BEAT / 2;
                if (tx > 12 && tx < W - 12) {
                  const done = results.has(gr.first + k);
                  lane.fillStyle(paletteInt(done ? 'lime' : 'foam'), 1).fillRect(Math.round(tx) - 1, LANE_Y + LANE_H - 7, 3, 3);
                }
              }
            }
          }
          const showName = x0 > 10 && x0 + 4 * PX_BEAT < W - 10;
          laneTexts[gi].setVisible(showName);
          if (showName) placeText(laneTexts[gi], x0 + 4, LANE_Y + 5, gr.name, { color: res || first ? 'foam' : 'foam' });
        });
        lane.fillStyle(paletteInt('lime'), 1).fillRect(HIT_X, LANE_Y - 2, 1, LANE_H + 4);
        lane.fillStyle(paletteInt('lime'), 0.25).fillRect(HIT_X - 3, LANE_Y, 7, LANE_H);
      }

      // Minute round clock.
      let minuteHook: NonNullable<typeof hooks.forge>['minute'] = null;
      if (minute) {
        const rem = minute.remaining(gt);
        if (minute.over(gt)) finishMinute();
        placeText(timerText, W - 8, 30, String(Math.ceil(rem)), { scale: 3, color: !minute.started ? 'dim' : rem <= 10 ? 'magenta' : 'foam', align: 'right' });
        placeText(minuteInfo[0], W - 8, 56, `LIMPIOS ${minute.clean}`, { color: 'lime', align: 'right' });
        placeText(minuteInfo[1], W - 8, 66, `CAMBIOS ${minute.changes}`, { color: 'foam', align: 'right' });
        placeText(minuteInfo[2], W - 8, 76, `MEJOR ${Math.max(minuteBest, minute.clean)}`, { color: 'amber', align: 'right' });
        if (!minuteDone) placeText(progress, 8, 26, minuteMsg, { color: 'cyan' });
        else placeText(progress, 8, 26, minuteMsg, { color: 'lime' });
        minuteHook = { started: minute.started, remaining: rem, changes: minute.changes, clean: minute.clean, best: Math.max(minuteBest, minute.clean), over: minuteDone, pair: minute.pair.join('>'), message: minuteMsg };
      }

      // Message lines.
      const listening = verdict === 'listening';
      if (listening) {
        const dots = '.'.repeat(1 + (Math.floor(t / 250) % 3));
        placeText(headText, W / 2, HEAD_Y, `ESCUCHANDO${dots}`, { scale: 2, color: 'cyan', align: 'center' });
        placeText(msg1Text, W / 2, MSG1_Y, '', { color: 'dim', align: 'center' });
        placeText(msg2Text, W / 2, MSG2_Y, '', { color: 'dim', align: 'center' });
      } else {
        const idleHead = !headline && !over && phase === 'round' && !timed;
        placeText(headText, W / 2, HEAD_Y, idleHead ? (isBass ? 'TOCA LAS NOTAS' : 'RASGUEA EL ACORDE') : headline, { scale: 2, color: idleHead ? 'dim' : headColor, align: 'center' });
        placeText(msg1Text, W / 2, MSG1_Y, msg1, { color: msg1Color, align: 'center' });
        placeText(msg2Text, W / 2, MSG2_Y, msg2, { color: msg2Color, align: 'center' });
      }

      const gr = groups[Math.max(0, shown)];
      hooks.forge = {
        phase,
        timed,
        index: curIndex(),
        group: Math.max(0, shown),
        groups: groups.length,
        name: gr.name,
        label: chordLabel(gr.name, inst.id),
        tones: isBass ? ex.targets.slice(gr.first, gr.first + gr.count).map((x) => (x.kind.type === 'note' ? noteName(x.kind.midi) : '')) : chordToneNames(gr.name),
        midis: groupMidis(gr),
        awaited: { name: groupOf(curIndex()).name, midis: groupMidis(groupOf(curIndex())), next: ex.targets[curIndex()].kind.type === 'note' ? (ex.targets[curIndex()].kind as { midi: number }).midi : null },
        step,
        steps: gr.count,
        verdict,
        clean: !!fb?.clean || (verdict === 'ok' && isBass && groupWrongs === 0),
        cleanliness: fb?.cleanliness ?? 0,
        missing: fb?.missing.map((m) => m.note) ?? [],
        missingStrings: fb ? [...new Set(fb.missingStringIdx.map((i) => INSTRUMENTS.guitar.openStrings.length - i))] : [],
        missingIdx: fb?.missingStringIdx ?? [],
        presentIdx: fb?.presentStrings ?? [],
        foreign: fb?.foreign ?? [],
        lookAlike: fb?.lookAlike ?? '',
        headline: listening ? 'ESCUCHANDO' : headline,
        msg1: listening ? '' : msg1,
        msg2: listening ? '' : msg2,
        heat,
        strikes,
        timing,
        minute: minuteHook,
        over,
      };
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, redraw);
      offs.forEach((f) => f());
      session.dispose();
      hooks.forge = null;
    });

    wire(session);
    laneTexts.forEach((tx) => tx.setVisible(false));
    beginGame(this, data, { manual: true });
    showGroup(0);
  }
}
