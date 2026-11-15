/** Scene-side helper every minigame calls once its scene is drawn. */
import Phaser from 'phaser';
import { hooks } from '../engine/hooks';
import { setEnergy } from '../engine/kit';
import type { GameSceneData } from './types';
import type { GameSession } from './session';

/** Extra block the results scene shows for arcade (practice) games. */
export interface ArcadeResults {
  score: number;
  bestCombo: number;
  /** Best score stored for this game+level BEFORE this run (0 when none). */
  previousBest: number;
  newBest: boolean;
}

/** Data the shared results scene receives. */
export interface ResultsData {
  params: GameSceneData['params'];
  mode: GameSceneData['mode'];
  level: number;
  skill: GameSceneData['skill'];
  summary: NonNullable<GameSession['summary']>;
  /** Only arcade games; results without it look exactly as before. */
  arcade?: ArcadeResults;
}

/** Mirrors a summary into `window.__metalforge.results`. */
export function mirrorResults(summary: ResultsData['summary'], arcade?: ArcadeResults): void {
  hooks.results = {
    stars: summary.stars,
    accuracy: summary.accuracy,
    tendency: summary.tendency,
    meanMs: summary.meanTimingError === null ? null : summary.meanTimingError * 1000,
    strays: summary.strays,
    hits: summary.hits,
    early: summary.early,
    late: summary.late,
    miss: summary.miss,
    ...(arcade ? { arcade } : {}),
  };
}

/** Opens the shared results scene after a short delay (so the last feedback is seen). */
export function showResults(scene: Phaser.Scene, next: ResultsData, delayMs = 1200): void {
  mirrorResults(next.summary, next.arcade);
  scene.time.delayedCall(delayMs, () => {
    if (scene.scene.isActive()) scene.scene.start('results', next);
  });
}

/** The aquarium energy follows the plucks of a session. Returns the unsubscribe function. */
export function trackEnergy(scene: Phaser.Scene, session: GameSession): () => void {
  return session.on('heard', (e) => {
    if (e.type === 'onset') scene.registry.set(ENERGY_PEAK, Math.min(1, e.rms * 4));
  });
}
const ENERGY_PEAK = 'energyPeak';

export interface BeginOptions {
  /** Milliseconds between the last target and the results scene (to see the last feedback). Default 1200. */
  resultsDelayMs?: number;
  /**
   * Multi-round games (Salto): the scene mirrors judgements into the hooks and opens the results itself (with
   * `showResults`) when its last round ends. `beginGame` then only starts the first session, follows the input
   * energy, handles Esc and closes the input on shutdown.
   */
  manual?: boolean;
}

/**
 * Wires the session to the scene and starts it:
 *  - closes the input when the scene shuts down;
 *  - Esc leaves to the hall;
 *  - mirrors judgements and the final summary into `window.__metalforge`;
 *  - the aquarium energy follows the input level;
 *  - when the round finishes, goes to the 'results' scene.
 * Call it LAST in `create()`.
 */
export function beginGame(scene: Phaser.Scene, data: GameSceneData, opts: BeginOptions = {}): GameSession {
  const { session } = data;
  hooks.judged = [];
  hooks.results = null;
  let energy = 0;
  scene.registry.set(ENERGY_PEAK, 0);
  const offs = [trackEnergy(scene, session)];
  if (!opts.manual) {
    offs.push(
      session.on('targetResolved', (r) => hooks.judged.push({ index: r.index, judgement: r.judgement, deltaMs: Math.round(r.delta * 1000) })),
      session.on('finished', (summary) => {
        showResults(scene, { params: data.params, mode: data.mode, level: data.level, skill: data.skill, summary }, opts.resultsDelayMs ?? 1200);
      }),
    );
  }
  const decay = () => {
    const peak = (scene.registry.get(ENERGY_PEAK) as number | undefined) ?? 0;
    if (peak > 0) {
      energy = peak;
      scene.registry.set(ENERGY_PEAK, 0);
    }
    energy *= 0.94;
    setEnergy(scene, energy);
    const l = session.input.info?.();
    if (l) hooks.audio = { lagMs: l.lag * 1000, baseLatencyMs: l.base * 1000, outputLatencyMs: l.output * 1000, captureStart: session.input.captureStart() };
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, decay);
  scene.input.keyboard?.on('keydown-ESC', () => scene.scene.start('hub'));
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    offs.forEach((f) => f());
    scene.events.off(Phaser.Scenes.Events.UPDATE, decay);
    session.dispose();
    hooks.fake = null;
    hooks.audio = null;
    setEnergy(scene, 0);
  });
  session.start();
  return session;
}
