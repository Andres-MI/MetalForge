import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { generate, levelLabel, scalesZone } from '../exercises';
import { makeFakeControl } from '../game/fakePlayer';
import { directionHint, playedOnBoard, rowY, slotX } from '../game/frets/board';
import { hearNote } from '../game/hearNote';
import { FakeInput } from '../game/input';
import { GAMES } from '../game/registry';
import { beginGame, showResults, trackEnergy } from '../game/scene';
import { improvisation, scaleBoardLayout } from '../game/scales/board';
import { playRun } from '../game/scales/backing';
import { FreeLog, isRoot, routeHolds, scaleInfo, scaleName, targetMidis } from '../game/scales/info';
import type { GameSession } from '../game/session';
import { stringNumber } from '../game/strings';
import type { GameSceneData } from '../game/types';
import { fmtMs, JUDGEMENT_STYLE, panel } from '../game/ui';
import type { Judgement } from '../model/exercise';
import { INSTRUMENTS, noteName } from '../model/instrument';
import type { RoundSummary, ScoredTarget } from '../scoring/types';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { cross, diamond, drawScaleBoard, pip, ring, setTextColor, slotCell, stringKey } from './scalesDraw';

const BOARD = { x0: 38, width: 278, centerY: 78 };
const WALL = { x: 2, y: 30, w: 34, h: 118 };
const MSG_Y = 138;
const SUB_Y = 156;
/** Timed lane: scrolling targets under the board. */
const LANE = { y: 133, h: 18, left: 40, right: 316, hitX: 92, ppb: 88 };
const FREE_LENGTH = 40;
const RUN_GAP_MS = 340;

interface Mark {
  judgement: Judgement;
  wrongAttempts: number;
  deltaMs: number;
}

/**
 * Escalada: the sober LEARN game for scales. The fingering of the scale is drawn on the fretboard (every scale note a
 * dot in its string colour, the roots with a diamond); you climb the pattern note by note. The note to play glows and
 * waits (no clock, no penalty), the notes already played stay lit so the shape of the scale shows, and a small climber
 * on the wall at the left climbs one hold per note. A wrong note shows where it is on the board and which way to go.
 * After the run, a FREE round: any note of the scale counts and lights its place; notes outside the scale get a cross
 * with their name. Level 10 is timed: the run scrolls against the metronome and only measures early / on time / late.
 * Keys: H hear the note, S skip, E hear the whole scale, Enter (after the run) free round, R results.
 */
export class ClimbScene extends Phaser.Scene {
  constructor() {
    super('climb');
  }

  create(data: GameSceneData): void {
    enterScene(this, 'climb');
    addBackground(this);
    const store = profileStore(this);
    const def = GAMES[data.params.gameId];
    const exercise = data.exercise;
    const inst = INSTRUMENTS[exercise.instrument];
    const seed = data.params.seed ?? 1;
    const timed = exercise.timed;
    const info = scaleInfo(exercise);
    const zone = scalesZone(inst.id, data.level, seed);
    const zoneMidis = zone.map((n) => n.midi);
    const layout = scaleBoardLayout(zone.map((n) => n.pos), BOARD);
    const art = drawScaleBoard(this, layout);
    const zoneAt = new Map(zone.map((n) => [n.midi, n]));
    const midis = targetMidis(exercise);
    const total = midis.length;
    const targetPos = (i: number) => {
      const k = exercise.targets[Math.min(i, total - 1)].kind;
      if (k.type !== 'note' || !k.pos) throw new Error('Escalada needs note targets with a position');
      return { pos: k.pos, midi: k.midi };
    };
    const holds = routeHolds(midis);
    const freeEx = improvisation(generate('scales', { instrument: inst.id, level: data.level, seed, free: true, length: FREE_LENGTH }));
    const log = new FreeLog(zoneMidis);

    let session: GameSession = data.session;
    let phase: 'run' | 'offer' | 'free' = 'run';
    let offs: (() => void)[] = [];
    let done = 0;
    let orderedSummary: RoundSummary | null = null;
    let ending = false;
    const marks = new Map<number, Mark>();
    const played = new Set<number>();
    const recent: { midi: number; at: number }[] = [];
    let wrong: { midi: number; name: string; pos: { string: number; fret: number } | null; hint: string; at: number } | null = null;
    let showName = false;
    let flash: Mark | null = null;
    let flashAt = -1e9;
    let freeMsg: { text: string; color: PaletteKey; at: number } | null = null;
    let runStart = -1e9;
    let climberAt = -1;
    let climberX = 0;
    let climberY = 0;
    let lastClimbIdx = -1;
    const crossed: { midi: number; pos: { string: number; fret: number } | null; at: number }[] = [];
    let appearAt = this.time.now;
    let reached = -1;
    let countMsg: { text: string; color: PaletteKey } = { text: '', color: 'foam' };

    // ---- static layout ----
    drawText(this, 8, 6, 'ESCALADA', { scale: 2, color: def.accent, depth: 10 });
    drawText(this, W - 8, 8, timed ? `NIVEL ${data.level}  ·  ${exercise.bpm} BPM` : `NIVEL ${data.level}`, { color: 'foam', align: 'right', depth: 10 });
    drawText(this, W - 8, 18, levelLabel('scales', data.level), { color: 'dim', align: 'right', depth: 10 });
    drawText(this, 38, 26, `${scaleName(info)}  ·  posición ${info.position}`, { color: 'dim', depth: 10 });
    const progress = drawText(this, W - 8, 26, '', { color: 'dim', align: 'right', depth: 10 });
    const msg = drawText(this, W / 2 + 14, MSG_Y, '', { scale: 2, color: 'amber', align: 'center', depth: 10 });
    const sub = drawText(this, W / 2 + 14, SUB_Y, '', { color: 'foam', align: 'center', depth: 10 });
    const keys = drawText(this, W / 2, H - 9, '', { color: 'dim', align: 'center', depth: 10 });
    const names = [0, 1, 2].map(() => drawText(this, 0, 0, '', { color: 'violet', align: 'center', depth: 9 }));
    const wallBack = this.add.graphics().setDepth(1);
    const wallG = this.add.graphics().setDepth(4);
    const back = this.add.graphics().setDepth(3);
    const g = this.add.graphics().setDepth(7);
    const lane = this.add.graphics().setDepth(6);
    const digits = timed ? midis.map((_, i) => drawText(this, 0, 0, String(targetPos(i).pos.fret), { color: 'abyss', align: 'center', depth: 8 })) : [];
    const climber = this.add.sprite(0, 0, 'climber').setDepth(8);
    climber.play('climber');
    panel(wallBack, WALL.x, WALL.y, WALL.w, WALL.h, 'water', 'deep', 0.85);
    for (let y = WALL.y + 8; y < WALL.y + WALL.h - 4; y += 12) wallBack.fillStyle(paletteInt('water'), 0.8).fillRect(WALL.x + 3, y, WALL.w - 6, 1);

    const showKeys = () => {
      const text =
        phase === 'offer'
          ? 'Enter ronda libre   R resultados   Esc salir'
          : phase === 'free'
            ? 'E oír la escala   Enter terminar   Esc salir'
            : timed
              ? `H oír nota  E oír escala  M metrónomo: ${session.metronome.isMuted ? 'no' : 'sí'}  Esc salir`
              : 'H oír nota   S saltar   E oír escala   Esc salir';
      placeText(keys, W / 2, H - 9, text, { color: 'dim', align: 'center' });
    };
    const holdXY = (i: number) => {
      const h = holds[Math.max(0, Math.min(total - 1, i))];
      return { x: WALL.x + (h.column ? 24 : 11), y: Math.round(WALL.y + WALL.h - 16 - h.height * (WALL.h - 40)) };
    };
    const cursor = () => (timed ? Math.max(0, exercise.targets.findIndex((_, k) => !marks.has(k))) : done);

    // ---- input ----
    const kb = this.input.keyboard;
    kb?.on('keydown-H', () => {
      if (phase !== 'run' || done >= total) return;
      const i = timed ? exercise.targets.findIndex((_, k) => !marks.has(k)) : done;
      if (i < 0) return;
      hearNote(targetPos(i).midi, session.input.context);
      showName = true;
    });
    kb?.on('keydown-S', () => {
      if (phase === 'run' && !timed && done < total) session.skipCurrent();
    });
    kb?.on('keydown-E', () => {
      playRun(midis, session.input.context, RUN_GAP_MS / 1000);
      runStart = this.time.now;
    });
    kb?.on('keydown-M', () => {
      if (!timed || phase !== 'run') return;
      session.metronome.setMuted(!session.metronome.isMuted);
      void store.setSettings({ metronomeOn: !session.metronome.isMuted });
      showKeys();
    });
    kb?.on('keydown-R', () => {
      if (phase !== 'run') openResults();
    });
    kb?.on('keydown-ENTER', () => {
      if (phase === 'offer') startFree();
      else if (phase === 'free') openResults();
    });

    // ---- sessions ----
    const wire = (s: GameSession, free: boolean) => {
      offs.forEach((f) => f());
      offs = [
        trackEnergy(this, s),
        s.on('wrongAttempt', (r) => onWrong(s, r, free)),
        s.on('targetResolved', (r) => onResolved(s, r, free)),
        s.on('finished', (summary) => onFinished(s, summary, free)),
      ];
      if (timed && !free) {
        offs.push(s.on('countIn', (b) => (countMsg = { text: `PREPARADOS  ${b}`, color: b === s.clock.countInBeats ? 'lime' : 'foam' })));
        offs.push(s.on('go', () => (countMsg = { text: 'YA', color: 'lime' })));
      }
      hooks.fake = s.input instanceof FakeInput ? makeFakeControl(s, s.input) : null;
    };

    const noteWrong = (heard: number, targetIdx: number, free: boolean) => {
      const t = free ? undefined : targetPos(targetIdx);
      const where = playedOnBoard(layout, inst, heard, t?.pos);
      const hint = free || !t ? '' : directionHint(heard, t.midi).text;
      wrong = { midi: heard, name: noteName(heard), pos: where.pos, hint, at: this.time.now };
    };

    const onWrong = (s: GameSession, r: ScoredTarget, free: boolean) => {
      if (s !== session) return;
      const heard = r.heard?.[0];
      if (heard === undefined) return;
      if (free) {
        log.stray(heard);
        crossed.push({ midi: heard, pos: playedOnBoard(layout, inst, heard).pos, at: this.time.now });
        if (crossed.length > 12) crossed.shift();
        freeMsg = { text: `FUERA: ${noteName(heard)}`, color: 'violet', at: this.time.now };
        wrong = null;
      } else noteWrong(heard, r.index, false);
    };

    const onResolved = (s: GameSession, r: ScoredTarget, free: boolean) => {
      if (s !== session) return;
      if (free) {
        const midi = r.heard?.[0];
        if (midi === undefined) return;
        const fresh = log.inside(midi);
        recent.push({ midi, at: this.time.now });
        if (recent.length > 4) recent.shift();
        freeMsg = log.complete
          ? { text: '¡ESCALA COMPLETA!', color: 'lime', at: this.time.now }
          : fresh
            ? { text: `¡NUEVA! ${noteName(midi)}`, color: 'lime', at: this.time.now }
            : { text: noteName(midi), color: 'foam', at: this.time.now };
        wrong = null;
        return;
      }
      const m: Mark = { judgement: r.judgement, wrongAttempts: r.wrongAttempts, deltaMs: r.delta * 1000 };
      marks.set(r.index, m);
      done++;
      hooks.judged.push({ index: r.index, judgement: r.judgement, deltaMs: Math.round(r.delta * 1000) });
      if (r.judgement === 'hit' || r.judgement === 'early' || r.judgement === 'late') {
        played.add(midis[r.index]);
        reached = Math.max(reached, r.index);
      }
      if (timed) {
        flash = m;
        flashAt = this.time.now;
        if (r.judgement === 'wrong' && r.heard?.length) noteWrong(r.heard[0], r.index, false);
      } else wrong = null;
      showName = false;
      appearAt = this.time.now;
    };

    const onFinished = (s: GameSession, summary: RoundSummary, free: boolean) => {
      if (s !== session) return;
      if (free) {
        openResults();
        return;
      }
      orderedSummary = summary;
      phase = 'offer';
      wrong = null;
      showName = false;
      showKeys();
    };

    const startFree = () => {
      if (phase !== 'offer') return;
      phase = 'free';
      wrong = null;
      session.release();
      if (session.input instanceof FakeInput) session.input.clearPending();
      session = session.spawn(freeEx, { metronome: { on: false }, mastery: undefined });
      wire(session, true);
      session.start();
      showKeys();
    };

    const openResults = () => {
      if (ending || !orderedSummary) return;
      ending = true;
      session.release();
      showResults(this, { params: data.params, mode: data.mode, level: data.level, skill: data.skill, summary: orderedSummary }, 300);
    };

    wire(session, false);
    if (!timed) session.metronome.setMuted(true);
    showKeys();

    // ---- drawing ----
    const redraw = () => {
      const t = this.time.now;
      g.clear();
      back.clear();
      wallG.clear();
      lane.clear();
      art.nums.forEach((n) => setTextColor(n, 'foam'));
      names.forEach((n) => n.setAlpha(0));
      const cur = cursor();
      const live = phase === 'run' && cur < total && !(timed && marks.size >= total);
      const beat = timed ? session.beat() : 0;
      const litSet = phase === 'free' ? log.visited : played;

      // Scale notes of the zone.
      for (const n of zone) {
        const x = slotX(layout, n.pos.fret);
        const y = rowY(layout, n.pos.string);
        const key = stringKey(n.pos.string);
        const root = isRoot(info, n.midi);
        const lit = litSet.has(n.midi);
        if (lit) slotCell(back, layout, n.pos.string, n.pos.fret, key, 0.13);
        pip(g, x, y, key, lit ? 1 : root ? 0.6 : 0.42, root || lit);
        if (lit) g.fillStyle(paletteInt('foam'), 0.95).fillRect(x - 1, y - 1, 3, 3);
        if (root) diamond(g, x, y, 5, 'foam', lit ? 1 : 0.7);
      }

      // The note to play: glow, ring and a lime fret number.
      let curMidi = -1;
      let curPos = { string: -1, fret: -1 };
      if (live) {
        const tp = targetPos(cur);
        curMidi = tp.midi;
        curPos = tp.pos;
        const x = slotX(layout, tp.pos.fret);
        const y = rowY(layout, tp.pos.string);
        const col = stringKey(tp.pos.string);
        const fade = timed ? 1 : Math.min(1, (t - appearAt) / 250);
        const pulse = 0.5 + 0.5 * Math.sin(t / 240);
        slotCell(back, layout, tp.pos.string, tp.pos.fret, col, (0.16 + 0.12 * pulse) * fade);
        back.fillStyle(paletteInt(col), (0.1 + 0.08 * pulse) * fade).fillCircle(x, y, 9);
        ring(g, x, y, 6, 'lime', fade);
        ring(g, x, y, 7 + Math.round(pulse), 'foam', 0.6 * fade);
        setTextColor(art.nums.get(tp.pos.fret)!, 'lime');
      }

      // "Hear the whole scale": a ring steps along the notes in time with the synth.
      const step = Math.floor((t - runStart) / RUN_GAP_MS);
      const listening = step >= 0 && step < total + 1;
      if (listening && step < total) {
        const tp = targetPos(step);
        ring(g, slotX(layout, tp.pos.fret), rowY(layout, tp.pos.string), 8, 'cyan');
        setTextColor(art.nums.get(tp.pos.fret)!, 'cyan');
      }

      // Wrong note: where it is on the board.
      const wrongOn = !!wrong && (timed ? t - wrong.at < 1600 : true) && phase === 'run';
      if (wrongOn && wrong) {
        if (wrong.pos) {
          const px = slotX(layout, wrong.pos.fret);
          const py = rowY(layout, wrong.pos.string);
          ring(g, px, py, 7, 'violet');
          ring(g, px, py, 8, 'violet', 0.5);
          setTextColor(art.nums.get(wrong.pos.fret)!, 'violet');
        }
      }

      // Free round: the last notes ring, notes outside the scale carry a cross and their name.
      if (phase === 'free') {
        for (const r of recent) {
          const zn = zoneAt.get(r.midi);
          if (zn && t - r.at < 700) ring(g, slotX(layout, zn.pos.fret), rowY(layout, zn.pos.string), 8 - Math.round((t - r.at) / 200), 'lime', 1 - (t - r.at) / 700);
        }
        crossed.forEach((c, k) => {
          if (!c.pos) return;
          const x = slotX(layout, c.pos.fret);
          const y = rowY(layout, c.pos.string);
          const age = t - c.at;
          const recentOne = k >= crossed.length - 3;
          cross(g, x, y, 'violet', recentOne ? 1 : 0.45);
          if (recentOne) {
            const n = names[crossed.length - 1 - k];
            placeText(n, x, y - 13, noteName(c.midi), { color: 'violet', align: 'center' });
            n.setAlpha(age < 2500 ? 1 : 0.5);
          }
        });
      }

      // Timed lane: the run scrolls toward the hit line.
      digits.forEach((d) => d.setVisible(false));
      if (timed) {
        panel(lane, LANE.left - 2, LANE.y, LANE.right - LANE.left + 4, LANE.h, 'water', 'deep', 0.8);
        const pulseB = 1 - Math.min(1, Math.max(0, beat - Math.floor(beat)) * 2.5);
        lane.fillStyle(paletteInt('cyan'), 0.1 + 0.16 * pulseB).fillRect(LANE.hitX - 6, LANE.y + 1, 13, LANE.h - 2);
        lane.fillStyle(paletteInt('cyan'), 1).fillRect(LANE.hitX, LANE.y + 1, 1, LANE.h - 2);
        exercise.targets.forEach((tg, i) => {
          const x = Math.round(LANE.hitX + ((tg.beat ?? 0) - beat) * LANE.ppb);
          if (x < LANE.left + 7 || x > LANE.right - 7) return;
          const tp = targetPos(i);
          const m = marks.get(i);
          const ringKey: PaletteKey = m ? JUDGEMENT_STYLE[m.judgement].color : i === cur ? 'foam' : 'abyss';
          const y = LANE.y + LANE.h / 2;
          lane.fillStyle(paletteInt(ringKey), 1).fillRect(x - 7, y - 6, 15, 12);
          lane.fillStyle(paletteInt(stringKey(tp.pos.string)), m ? (m.judgement === 'miss' ? 0.35 : 0.6) : 1).fillRect(x - 6, y - 5, 13, 10);
          if (digits[i]) {
            digits[i].setVisible(true);
            placeText(digits[i], x, y - 3, String(tp.pos.fret), { color: 'abyss', align: 'center' });
          }
        });
      }

      // The climber and its wall.
      holds.forEach((_h, i) => {
        const p = holdXY(i);
        const next = holdXY(i + 1);
        if (i < total - 1) wallG.lineStyle(1, paletteInt('dim'), 0.3).lineBetween(p.x, p.y, next.x, next.y);
      });
      holds.forEach((_h, i) => {
        const p = holdXY(i);
        const mk = marks.get(i);
        const got = !!mk && (mk.judgement === 'hit' || mk.judgement === 'early' || mk.judgement === 'late');
        const isCur = live && i === cur;
        const skipped = marks.get(i)?.judgement === 'miss';
        const col: PaletteKey = isCur ? 'lime' : got ? stringKey(targetPos(i).pos.string) : 'dim';
        const a = isCur ? 0.6 + 0.4 * Math.sin(t / 220) : got ? 1 : skipped ? 0.2 : 0.55;
        wallG.fillStyle(paletteInt('abyss'), 1).fillRect(p.x - 4, p.y - 3, 9, 6);
        wallG.fillStyle(paletteInt(col), a).fillRect(p.x - 3, p.y - 2, 7, 4);
      });
      const reachedIdx = phase === 'run' ? reached : total - 1;
      if (reachedIdx !== lastClimbIdx) {
        lastClimbIdx = reachedIdx;
        climberAt = t;
      }
      const dest = reachedIdx < 0 ? { x: holdXY(0).x, y: WALL.y + WALL.h - 8 } : holdXY(reachedIdx);
      if (climberX === 0) {
        climberX = dest.x;
        climberY = dest.y;
      }
      const ease = Math.min(1, (t - climberAt) / 260);
      climberX += (dest.x - climberX) * (0.25 + 0.2 * ease);
      climberY += (dest.y - climberY) * (0.25 + 0.2 * ease);
      climber.setPosition(Math.round(climberX), Math.round(climberY));

      // Texts.
      let m1 = '';
      let m1c: PaletteKey = 'amber';
      let s1 = '';
      let s1c: PaletteKey = 'foam';
      if (phase === 'run') {
        placeText(progress, W - 8, 26, `${Math.min(done, total)} / ${total}`, { color: 'dim', align: 'right' });
        if (live) {
          if (wrongOn && wrong) {
            m1 = wrong.hint;
            s1 = wrong.pos ? `Tocaste ${wrong.name}: traste ${wrong.pos.fret}` : `Tocaste ${wrong.name}: fuera del mástil mostrado`;
            s1c = 'violet';
          } else if (listening) {
            s1 = 'Escucha la escala';
            s1c = 'cyan';
          } else if (showName) {
            s1 = `Suena ${noteName(curMidi)}  ·  cuerda ${stringNumber(inst.id, curPos.string)}`;
            s1c = 'cyan';
          } else {
            s1 = timed ? 'Sin castigo: solo mide si vas pronto o tarde' : `Toca la nota que brilla: ${noteName(curMidi)}`;
            s1c = timed ? 'dim' : 'foam';
          }
          if (timed) {
            const age = t - flashAt;
            if (flash && age < 1100 && !wrongOn) {
              const st = JUDGEMENT_STYLE[flash.judgement];
              s1 = flash.judgement === 'miss' ? st.label : `${st.label}  ${fmtMs(flash.deltaMs)}`;
              s1c = st.color;
            }
          }
        } else if (timed && marks.size >= total) {
          m1 = 'FIN';
          m1c = 'cyan';
        }
      } else if (phase === 'offer') {
        placeText(progress, W - 8, 26, 'completa', { color: 'lime', align: 'right' });
        m1 = '¡ESCALA COMPLETA!';
        m1c = 'lime';
        s1 = 'Ronda libre: toca cualquier nota de la escala';
        s1c = 'cyan';
      } else {
        placeText(progress, W - 8, 26, `${log.visitedCount} / ${log.total}`, { color: 'lime', align: 'right' });
        if (freeMsg && t - freeMsg.at < 1300) {
          m1 = freeMsg.text;
          m1c = freeMsg.color;
        } else {
          m1 = 'RONDA LIBRE';
          m1c = 'cyan';
        }
        s1 = `Notas de la escala visitadas ${log.visitedCount} de ${log.total}   Fuera ${[...log.outside.values()].reduce((a, b) => a + b, 0)}`;
        s1c = log.complete ? 'lime' : 'foam';
      }
      if (timed && phase === 'run' && live && !m1 && beat < 0.6) {
        m1 = countMsg.text;
        m1c = countMsg.color;
      }
      placeText(msg, W / 2 + 14, MSG_Y, m1, { scale: 2, color: m1c, align: 'center' });
      placeText(sub, W / 2 + 14, SUB_Y, s1, { color: s1c, align: 'center' });

      hooks.climb = {
        phase,
        timed,
        index: cur,
        total,
        string: live ? curPos.string : -1,
        fret: live ? curPos.fret : -1,
        midi: live ? curMidi : -1,
        lit: litSet.size,
        scaleNotes: zone.length,
        scaleMidis: zoneMidis,
        roots: zone.filter((n) => isRoot(info, n.midi)).length,
        hint: wrongOn && wrong ? wrong.hint : '',
        wrongFret: wrongOn && wrong?.pos ? wrong.pos.fret : null,
        visited: log.visitedCount,
        outside: [...log.outside.keys()],
        plays: log.plays,
        msg: m1,
        sub: s1,
        climberHold: reachedIdx,
        listening: listening && step < total,
        over: phase !== 'run',
      };
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, redraw);
      offs.forEach((f) => f());
      hooks.climb = null;
    });

    hooks.judged = [];
    beginGame(this, data, { manual: true });
  }
}
