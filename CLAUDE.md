# Abisal

Juego web para aprender guitarra y bajo con un instrumento real: el programa escucha por la entrada de
audio y puntúa. Es un plan de estudio hecho de minijuegos. Diseño completo en `docs/DISENO.md`; fases
de construcción y sus prompts en `docs/FASES.md`. "Abisal" es un nombre provisional.

## Comandos

- `npm run dev` — servidor de desarrollo (puerto 5173)
- `npm test` — pruebas unitarias y banco de detección con umbrales
- `npm run test:dsp` — informe del detector (añade `-- --verbose` para ver cada fallo)
- `npm run fixtures` — genera los WAV de `tests/fixtures` (no se versionan)
- `node scripts/play-tuner.cjs guitar|bass4|bass5` — abre el afinador en Chromium con un WAV como micrófono
- `npm run build` — comprobación de tipos y compilación

## Arquitectura

- `src/model/` — instrumentos, afinaciones, y `Exercise`/`Target`: la moneda común de todos los juegos.
  No depende de nada más.
- `src/detection/` — detección de ataques y tono. Funciones puras sobre buffers, sin Web Audio.
- `src/synth/` — síntesis de cuerda pulsada: audio de prueba y ejemplos sonoros dentro del juego.
- `src/audio/` — único sitio que toca la captura de Web Audio.
- `src/ui/` — pantallas. `palette.ts` es la única fuente de colores.
- `scripts/` — banco de detección y pruebas en navegador.

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
