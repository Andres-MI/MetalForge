# Cómo añadir un minijuego

El motor de juego común vive en `src/game/`. Un minijuego es SOLO una escena Phaser que dibuja; el
ejercicio, el reloj, el metrónomo, la entrada de audio, el juez, el dominio y los resultados ya están hechos.

## Piezas (todas en `src/game/`)

- `clock.ts` `GameClock`: reloj único en segundos del AudioContext. Beat 0 = primer golpe del ejercicio;
  la cuenta atrás ocupa los beats -4..-1. `beatToTime`, `timeToBeat`, `pause/resume`. Nunca `setTimeout`/`Date`.
- `metronome.ts` `Metronome`: clics programados por adelantado, acento en el 1, volumen y silencio.
- `session.ts` `GameSession`: une entrada + reloj + `Exercise` + `Judge`. Eventos tipados con `session.on(...)`:
  `countIn(beat)`, `go()`, `targetResolved(ScoredTarget)`, `wrongAttempt(ScoredTarget)`, `stray()`,
  `heard(DetectorEvent)`, `finished(RoundSummary, results)`. Al terminar actualiza el dominio (`updateMastery`)
  y lo guarda en el blob de progreso del instrumento. `session.beat()` da el beat actual para dibujar.
- `input.ts`: `openAudioInput` (micrófono real, detector en un Web Worker) y `FakeInput` (tiempo virtual
  para pruebas y automatización).
- `launch.ts` `launchGame(scene, {gameId, level, seed?})`: genera el ejercicio, ofrece calibrar la primera vez,
  abre la entrada y arranca la escena del juego con un `GameSceneData` (`types.ts`).
- `scene.ts` `beginGame(scene, data)`: cierra la entrada al salir, Esc vuelve al salón, rellena
  `window.__metalforge`, mueve la energía del acuario y, al terminar, abre la escena `results`.

## Pasos

1. Crea `src/scenes/<juego>.ts` con `create(data: GameSceneData)`. Dibuja con `drawText`, `addBackground`
   y la paleta. En `update` (o con un listener de `UPDATE`, quitándolo en `SHUTDOWN`) lee `data.session.beat()`
   para posicionar todo: `x = lineaDeGolpeo + (target.beat - beat) * pixelesPorBeat`.
2. Suscríbete a `data.session.on('targetResolved', r => ...)` para el feedback: `r.judgement`
   (`hit|early|late|wrong|miss`) y `r.delta` en segundos (ya corregido con la latencia calibrada).
   En ejercicios sin reloj llega también `wrongAttempt` y `r.heard` dice qué sonó.
3. Llama a `beginGame(this, data)` AL FINAL de `create`. No navegues tú al terminar.
4. Registra la escena en `src/main.ts` y el juego en `src/game/registry.ts`
   (`{ id, title, skill, mode: 'learn'|'practice', scene: 'clave', accent, length, cabinet }`).
   `cabinet` es el `id` de la máquina en `src/scenes/hubData.ts`; con un juego `learn` y otro `practice`
   en la misma máquina, el salón muestra la elección Aprender/Practicar y luego el selector de nivel.
5. Los niveles 1..10 y sus nombres salen de `generate(skill, ...)` y `levelLabel(skill, nivel)`.
   Tu juego no genera ni puntúa nada por su cuenta.

## Reglas

- Aprender (`learn`): sin vidas ni fallo. Practicar (`practice`): puede haber presión, pero siempre acaba con
  `finished` y la pantalla de resultados (Repetir / Siguiente nivel / Volver al salón) es la común.
- Todo el texto de interfaz en español y con `drawText`; 320x180; colores solo de `src/ui/palette.ts`.
- Funciona en guitarra, bajo 4 y bajo 5: lee el instrumento de `data.exercise.instrument`.

## Probar sin audio

- Node: `new GameSession({ exercise, input: new FakeInput(), ... })` y `playFake(session, fake, { offsetMs, skip })`
  (ver `tests/game.test.ts`).
- Navegador: `window.__metalforge.useFakeInput = true` antes de entrar al juego; después
  `window.__metalforge.fake.play({ offsetMs: 150, untilBeat: 3 })`, `fake.advanceToBeat(-2)`, `fake.advance(s)`.
  `__metalforge.judged` y `__metalforge.results` dicen qué pasó. Ejemplo: `scripts/pulso-fake.cjs`.
- Audio real: `scripts/calibrate.cjs` y `scripts/play-tuner.cjs` con un WAV como micrófono. El WAV empieza al
  abrir la captura, no al arrancar el reloj del juego: no esperes precisión de milisegundos.

## Tiempo de la detección

Los eventos del detector llevan `time` en segundos del AudioContext (la misma escala que `currentTime`).
El AudioWorklet marca cada bloque con `currentFrame`; el Worker suma `primerCuadro / sampleRate`. Lo que
queda es la latencia física (salida + entrada + hábito del jugador), que mide la calibración y el juez resta.
