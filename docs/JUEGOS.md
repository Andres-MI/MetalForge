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

## Arcades de varias rondas (ejemplo: Salto)

Un arcade puede encadenar varias rondas (cada una un `Exercise` con su tempo) sobre la MISMA entrada:

- `beginGame(this, data, { manual: true })` arranca la primera sesión y se ocupa de Esc, la energía del fondo y de
  cerrar la entrada; la escena rellena `hooks.judged` y abre los resultados ella misma con `showResults(...)`.
- Entre rondas: `session.release()` (para la ronda sin cerrar la entrada) y `session = session.spawn(ejercicio)`
  (misma entrada, latencia, dominio y metrónomo); después `trackEnergy(this, session)` y `session.start()`.
  Hazlo en `update`, no dentro de un evento de la sesión. Solo la última sesión se cierra con `dispose()`.
- Lo que está en juego (puntos, racha, vidas, tempo adaptativo) va en un módulo puro y probado, fuera de la escena:
  ver `src/game/salto/state.ts` y `pace.ts`, y `tests/salto.test.ts`.
- Resultados: pasa `arcade: { score, bestCombo, previousBest, newBest }` en `ResultsData`; la pantalla común añade la
  línea de puntos y récord. El récord por juego+nivel se guarda con `saveArcadeBest` (clave `arcadeBest` del blob de
  progreso del instrumento, junto a `mastery`).
- Perder no devuelve al menú: en Salto, sin corazones la ronda se repite más lenta («Otra vez, más despacio»);
  tras 3 reinicios la partida termina en resultados.

## Ejemplo sin reloj en el arcade (Portero)

Un arcade puede usar un ejercicio SIN reloj: Portero (niveles 1-6 de cuerdas) pone su propio límite por tiro con el
tiempo de la sesión (`session.clock.now()`, nunca `Date`); al agotarse llama a `session.skipCurrent()` (cuenta como fallo).
Con reloj (niveles 7+) coloca los tiros con `session.beat()`. Reglas en `src/game/portero/` y `tests/portero.test.ts`.
`FakeControl.pluckNote(midi)` inyecta una nota concreta, útil para los ejercicios sin reloj.
## Ejercicios sin reloj (ejemplo: Luciérnagas y Ninja)

- Con `exercise.timed === false` el `Judge` espera al jugador: `wrongAttempt` llega en cada nota equivocada (`r.heard`) y
  `session.skipCurrent()` da el objetivo por perdido (`miss`) y muestra el siguiente. `GameSession` no lleva reloj de ritmo:
  usa `session.input.now()` si el juego necesita tiempo propio.
- Un arcade sin reloj pone su propio límite por objetivo en un módulo puro con el tiempo inyectado (`src/game/ninja/state.ts`,
  `pace.ts`, `tests/ninja.test.ts`). Un objetivo que pide dos golpes se pasa al `Judge` como dos objetivos seguidos con la
  misma nota (`planWave`).
- La disposición del mástil (`src/game/frets/board.ts`) es pura y la usan los dos juegos: misma posición horizontal para cada traste.
- Probar: `fake.pluck(midi)` mete una nota en el instante virtual actual (avanza ~0,1 s para que se oiga);
  `__metalforge.fireflies` / `__metalforge.ninja` dan el objetivo vivo (`midi`, traste, cuerda). Ver `scripts/frets-fake.cjs`.

## Escalas (ejemplo: Escalada y Torre)

- La variante libre (`generate('scales', { free: true })`, objetivos `anyOf`) se pasa por `improvisation(free, bpm?)`
  (`src/game/scales/board.ts`): mismas notas y posición pero sin reloj, también en el nivel 10. Con un reloj de metrónomo (`bpm`)
  el compás de la sala de jefe sale de `session.beat()`; el sonido de acompañamiento se programa en `session.clock.beat0Time`.
- Una ronda que no debe contar como dominio (ronda libre, sala de jefe) se arranca con
  `session.spawn(ejercicio, { metronome: { on: false }, mastery: undefined })`.
- Con `exercise.timed === false` el metrónomo de la sesión sigue sonando a 60 bpm si la entrada es real: un juego sin reloj
  llama a `session.metronome.setMuted(true)` antes de `beginGame` (Escalada y Torre lo hacen).
- Escalada usa `beginGame(..., { manual: true })` para ofrecer la ronda libre tras la tirada ordenada y abre los resultados con
  el resumen de la tirada ordenada. Torre encadena pisos y salas de jefe con `release`/`spawn` desde `update` (cola `pending`).

## Notas esperadas

`GameSession.start()` llama a `input.setExpected(midis)` con las notas del ejercicio (`note` → su midi, `anyOf` y
`chord` → sus midis, `attack`/`pitchClass` → ninguna) y `dispose()` las borra. El detector solo las usa como último
recurso cuando un ataque queda tapado por cuerdas que siguen sonando. Un juego no tiene que hacer nada.

## Reglas

- Aprender (`learn`): sin vidas ni fallo. Practicar (`practice`): puede haber presión, pero siempre acaba con
  `finished` y la pantalla de resultados (Repetir / Siguiente nivel / Volver al salón) es la común.
- Todo el texto de interfaz en español y con `drawText`; 320x180; colores solo de `src/ui/palette.ts`.
- Funciona en guitarra, bajo 4 y bajo 5: lee el instrumento de `data.exercise.instrument`.

## Probar sin audio

- Node: `new GameSession({ exercise, input: new FakeInput(), ... })` y `playFake(session, fake, { offsetMs, skip })`
  (ver `tests/game.test.ts`).
- Navegador (Salto: `scripts/salto-fake.cjs`; Telar y Portero: `scripts/strings-fake.cjs`; en juegos de varias rondas `fake` apunta siempre a la ronda en curso
  y `__metalforge.salto` da ronda, corazones, puntos, pose y posición de los obstáculos).
- Navegador: `window.__metalforge.useFakeInput = true` antes de entrar al juego; después
  `window.__metalforge.fake.play({ offsetMs: 150, untilBeat: 3 })`, `fake.advanceToBeat(-2)`, `fake.advance(s)`.
  `__metalforge.judged` y `__metalforge.results` dicen qué pasó. Ejemplo: `scripts/pulso-fake.cjs`.
- Audio real: `scripts/calibrate.cjs` y `scripts/play-tuner.cjs` con un WAV como micrófono. El WAV empieza al
  abrir la captura, no al arrancar el reloj del juego: no esperes precisión de milisegundos.

## Tiempo de la detección

Los eventos del detector llevan `time` en segundos del AudioContext (la misma escala que `currentTime`).
El AudioWorklet marca cada bloque con `currentFrame`; el Worker suma `primerCuadro / sampleRate`. Lo que
queda es la latencia física (salida + entrada + hábito del jugador), que mide la calibración y el juez resta.
