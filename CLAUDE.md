# MetalForge

Juego web para aprender guitarra y bajo con un instrumento real: el programa escucha por la entrada de
audio y puntúa. Es un plan de estudio hecho de minijuegos. Diseño completo en `docs/DISENO.md`; fases
de construcción y sus prompts en `docs/FASES.md`.

## Comandos

- `npm run dev` — servidor de desarrollo (puerto 5173)
- `npm test` — pruebas unitarias y banco de detección con umbrales
- `npm run test:dsp` — informe del detector (añade `-- --verbose` para ver cada fallo)
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
- `node scripts/keys-rapid.cjs [url]` — ráfagas de teclas sin pausa en el salón y el selector de nivel: cada pulsación
  debe contar exactamente una vez
- `npx tsx scripts/make-calibration-wav.ts <wav> [lagMs]` y `node scripts/calibrate.cjs <wav> [url] [etiqueta]` — WAV de
  pulsaciones alineadas al metrónomo de calibración y medición con audio real; `scripts/audio-chain.cjs` recorre
  salón → Pulso con calibración automática y muestra los diagnósticos de audio
- `npm run build` — comprobación de tipos y compilación

## Arquitectura

- `src/model/` — instrumentos, afinaciones, y `Exercise`/`Target`: la moneda común de todos los juegos.
  No depende de nada más.
- `src/detection/` — detección de ataques y tono. Funciones puras sobre buffers, sin Web Audio.
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
  `judged`, `results` (con `arcade` en los arcades), `salto`, `telar`, `portero`, `calibration`, `audio`, para automatizar).
- `src/scenes/` — escenas Phaser: `boot`, `picker` (primer arranque), `hub` (salón recreativo; las máquinas salen
  de la lista de `hubData.ts`), `soon` («Próximamente»), `tuner`, `modechoice` (Aprender/Practicar), `levelselect`, `pulso`, `salto` (arcade de ritmo), `telar` (aprender cuerdas), `portero` (arcade de cuerdas; `stringsView.ts` son ayudas de dibujo de ambos), `results` (común) y
  `calibration` (tecla C en el salón). Una escena nueva se registra en `main.ts`.
- `src/profile/` — perfil en IndexedDB tras la interfaz `KeyValueStorage` (`store.ts`; `idb.ts` real, `memory.ts`
  falsa para pruebas): instrumento, ajustes y un blob de progreso opaco por instrumento.
- `src/ui/` — `palette.ts` es la única fuente de colores (claves + `paletteInt`); `style.css` centra el lienzo.
- `scripts/` — banco de detección y pruebas en navegador.
- `src/exercises/` — generadores puros y deterministas por semilla (`generate(skill, {instrument, level 1..10, seed,
  length})`): ritmo, trastes, cuerdas, acordes y escalas. Cada nivel añade UNA dificultad; `itemId` estables.
  Las zonas (`fretsZone`, `stringsZone`, `scalesZone`) no repiten tono: se prueba en `tests/exercises.test.ts`.
- `src/scoring/` — `Judge`: consume `DetectorEvent` y un `Exercise` y da un `TargetResult` por objetivo (con
  ventanas acierto/pronto/tarde, más anchas en bajo). Los acordes pasan por `ChordVerifier` (hoy por tono;
  aquí se enchufará el verificador espectral). `summarize` da precisión, tendencia y estrellas.
- `src/progress/` — dominio por `itemId` con repetición espaciada (`updateMastery`, `pickForReview`,
  `toJSON`/`fromJSON`). El tiempo se inyecta; el guardado es de `src/profile/`.
- `src/game/` — motor de juego común (guía en `docs/JUEGOS.md`): `GameClock` (tiempo del AudioContext), `Metronome`,
  `GameSession` (entrada + reloj + `Exercise` + `Judge`, eventos tipados, guarda el dominio), `FakeInput`/`playFake`
  (sesiones sin audio), `launchGame`/`beginGame` (arranque y cierre de un juego), `registry.ts` (lista de juegos),
  matemática de calibración. Un minijuego nuevo es solo una escena que recibe `GameSceneData`.
  `salto/` guarda las reglas puras del arcade de ritmo: `state.ts` (`SaltoRun`: puntos, racha, corazones, rondas y
  reinicios) y `pace.ts` (`nextBpm`: tempo adaptativo dentro de la banda del nivel). `progressBlob.ts` guarda también
  el récord por juego+nivel (`arcadeBest`).
  `portero/` guarda las reglas puras del arcade de cuerdas: `state.ts` (`PorteroRun`), `pace.ts` (segundos por tiro o bpm
  adaptativos, bajo +20 %) y `shots.ts` (saltos de cuerda = tiros dobles, fases del aviso); `strings.ts` localiza la cuerda oída.
  Art de cuerdas en `src/art/sprites-strings.ts`.
- `tests/helpers/robot.ts` — jugador robot: sintetiza el ejercicio con errores inyectables, lo pasa por el
  detector real y el `Judge`.

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
