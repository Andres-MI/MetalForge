import Phaser from 'phaser';
import { measureText } from '../art/font';
import { drawText } from '../art/text';
import { bossPassed, meanStars, type Flow, type PhaseOutcome } from '../course/flow';
import type { Change } from '../course/service';
import { load, turboTable } from '../course/service';
import { courseFor } from '../course/data';
import { summarizeReview } from '../course/review';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks, type FlowHook } from '../engine/hooks';
import { levelLabel } from '../exercises';
import { launchGame } from '../game/launch';
import { GAMES } from '../game/registry';
import { panel, star, STAR_SIZE } from '../game/ui';
import type { Mastery } from '../progress';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { addButtons, type ButtonSpec } from './buttons';
import { clearFlow, FLOW_BEFORE_KEY, getFlow, startStep, startTurbo } from './courseNav';

type Stage = 'intro' | 'between' | 'final';
interface FlowData {
  stage: Stage;
  last?: PhaseOutcome;
  change?: Awaited<ReturnType<typeof import('../course/service').recordFlow>>;
  /** Modules opened by any round of the flow. */
  opened?: string[];
}

/** Cut a text with a trailing dot so it fits `maxPx` pixels. */
export function fit(text: string, maxPx: number): string {
  if (measureText(text) <= maxPx) return text;
  let t = text;
  while (t.length > 1 && measureText(`${t}.`) > maxPx) t = t.slice(0, -1);
  return `${t.replace(/[\s,.;:·-]+$/, '')}.`;
}

/** Bridge screens of a flow (boss, review, Turbo): title card, between rounds and the combined result. */
export class FlowScene extends Phaser.Scene {
  private lines: string[] = [];

  constructor() {
    super('flow');
  }

  create(data: FlowData): void {
    enterScene(this, 'flow');
    addBackground(this);
    this.lines = [];
    const flow = getFlow(this);
    if (!flow) {
      this.scene.start('hub');
      return;
    }
    this.input.keyboard!.on('keydown-ESC', () => {
      clearFlow(this);
      this.scene.start('hub');
    });
    if (data.stage === 'intro') this.intro(flow);
    else if (data.stage === 'between') this.between(flow, data.last!);
    else this.final(flow, data);
    this.publish(flow, data);
  }

  private say(x: number, y: number, text: string, opts: Parameters<typeof drawText>[4] = {}): Phaser.GameObjects.BitmapText {
    this.lines.push(text);
    return drawText(this, x, y, text, opts);
  }

  private publish(flow: Flow, data: FlowData, extra: Partial<FlowHook> = {}): void {
    hooks.flow = {
      kind: flow.kind,
      id: flow.id,
      stage: data.stage,
      index: flow.index,
      phases: flow.phases.length,
      outcomes: flow.outcomes.map((o) => ({ gameId: o.gameId, level: o.level, stars: o.stars, score: o.score })),
      over: flow.over,
      passed: flow.kind === 'boss' && flow.over ? bossPassed(flow) : null,
      lines: this.lines,
      unlocked: data.opened ?? [],
      completed: data.change?.completed.map((m) => m.id) ?? [],
      rank: data.change?.rank ?? -1,
      record: data.change?.record ? { score: data.change.record.score, rounds: data.change.record.rounds } : null,
      ...extra,
    };
  }

  private phaseRow(i: number, y: number, flow: Flow, state: 'done' | 'now' | 'todo', h = 15): void {
    const p = flow.phases[i];
    const def = GAMES[p.gameId];
    const g = this.add.graphics();
    panel(g, 16, y, W - 32, h, state === 'now' ? def.accent : 'water', 'deep', state === 'todo' ? 0.5 : 0.85);
    const label = `${i + 1}  ${def.title} · nivel ${p.level}`;
    this.say(24, y + Math.round((h - 7) / 2), label, { color: state === 'todo' ? 'dim' : 'foam' });
    let x = 24 + measureText(label) + 8;
    const o = flow.outcomes[i];
    if (o) {
      const sg = this.add.graphics();
      for (let k = 0; k < 3; k++) star(sg, x + k * 10, y + Math.round((h - 9) / 2), 1, k < o.stars ? 'amber' : 'dim', k < o.stars ? 1 : 0.5);
      x += 34;
    }
    const mode = def.mode === 'learn' ? 'Aprender' : 'Practicar';
    const detail = flow.kind === 'review' ? (p.note ?? '') : levelLabel(def.skill, p.level, profileStore(this).profile.instrument ?? 'guitar');
    const note = detail ? `${mode} · ${detail}` : mode;
    this.say(W - 24, y + Math.round((h - 7) / 2), fit(note, W - 24 - x - 4), { color: state === 'todo' ? 'dim' : def.accent, align: 'right' });
  }

  // ---- title card -------------------------------------------------------------------------------------------
  private intro(flow: Flow): void {
    const accent = flow.accent;
    if (flow.kind === 'boss') {
      this.say(W / 2 + 1, 11, '¡JEFE!', { scale: 3, color: 'violet', align: 'center' });
      this.say(W / 2, 10, '¡JEFE!', { scale: 3, color: 'magenta', align: 'center' });
      this.say(W / 2, 38, flow.title, { scale: 2, color: accent, align: 'center' });
      this.say(W / 2, 57, `${flow.phases.length} fases · apruebas con ${flow.passStars ?? 2} estrellas de media`, { color: 'dim', align: 'center' });
      flow.phases.forEach((_, i) => this.phaseRow(i, 72 + i * 19, flow, 'todo'));
      this.add.sprite(26, 30, 'jelly').setOrigin(0.5, 0).play('jelly');
      this.add.sprite(W - 26, 30, 'jelly').setOrigin(0.5, 0).setFlipX(true).play('jelly');
    } else if (flow.kind === 'review') {
      const secs = Math.round((flow.phases.length * 90) / 60);
      this.say(W / 2, 10, flow.title, { scale: 2, color: accent, align: 'center' });
      this.say(W / 2, 30, `${flow.phases.length} rondas cortas · unos ${Math.max(2, secs)} minutos`, { color: 'foam', align: 'center' });
      this.say(W / 2, 42, 'Lo más flojo o lo que más tiempo llevas sin tocar.', { color: 'dim', align: 'center' });
      flow.phases.forEach((_, i) => this.phaseRow(i, 58 + i * 18, flow, i === 0 ? 'now' : 'todo'));
    } else {
      const def = GAMES[flow.turbo!.gameId];
      this.say(W / 2 + 1, 15, 'TURBO', { scale: 4, color: 'violet', align: 'center' });
      this.say(W / 2, 14, 'TURBO', { scale: 4, color: accent, align: 'center' });
      this.say(W / 2, 50, def.title.toUpperCase(), { scale: 2, color: 'foam', align: 'center' });
      this.say(W / 2, 72, `Empiezas en el nivel ${flow.turbo!.startLevel}.`, { color: 'foam', align: 'center' });
      this.say(W / 2, 84, 'Cada ronda sube un nivel y aprieta más.', { color: 'foam', align: 'center' });
      this.say(W / 2, 96, 'Con menos de 2 estrellas se acaba.', { color: 'dim', align: 'center' });
      void turboTable(profileStore(this), def.id).then((t) => {
        if (this.scene.isActive()) drawText(this, W / 2, 112, t.length ? `Récord: ${t[0].score} puntos · ${t[0].rounds} rondas` : 'Todavía no hay récord', { color: 'amber', align: 'center' });
      });
    }
    const go = () => void this.launch(flow);
    addButtons(this, [{ label: flow.kind === 'boss' ? '¡A pelear!' : 'Empezar', id: 'go', act: go }, { label: 'Salón', id: 'hub', act: () => this.leave() }], H - 34, { w: 84 });
    drawText(this, W / 2, H - 9, 'Enter empezar   Esc salón', { color: 'dim', align: 'center' });
  }

  private async launch(flow: Flow): Promise<void> {
    const p = flow.phases[flow.index];
    if (!p) return;
    const err = await launchGame(this, { gameId: p.gameId, level: p.level, seed: p.seed });
    if (err && this.scene.isActive()) drawText(this, W / 2, H - 40, err, { color: 'magenta', align: 'center' });
  }

  private leave(): void {
    clearFlow(this);
    this.scene.start('hub');
  }

  // ---- between rounds ---------------------------------------------------------------------------------------
  private between(flow: Flow, last: PhaseOutcome): void {
    const def = GAMES[last.gameId];
    const n = flow.outcomes.length;
    const head = flow.kind === 'boss' ? `FASE ${n} DE ${flow.phases.length} SUPERADA` : flow.kind === 'review' ? `RONDA ${n} DE ${flow.phases.length}` : `RONDA ${n} SUPERADA`;
    this.say(W / 2, 8, head, { scale: 2, color: flow.accent, align: 'center' });
    this.say(W / 2, 27, flow.title, { color: 'dim', align: 'center' });
    const sg = this.add.graphics();
    const sx = Math.round(W / 2 - (3 * STAR_SIZE * 3 + 16) / 2);
    for (let i = 0; i < 3; i++) star(sg, sx + i * (STAR_SIZE * 3 + 8), 40, 3, i < last.stars ? 'amber' : 'dim', i < last.stars ? 1 : 0.5);
    this.say(W / 2, 74, `${def.title} · nivel ${last.level}`, { color: 'foam', align: 'center' });
    const pct = Math.round(last.accuracy * 100);
    this.say(W / 2, 86, last.score !== null ? `${pct} % de precisión · ${last.score} puntos` : `${pct} % de precisión`, { color: pct >= 85 ? 'lime' : 'foam', align: 'center' });
    // Progress bar through the rounds.
    const bar = this.add.graphics();
    const total = flow.phases.length;
    const bw = Math.min(40, Math.floor(240 / total) - 2);
    const bx = Math.round(W / 2 - (total * (bw + 2)) / 2);
    for (let i = 0; i < total; i++) {
      const o = flow.outcomes[i];
      const color: PaletteKey = o ? (o.stars >= 2 ? 'lime' : 'amber') : i === flow.index ? 'cyan' : 'dim';
      bar.fillStyle(paletteInt(color), o || i === flow.index ? 1 : 0.5).fillRect(bx + i * (bw + 2), 102, bw, 6);
    }
    const next = flow.phases[flow.index];
    if (next) {
      const nd = GAMES[next.gameId];
      if (flow.kind === 'turbo') {
        this.say(W / 2, 118, `Siguiente ronda: nivel ${next.level}${next.level === last.level ? ' (se mantiene, aprieta el ritmo)' : ''}`, { color: 'amber', align: 'center' });
        this.say(W / 2, 130, 'Más difícil que la anterior.', { color: 'dim', align: 'center' });
      } else {
        this.say(W / 2, 118, `Siguiente: ${nd.title} · nivel ${next.level}`, { color: nd.accent, align: 'center' });
        this.say(W / 2, 130, fit(levelLabel(nd.skill, next.level, profileStore(this).profile.instrument ?? 'guitar'), W - 24), { color: 'dim', align: 'center' });
      }
    }
    addButtons(this, [{ label: 'Seguir', id: 'next', act: () => void this.launch(flow) }, { label: 'Salón', id: 'hub', act: () => this.leave() }], H - 34, { w: 84 });
    drawText(this, W / 2, H - 9, 'Enter seguir   Esc salón', { color: 'dim', align: 'center' });
  }

  // ---- combined result --------------------------------------------------------------------------------------
  private final(flow: Flow, data: FlowData): void {
    const opened = data.opened ?? [];
    if (flow.kind === 'boss') this.finalBoss(flow, data, opened);
    else if (flow.kind === 'review') this.finalReview(flow, data, opened);
    else this.finalTurbo(flow, data);
  }

  private async nextStepButtons(extra: ButtonSpec[], textY = H - 44, buttonsY = H - 34): Promise<void> {
    const l = await load(profileStore(this));
    if (!this.scene.isActive()) return;
    const specs: ButtonSpec[] = [...extra];
    if (l.state.next) {
      const next = l.state.next;
      specs.unshift({ label: 'Siguiente paso', id: 'step', act: () => void startStep(this, next.moduleId, next.stepId) });
      drawText(this, W / 2, textY, fit(`Siguiente: ${next.label}`, W - 24), { color: 'cyan', align: 'center' });
    }
    specs.push({ label: 'Salón', id: 'hub', act: () => this.leave() });
    addButtons(this, specs, buttonsY, { w: specs.length > 2 ? 96 : 100, h: 18 });
    hooks.flow = hooks.flow ? { ...hooks.flow, lines: [...this.lines, ...(l.state.next ? [`Siguiente: ${l.state.next.label}`] : [])] } : hooks.flow;
  }

  private unlockLines(opened: string[], change: Change | undefined, y: number): void {
    const titles = (ids: string[]) => ids.map((id) => profileStoreTitle(this, id));
    let yy = y;
    for (const m of change?.completed ?? []) {
      this.say(W / 2, yy, `¡Módulo ${m.title} completado!`, { color: 'amber', align: 'center' });
      yy += 11;
    }
    for (const t of titles(opened)) {
      this.say(W / 2, yy, `¡Módulo ${t} desbloqueado!`, { color: 'lime', align: 'center' });
      yy += 11;
    }
  }

  private finalBoss(flow: Flow, data: FlowData, opened: string[]): void {
    const won = bossPassed(flow);
    const mean = meanStars(flow);
    this.say(W / 2, 6, won ? 'JEFE VENCIDO' : 'EL JEFE SIGUE EN PIE', { scale: 2, color: won ? 'lime' : 'magenta', align: 'center' });
    this.say(W / 2, 24, flow.title, { color: 'dim', align: 'center' });
    const sg = this.add.graphics();
    const stars = Math.max(1, Math.round(mean));
    const sx = Math.round(W / 2 - (3 * STAR_SIZE * 2 + 12) / 2);
    for (let i = 0; i < 3; i++) star(sg, sx + i * (STAR_SIZE * 2 + 6), 33, 2, i < stars ? 'amber' : 'dim', i < stars ? 1 : 0.5);
    this.say(W / 2, 55, `Media ${mean.toFixed(1)} estrellas · necesitas ${(flow.passStars ?? 2).toFixed(1)}`, { color: won ? 'lime' : 'amber', align: 'center' });
    flow.phases.forEach((_, i) => this.phaseRow(i, 66 + i * 13, flow, 'done', 12));
    this.unlockLines(opened, data.change, 66 + flow.phases.length * 13 + 3);
    const mod = flow.moduleId;
    const again: ButtonSpec = { label: won ? 'Repetir jefe' : 'Otra vez', id: 'again', act: () => mod && void startStep(this, mod, 'boss') };
    void this.nextStepButtons([again], H - 46, H - 34);
  }

  private finalReview(flow: Flow, data: FlowData, opened: string[]): void {
    const mean = meanStars(flow);
    this.say(W / 2, 6, flow.id === 'daily' ? 'REPASO TERMINADO' : 'REPASO HECHO', { scale: 2, color: flow.accent, align: 'center' });
    this.say(W / 2, 24, `${flow.outcomes.length} rondas · media ${mean.toFixed(1)} estrellas`, { color: 'dim', align: 'center' });
    const sg = this.add.graphics();
    const stars = Math.max(1, Math.round(mean));
    const sx = Math.round(W / 2 - (3 * STAR_SIZE * 2 + 12) / 2);
    for (let i = 0; i < 3; i++) star(sg, sx + i * (STAR_SIZE * 2 + 6), 34, 2, i < stars ? 'amber' : 'dim', i < stars ? 1 : 0.5);
    flow.phases.forEach((_, i) => this.phaseRow(i, 56 + i * 12, flow, 'done', 11));
    const before = this.registry.get(FLOW_BEFORE_KEY) as Mastery | undefined;
    const y0 = 56 + flow.phases.length * 12 + 4;
    this.unlockLines(opened, data.change, y0 + 22);
    void load(profileStore(this)).then((l) => {
      if (!this.scene.isActive() || !before) return;
      const sum = summarizeReview(before, l.mastery, flow.items ?? [], Date.now());
      this.say(W / 2, y0, `${sum.improved} de ${sum.items} elementos han mejorado`, { color: sum.improved > 0 ? 'lime' : 'foam', align: 'center' });
      this.say(W / 2, y0 + 11, `Fuerza media ${Math.round(sum.meanBefore * 100)} % → ${Math.round(sum.meanAfter * 100)} %`, { color: 'cyan', align: 'center' });
      hooks.flow = hooks.flow ? { ...hooks.flow, lines: [...this.lines] } : hooks.flow;
    });
    void this.nextStepButtons([], H - 33, H - 22);
  }

  private finalTurbo(flow: Flow, data: FlowData): void {
    const rec = data.change?.record;
    const def = GAMES[flow.turbo!.gameId];
    this.say(W / 2, 8, 'FIN DE TURBO', { scale: 2, color: flow.accent, align: 'center' });
    this.say(W / 2, 27, `${def.title} · empezaste en el nivel ${flow.turbo!.startLevel}`, { color: 'dim', align: 'center' });
    this.say(W / 2, 42, `${rec?.rounds ?? 0} rondas superadas`, { scale: 2, color: 'foam', align: 'center' });
    this.say(W / 2, 62, `${rec?.score ?? 0} PUNTOS`, { scale: 2, color: 'amber', align: 'center' });
    const rank = data.change?.rank ?? -1;
    this.say(W / 2, 82, rank === 0 ? '¡NUEVO RÉCORD!' : rank > 0 ? `Entras en el puesto ${rank + 1}` : 'No entra en la tabla', { color: rank === 0 ? 'lime' : rank > 0 ? 'cyan' : 'dim', align: 'center' });
    void turboTable(profileStore(this), def.id).then((t) => {
      if (!this.scene.isActive()) return;
      t.forEach((r, i) => {
        const mine = i === rank;
        this.say(W / 2, 96 + i * 9, `${i + 1}.  ${String(r.score).padStart(6, ' ')} puntos   ${r.rounds} rondas   nivel ${r.startLevel}-${r.level}`, { color: mine ? 'lime' : 'dim', align: 'center' });
      });
      hooks.flow = hooks.flow ? { ...hooks.flow, lines: [...this.lines] } : hooks.flow;
    });
    addButtons(this, [{ label: 'Otra vez', id: 'again', act: () => void startTurbo(this, def.id, flow.turbo!.startLevel) }, { label: 'Otro arcade', id: 'pick', act: () => this.scene.start('turbo') }, { label: 'Salón', id: 'hub', act: () => this.leave() }], H - 34, { w: 84 });
  }
}

/** Module title by id for the current instrument's course. */
function profileStoreTitle(scene: Phaser.Scene, id: string): string {
  const inst = profileStore(scene).profile.instrument ?? 'guitar';
  return courseFor(inst).modules.find((m) => m.id === id)?.title ?? id;
}
