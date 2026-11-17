# MetalForge

Juego web para aprender guitarra y bajo con un instrumento real: el programa escucha por la entrada de
audio y puntúa. Es un plan de estudio hecho de minijuegos. Diseño completo en `docs/DISENO.md`; fases
de construcción y sus prompts en `docs/FASES.md`.

## Comandos

- `npm run dev` — servidor de desarrollo (puerto 5173)
- `npm test` — pruebas unitarias y banco de detección con umbrales
- `npm run test:dsp` — informe del detector y de la verificación de acordes (`scripts/bench-chords.ts`; añade `-- --verbose` para ver cada fallo)
- `npm run fixtures` — genera los WAV de `tests/fixtures` (no se versionan)
- `node scripts/play-tuner.cjs guitar|bass4|bass5 [url]` — abre el juego en Chromium con un WAV como micrófono,
  elige instrumento, va del salón al afinador con el teclado y muestra las notas oídas (con `npm run dev` en
  marcha; pasa la URL si usas otro puerto)
- `node scripts/shots.cjs [url]` — capturas de selector, salón, «Próximamente» y afinador en `test-results/`
  (1280x720 y 1920x1080)
- `node scripts/pulso-fake.cjs [url] [guitar|bass4|bass5]` — juega Pulso con la entrada falsa (`window.__metalforge.fake`):
  perfecta, 150 ms tarde y sin tocar; capturas en `test-results/`
- `node scripts/salto-fake.cjs [url] [guitar|bass4|bass5] [nivel]` — juega Salto con la entrada falsa: partida perfecta,
  150 ms tarde, una nota saltada (tropiezo) y en silencio (se acaban los corazones → reinicio más lento → resultados);
  comprueba que los obstáculos caen en su pulso y sale con código 1 si algo falla; capturas `test-results/salto-*`
- `node scripts/strings-fake.cjs [url] [guitar|bass4|bass5] [telar|portero]` — juega Telar y Portero con la entrada falsa: partidas
  perfectas (sin tiempo y a tempo), cuerdas equivocadas (pista y corrección), tecla de saltar, tarde y en silencio (goles →
  reinicio más lento → resultados); sale con código 1 si algo falla; capturas `test-results/telar-*` y `portero-*`
- `node scripts/frets-fake.cjs [url] [guitar|bass4|bass5] [nivelL] [nivelN]` — juega Luciérnagas (perfecta, con notas
  erróneas y salto) y Ninja (perfecta, trastes erróneos, en silencio → reinicio más lento) con la entrada falsa; sale con
  código 1 si algo falla; capturas `test-results/frets-*`. `npx tsx scripts/make-frets-wav.ts <wav>` +
  `node scripts/frets-audio.cjs <wav>` — Luciérnagas con las notas del ejercicio sintetizadas como micrófono
- `node scripts/scales-fake.cjs [url] [guitar|bass4|bass5] [nivelE] [nivelT] [climb|tower]` — juega Escalada (tirada perfecta,
  ronda libre, notas erróneas, nivel 10 a tempo) y Torre (perfecta con las dos salas de guardián, notas erróneas, en silencio →
  reinicio más lento → resultados, nivel 10) con la entrada falsa; sale con código 1 si algo falla; capturas
  `test-results/scales-*`. `npx tsx scripts/make-scales-wav.ts <wav>` + `node scripts/scales-audio.cjs <wav>` — Escalada con audio real
- `node scripts/chords-fake.cjs [url] [guitar|bass4|bass5] [forge|wizard|all]` — juega Forja (cuerda muda y nota extraña con su mensaje, acorde bueno,
  saltar, nivel 5 «un minuto de cambios» con tiempo virtual y mejor por pareja, nivel 10 a tempo) y Hechicero (perfecta con jefe, acordes
  equivocados/flojos, en silencio → reinicio más lento → resultados, nivel 10 a tempo) con la entrada falsa; en bajo toca las notas en orden;
  sale con código 1 si algo falla; capturas `test-results/chords-*`. `npx tsx scripts/make-chords-wav.ts <wav> correct|wrong [nivel]` +
  `node scripts/chords-audio.cjs <wav> [url] [nivel]` — Forja con rasgueos sintetizados (o con el vecino equivocado) como micrófono
- `node scripts/keys-rapid.cjs [url]` — ráfagas de teclas sin pausa en el salón y el selector de nivel: cada pulsación
  debe contar exactamente una vez
- `npx tsx scripts/make-calibration-wav.ts <wav> [lagMs]` y `node scripts/calibrate.cjs <wav> [url] [etiqueta]` — WAV de
  pulsaciones alineadas al metrónomo de calibración y medición con audio real; `scripts/audio-chain.cjs` recorre
  salón → Pulso con calibración automática y muestra los diagnósticos de audio
- `node scripts/course-fake.cjs [url] [guitar|bass4|bass5] [escenario ...]` — recorre el curso con un perfil NUEVO y la entrada falsa:
  `fresh` (selector → sondeo → salón con solo los primeros módulos → Salto bien jugado → resultados con el desbloqueo → Trastes encendido),
  `course`, `review` (repaso diario completo), `boss` (jefe de Ritmo), `turbo` (hasta perder, récord guardado), `settings` (desbloqueo
  manual y borrado) y `placement` (sondeo bien jugado); sale con código 1 si algo falla; capturas `test-results/curso-*`. Usa
  `scripts/course-lib.cjs` (`autoplay` juega Pulso, Salto, Luciérnagas y Ninja con la entrada falsa)
- Los demás scripts de navegador añaden `?curso=abierto` a la URL: abre todos los módulos y no ofrece el sondeo (si no, el salón nuevo
  tiene las máquinas apagadas)
- `npm run build` — comprobación de tipos y compilación

## Arquitectura

- `src/model/` — instrumentos, afinaciones, y `Exercise`/`Target`: la moneda común de todos los juegos.
  No depende de nada más.
- `src/detection/` — detección de ataques y tono. Funciones puras sobre buffers, sin Web Audio. `chord.ts` verifica acordes
  sin transcribirlos: con `setChordCandidates(required, contradicting)` el `Detector` emite, ~230 ms después de cada ataque, un
  evento `strum` con una fuerza 0..1 por nota candidata (espectro del rasgueo menos el de antes, solo armónicos no
  coincidentes con otras notas del acorde; cabecera de `chord.ts` = método, ventana y latencia, constantes en `STRUM_PARAMS`).
- `src/synth/` — síntesis de cuerda pulsada: audio de prueba y ejemplos sonoros dentro del juego.
- `src/audio/` — único sitio que toca la captura de Web Audio: `input.ts` (`startInput`), worklet `public/capture-worklet.js`
  y Web Worker `detector.worker.ts` que ejecuta el `Detector` (`blocks.ts`, puro). Los eventos llevan `time` en
  segundos del AudioContext (ver cabecera de `input.ts`). `setExpected(midis)` lleva al detector las notas que espera
  el ejercicio (lo llama `GameSession` al empezar y lo borra al cerrar; el afinador no pasa nada).
- `src/art/` — sprites como matrices de caracteres con leyenda de NOMBRES de la paleta (`sprites.ts`; `pixels.ts`
  los convierte a píxeles, puro y probado), fuente de mapa de bits 5x7 propia (`font.ts`, puro) y la parte
  Phaser: `textures.ts` (texturas y animaciones al arrancar) y `text.ts` (`drawText`: todo texto del juego pasa
  por aquí). Personajes 16x16, objetos e iconos 8x8, máquinas recreativas 24x40.
- `src/engine/` — Phaser 3 (320x180, zoom entero, sin suavizado): `game.ts`, fondo de acuario `aquarium.ts`
  (apagable; `energy` 0..1 lo anima; solo mueve el fondo, nunca el primer plano), `kit.ts` (ayudas de escena),
  `keyboardFix.ts` (Phaser 3.90 repartía varias veces las teclas pulsadas en un mismo fotograma; se instala en `createGame`) y
  `hooks.ts` (`window.__metalforge`: `heard`, `scene`, `instrument`, `selected`, `backgroundEffects`, `useFakeInput`, `fake`,
  `judged`, `results` (con `arcade` en los arcades), `salto`, `fireflies`, `ninja`, `telar`, `portero`, `climb`, `tower`,
  `calibration`, `audio`, `forge`, `wizard`, para automatizar).
- `src/scenes/` — escenas Phaser: `boot`, `picker` (primer arranque), `hub` (salón recreativo; las máquinas salen
  de la lista de `hubData.ts`), `soon` («Próximamente»), `tuner`, `modechoice` (Aprender/Practicar), `levelselect`,
  `results` (común; guarda las estrellas del nivel, muestra lo que desbloquea y ofrece «Siguiente paso») y `calibration` (tecla C en el salón).
  Curso: `course` (tecla U: módulos y pasos), `flow` (tarjeta, puente entre rondas y resultado combinado de un jefe, un repaso o Turbo),
  `placement` (sondeo de nivel: pantalla neutra sobre `GameSession`), `turbo` (elegir arcade y récords) y `settings` (tecla S: desbloqueo
  manual, repetir sondeo, borrar progreso con confirmación); `courseNav.ts` arranca pasos/repasos/jefes/Turbo y pasa cada resultado al
  flujo en marcha (`registry.get('flow')`). Juegos, por pareja aprender/arcade: `pulso`/`salto` (ritmo),
  `fireflies`/`ninja` (trastes; `fretsDraw.ts` dibuja el mástil de ambos), `telar`/`portero` (cuerdas; `stringsView.ts`
  son ayudas de dibujo de ambos) y `climb`/`tower` (escalas; `scalesDraw.ts`) y `forge`/`wizard` (acordes; `chordsDraw.ts` dibuja la caja de acorde, la runa y el mástil de bajo). Una escena nueva se registra en `main.ts`.
- `src/profile/` — perfil en IndexedDB tras la interfaz `KeyValueStorage` (`store.ts`; `idb.ts` real, `memory.ts`
  falsa para pruebas): instrumento, ajustes y un blob de progreso opaco por instrumento.
- `src/ui/` — `palette.ts` es la única fuente de colores (claves + `paletteInt`); `style.css` centra el lienzo.
- `scripts/` — banco de detección y pruebas en navegador.
- `src/exercises/` — generadores puros y deterministas por semilla (`generate(skill, {instrument, level 1..10, seed,
  length})`): ritmo, trastes, cuerdas, acordes y escalas. Cada nivel añade UNA dificultad; `itemId` estables.
  Las zonas (`fretsZone`, `stringsZone`, `scalesZone`) no repiten tono: se prueba en `tests/exercises.test.ts`.
- `src/scoring/` — `Judge`: consume `DetectorEvent` y un `Exercise` y da un `TargetResult` por objetivo (con
  ventanas acierto/pronto/tarde, más anchas en bajo). Los acordes pasan por `ChordVerifier`: con `spectralChords` el Judge
  espera el evento `strum` y `spectralChordVerifier` lo lee (todas las notas del acorde presentes y ninguna contradictoria;
  `ScoredTarget.chord` trae `missing`, `contradicted` y `cleanliness`); sin `strum` cae al verificador por tono.
  `chordSet.ts` deriva de la lista de acordes las notas contradictorias; umbrales en `CHORD_THRESHOLDS`. `summarize` da precisión, tendencia y estrellas.
- `src/course/` — el curso como datos, puro y probado en `tests/course.test.ts`: `data.ts` (módulos de guitarra y de bajo con sus pasos
  aprender/practicar/repasar/jefe, qué abre cada uno y las pruebas del sondeo), `blob.ts` (lo que el curso guarda en el blob de progreso:
  `levels` = mejores estrellas por juego+nivel, `course` = sondeo/ajustes manuales/pasos/afinador, `turbo` = récords; todo opcional y
  `migrateLegacy` convierte los `arcadeBest` de perfiles antiguos), `progress.ts` (`deriveCourse`: módulos abiertos, pasos hechos y
  siguiente paso, derivados del blob; `starsAt`, `bestFor`), `review.ts` (repaso: `planReview` elige con `pickForReview` los elementos más flojos
  y busca el nivel y la semilla cuyo ejercicio contiene más de ellos), `placement.ts` (qué prueba toca y qué desbloquea el resultado),
  `flow.ts` (jefe, repaso y Turbo como una cadena de juegos existentes: estado puro), `describe.ts` (texto neutro de un objetivo) y
  `service.ts` (lee y escribe el blob a través del `ProfileStore`).
- `src/progress/` — dominio por `itemId` con repetición espaciada (`updateMastery`, `pickForReview`,
  `toJSON`/`fromJSON`). El tiempo se inyecta; el guardado es de `src/profile/`.
- `src/game/` — motor de juego común (guía en `docs/JUEGOS.md`): `GameClock` (tiempo del AudioContext), `Metronome`,
  `GameSession` (entrada + reloj + `Exercise` + `Judge`, eventos tipados, guarda el dominio; con acordes pasa al detector las notas del acorde actual con `setChordCandidates`), `FakeInput`/`playFake` (`fakeChord` = rasgueo con evento `strum`)
  (sesiones sin audio), `launchGame`/`beginGame` (arranque y cierre de un juego), `registry.ts` (lista de juegos),
  matemática de calibración. Un minijuego nuevo es solo una escena que recibe `GameSceneData`.
  `salto/` guarda las reglas puras del arcade de ritmo: `state.ts` (`SaltoRun`: puntos, racha, corazones, rondas y
  reinicios) y `pace.ts` (`nextBpm`: tempo adaptativo dentro de la banda del nivel). `progressBlob.ts` guarda también
  el récord por juego+nivel (`arcadeBest`).
  `portero/` guarda las reglas puras del arcade de cuerdas: `state.ts` (`PorteroRun`), `pace.ts` (segundos por tiro o bpm
  adaptativos, bajo +20 %) y `shots.ts` (saltos de cuerda = tiros dobles, fases del aviso); `strings.ts` localiza la cuerda oída.
  Art de cuerdas en `src/art/sprites-strings.ts`.
  `frets/board.ts` es la disposición pura del mástil que comparten Luciérnagas y Ninja (`scenes/fretsDraw.ts` lo dibuja);
  `ninja/` guarda las reglas del arcade de trastes: `state.ts` (`NinjaRun`, `planWave`: escudos = objetivo repetido) y
  `pace.ts` (tiempo límite por enemigo, adaptativo). `hearNote.ts` suena una nota con el sintetizador (tecla H).
  `scales/` y `tower/` son de Escalada (`scenes/climb.ts`, aprender) y Torre (`scenes/tower.ts`, arcade; ganchos `climb` y `tower`):
  `scales/info.ts` lee escala/fundamental/posición del propio `Exercise` y trae la ruta de presas, los tramos de subida y bajada y
  `FreeLog` (notas visitadas del modo libre); `scales/board.ts` da el mástil de una posición (mismo mapa que Luciérnagas) e
  `improvisation` (la variante libre sin reloj); `scales/backing.ts` sintetiza el acompañamiento del jefe y «oír la escala».
  `tower/state.ts` (`TowerRun`: agua, corazones, racha, pisos), `pace.ts` (velocidad del agua, bajo −20 %) y `boss.ts` (`BossFight`).
  `scenes/scalesDraw.ts` dibuja el mástil de la posición; sprites en `src/art/sprites-scales.ts`.
  `chords/` (Forja y Hechicero): `names.ts` (`groupChords`: un acorde = un objetivo en guitarra o 3-4 notas en bajo), `diagram.ts` (caja de acorde
  y nota que falta → cuerda), `feedback.ts` (mensajes de `ScoredTarget.chord`; `CLEAN_THRESHOLD`), `rune.ts` (runas 9x9 por acorde), `hear.ts`;
  `forge/minute.ts` (`MinuteRound`: un minuto de cambios con el reloj de la sesión; mejor por pareja en la clave `changeBest` del blob);
  `wizard/state.ts` (`WizardRun`: críticos, bonus de cambio, fallos, llegada de enemigos, jefe, reinicio más lento; `TUNING`) y `pace.ts`.
  Sprites en `src/art/sprites-chords.ts`. `FakeControl.strum()` inyecta un rasgueo (cuerdas mudas, notas extrañas, fuerza).
- `tests/helpers/robot.ts` — jugador robot: sintetiza el ejercicio con errores inyectables (`wrongRate`, `wrongChordRate` = acorde vecino
  equivocado), lo pasa por el detector real y el `Judge` (acordes por la vía espectral).

## Reglas

- Cada habilidad tiene dos juegos sobre el mismo `Exercise`: uno sobrio para aprender (sin reloj ni
  castigo) y un arcade para practicar. Un juego solo decide cómo se dibuja y qué está en juego; la
  generación de ejercicios y la puntuación viven fuera y se prueban sin navegador.
- Todo cambio en `src/detection/` o en puntuación se valida con `npm run test:dsp` antes de darlo por bueno.
- El detector oye el tono, no la cuerda: un ejercicio no puede exigir distinguir dos posiciones que
  suenan igual. Los generadores deben usar notas únicas en su zona o aceptar las equivalentes.
- Guitarra, bajo de 4 y bajo de 5 funcionan en todos los juegos. Nada de "6 cuerdas" escrito a mano:
  se lee de `Instrument`.
- Diseño original: ni nombres, ni personajes, ni gráficos, ni música de juegos existentes.
- Estética: píxel de baja resolución, paleta de acuario nocturno, un color fijo por cuerda. Los
  efectos psicodélicos van en el fondo; objetivos y números de traste siempre nítidos.
- Código e identificadores en inglés; textos de interfaz y documentación en español.
- Playwright está instalado globalmente: en scripts se usa `require('playwright')` desde un `.cjs`.
