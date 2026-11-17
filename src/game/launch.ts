/**
 * Launcher: turns `GameParams` into a running game scene. Generates the exercise, offers calibration the
 * first time a timed game is played, opens the input once, builds the GameSession and starts the scene.
 */
import type Phaser from 'phaser';
import { hooks } from '../engine/hooks';
import { profileStore } from '../engine/kit';
import { generate } from '../exercises';
import { INSTRUMENTS } from '../model/instrument';
import { FakeInput, openAudioInput, type GameInput } from './input';
import { makeFakeControl } from './fakePlayer';
import { profileMasteryStore } from './progressBlob';
import { GAMES } from './registry';
import { GameSession } from './session';
import type { Exercise } from '../model/exercise';
import type { GameParams, GameSceneData } from './types';

export const CALIBRATION_SKIPPED = 'calibrationSkipped';

/**
 * Starts a round. Resolves to an error message (Spanish) when the input could not be opened, else null.
 * `from` is the scene calling (it must still be active when the input opens, otherwise the input closes).
 */
export async function launchGame(from: Phaser.Scene, params: GameParams): Promise<string | null> {
  const def = GAMES[params.gameId];
  if (!def?.scene) {
    from.scene.start('soon', { id: def?.cabinet });
    return null;
  }
  const store = profileStore(from);
  const instrument = store.profile.instrument ?? 'guitar';
  const seed = params.seed ?? (hooks.useFakeInput ? 1 : Math.floor(Math.random() * 1_000_000));
  const exercise = generate(def.skill, { instrument, level: params.level, seed, length: def.length });

  const needsCalibration = exercise.timed && store.profile.settings.latencyOffset === undefined && !hooks.useFakeInput && !from.registry.get(CALIBRATION_SKIPPED);
  if (needsCalibration) {
    from.scene.start('calibration', { next: { ...params, seed } });
    return null;
  }

  const opened = await openSession(from, exercise, true);
  if (typeof opened === 'string' || opened === null) return opened;
  const { session, fake } = opened;
  hooks.fake = fake ? makeFakeControl(session, fake) : null;
  hooks.judged = [];
  hooks.results = null;
  const data: GameSceneData = { params: { ...params, seed }, mode: def.mode, skill: def.skill, level: params.level, exercise, session };
  from.scene.start(def.scene, data);
  return null;
}

export interface OpenedSession {
  session: GameSession;
  /** The virtual input (when `window.__metalforge.useFakeInput` is set), else null. */
  fake: FakeInput | null;
}

/**
 * Opens the input (microphone, or the fake one for automation) and builds a GameSession for `exercise` with the
 * profile's calibration, metronome and mastery store. Resolves to an error message (Spanish) when the input could
 * not be opened, null when `from` is no longer the active scene (the input is closed again). `withMastery` = false
 * for rounds that must not count as study (see `GameSession.spawn`).
 */
export async function openSession(from: Phaser.Scene, exercise: Exercise, withMastery: boolean): Promise<OpenedSession | string | null> {
  const store = profileStore(from);
  const instrument = store.profile.instrument ?? 'guitar';
  let input: GameInput;
  let fake: FakeInput | null = null;
  try {
    if (hooks.useFakeInput) {
      fake = new FakeInput();
      input = fake;
    } else {
      input = await openAudioInput(INSTRUMENTS[instrument]);
    }
  } catch (err) {
    return `Sin entrada de audio: ${((err as Error).message ?? String(err)).slice(0, 40)}`;
  }
  if (!from.scene.isActive()) {
    input.stop();
    return null;
  }
  const settings = store.profile.settings;
  const session = new GameSession({
    exercise,
    input,
    latencyOffset: settings.latencyOffset ?? 0,
    metronome: { on: settings.metronomeOn ?? true, volume: settings.metronomeVolume ?? 0.6 },
    mastery: withMastery ? profileMasteryStore(store, instrument) : undefined,
  });
  return { session, fake };
}
