/**
 * The common game interface. A minigame is a Phaser scene that receives `GameSceneData` and follows the
 * contract below. Everything else (exercise, scoring, clock, input, mastery, results) is already done.
 * See docs/JUEGOS.md for the step-by-step guide.
 */
import type { Exercise, SkillId } from '../model/exercise';
import type { PaletteKey } from '../ui/palette';
import type { GameSession } from './session';

/** learn = sober, no fail state; practice = arcade, pressure allowed. */
export type GameMode = 'learn' | 'practice';

/** What identifies one round to play. Results uses it to offer "Repetir" / "Siguiente nivel". */
export interface GameParams {
  /** Key in `GAMES` (src/game/registry.ts), e.g. 'pulso'. */
  gameId: string;
  level: number;
  /** Same seed = same exercise. Omit for a random one. */
  seed?: number;
}

/** What a game scene receives as the `data` of `scene.start(def.scene, data)` (built by `launchGame`). */
export interface GameSceneData {
  params: GameParams;
  mode: GameMode;
  skill: SkillId;
  level: number;
  exercise: Exercise;
  /** Created but NOT started: call `beginGame(scene, data)` (starts it) once your scene is drawn. */
  session: GameSession;
}

/** One entry of the game registry. */
export interface GameDef {
  id: string;
  /** Spanish name for titles ("Pulso"). */
  title: string;
  skill: SkillId;
  mode: GameMode;
  /** Scene key of the game, or null while it is not built (the hub then shows "Próximamente"). */
  scene: string | null;
  accent: PaletteKey;
  /** Approximate number of targets/beats to generate (see GenerateOptions.length). */
  length: number;
  /** Hub cabinet id this game belongs to (HUB_GAMES[].id). */
  cabinet: string;
}

/**
 * Contract of a game scene:
 *  1. `create(data: GameSceneData)`: draw everything, subscribe to `data.session.on(...)`, read
 *     `data.session.beat()` in `update()` to animate, then call `beginGame(this, data)` LAST.
 *  2. Use `drawText` for all text, `addBackground` for the aquarium, the palette for colours.
 *  3. Never time anything with setTimeout/Date: musical time is `session.beat()` / `session.clock`.
 *  4. Do not navigate on finish: `beginGame` shows the shared results scene when `finished` fires.
 *  5. `learn` games have no fail state; `practice` games may, but must still end with `finished`.
 */
export type GameSceneCreate = (data: GameSceneData) => void;
