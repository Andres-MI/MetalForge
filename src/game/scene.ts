/** Scene-side helper every minigame calls once its scene is drawn. */
import Phaser from 'phaser';
import { hooks } from '../engine/hooks';
import { setEnergy } from '../engine/kit';
import type { GameSceneData } from './types';
import type { GameSession } from './session';

/** Data the shared results scene receives. */
export interface ResultsData {
  params: GameSceneData['params'];
  mode: GameSceneData['mode'];
  level: number;
  skill: GameSceneData['skill'];
  summary: NonNullable<GameSession['summary']>;
}

export interface BeginOptions {
  /** Milliseconds between the last target and the results scene (to see the last feedback). Default 1200. */
  resultsDelayMs?: number;
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
  const offs = [
    session.on('targetResolved', (r) => hooks.judged.push({ index: r.index, judgement: r.judgement, deltaMs: Math.round(r.delta * 1000) })),
    session.on('heard', (e) => {
      if (e.type === 'onset') energy = Math.min(1, e.rms * 4);
    }),
    session.on('finished', (summary) => {
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
      };
      const next: ResultsData = { params: data.params, mode: data.mode, level: data.level, skill: data.skill, summary };
      scene.time.delayedCall(opts.resultsDelayMs ?? 1200, () => {
        if (scene.scene.isActive()) scene.scene.start('results', next);
      });
    }),
  ];
  const decay = () => {
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
