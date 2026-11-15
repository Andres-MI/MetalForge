# Fases de construcción

Una sesión nueva por fase. Pega el prompt, pide primero el plan y corrígelo antes de dejar escribir
código. Cada fase se cierra con `npm test`, los agentes indicados, `/code-review` y un commit.

| Fase | Contenido | Agentes al cerrar | Estado |
|---|---|---|---|
| 0 | Base, modelo, detección, banco de pruebas, afinador | dsp-tester | Hecha |
| 1 | Motor de píxel, salón recreativo, perfil y calibración | pixel-artist, playtester | Hecha |
| 2 | Motor de ejercicios, puntuación y dominio | pedagogo, dsp-tester | Hecha |
| 3 | Ritmo: Pulso y Salto | playtester, pedagogo | Pulso hecho; Salto en curso |
| 4 | Trastes: Luciérnagas y Ninja | playtester, pedagogo, pixel-artist | |
| 5 | Cuerdas: Telar y Portero | playtester, pedagogo, pixel-artist | |
| 6 | Acordes: Forja y Hechicero | dsp-tester, playtester, pixel-artist | |
| 7 | Escalas: Escalada y Torre | playtester, pedagogo, pixel-artist | |
| 8 | Curso: módulos, sondeo, repaso diario, jefes, Turbo | pedagogo, playtester | |
| 9 | Segunda tanda de juegos | todos | |
| 10 | Canciones desde Guitar Pro | dsp-tester, playtester | |

## Cómo se reparte el trabajo

La sesión principal dirige: decide el alcance de cada fase, escribe los encargos, revisa lo que
vuelve, lo integra en `main` y lo sube. La construcción la hacen agentes con un modelo más ligero
(Sonnet), cada uno en su copia de trabajo de git para no pisarse.

| Tipo de tarea | Quién |
|---|---|
| Diseño de la fase, contratos entre módulos, revisión e integración | Sesión principal |
| Detección de audio y verificación de acordes (lo más delicado) | Sesión principal, con `dsp-tester` |
| Motor visual, escenas, juegos concretos | Agente Sonnet por juego o por pareja |
| Generadores, puntuación y progreso (lógica pura con pruebas) | Agente Sonnet |
| Sprites | `pixel-artist` (Sonnet) |
| Pruebas en navegador y revisión de capturas | `playtester` (Sonnet) |
| Revisión didáctica | `pedagogo` (Sonnet) |

Reglas para lanzar agentes en paralelo:

- Cada agente recibe una lista de carpetas que son suyas y otra que no puede tocar.
- Los contratos compartidos (`src/model/`, la interfaz común de juego) se fijan antes de repartir.
- Cada agente usa su propio puerto para el servidor de desarrollo.
- Ningún agente sube a GitHub: hace commits en su rama y la sesión principal integra.
- Todo encargo termina con criterios comprobables y un informe con cifras reales.

## Qué se puede hacer a la vez

| Bloque | Fases | Depende de |
|---|---|---|
| A | 1 (motor visual) y 2 (ejercicios y puntuación) en paralelo | 0 |
| B | 3 (ritmo): fija la interfaz común de juego | A |
| C | 4 (trastes), 5 (cuerdas) y 7 (escalas) en paralelo, un agente por pareja | B |
| D | 6 (acordes): primero la detección, luego la pareja de juegos | B |
| E | 8 (curso completo) | C y D |
| F | 9 (segunda tanda), cuatro parejas en paralelo | E |
| G | 10 (canciones) | E |

## Desglose por fase

**Fase 1** — motor Phaser a 320x180; sistema de sprites y fuente de mapa de bits; fondo de acuario;
salón con máquinas; perfil en IndexedDB; afinador como escena. Queda para un segundo paso: mover la
detección a un Web Worker y la pantalla de calibración (necesita el metrónomo de la fase 3).

**Fase 2** — generadores de las cinco habilidades de la primera tanda con diez niveles; juez con y
sin reloj; dominio con repetición espaciada; jugador robot para probar de extremo a extremo.

**Fase 3** — reloj de juego y metrónomo; interfaz común de juego; Pulso; Salto; pantalla de
resultados; calibración de latencia; detección en un Web Worker.

**Fases 4, 5 y 7** — por pareja: escena de aprender, escena arcade, sprites, dificultad adaptable,
prueba en navegador con un WAV bueno y otro malo, revisión didáctica.

**Fase 6** — verificación espectral de acordes y ampliación del banco; después Forja y Hechicero;
versión de bajo con fundamental, quinta y octava.

**Fase 8** — curso como datos para guitarra y bajo; sondeo de nivel; repaso diario; jefes; Turbo;
salón que refleja el progreso.

Prueba tú con el instrumento real al cerrar las fases 0, 3, 6 y 7: la síntesis no sustituye a una
guitarra de verdad. Lo que notes ("la sexta al aire falla", "el Fa con cejilla no puntúa") es el
mejor prompt de corrección.

## Fase 1 — Motor de píxel, salón y perfil

```text
Lee CLAUDE.md y docs/DISENO.md. Añade Phaser 3 como motor 2D. Monta la base visual:
- Resolución interna 320x180 escalada por enteros, sin suavizado.
- Sistema de sprites en src/art/: matrices de caracteres con leyenda a nombres de la paleta,
  convertidas a texturas al arrancar. Una fuente de mapa de bits propia de 5x7 con mayúsculas,
  minúsculas, números, tildes y ñ.
- Fondo "acuario nocturno" reutilizable: degradado, partículas lentas y un shader de ondulación y
  ciclo de color cuya intensidad sube con el volumen de entrada. Debe poder desactivarse en ajustes.
- Escena del salón recreativo: una máquina por juego de docs/DISENO.md, apagadas las bloqueadas,
  navegación con teclado y ratón.
- Perfil guardado en IndexedDB: instrumento (guitarra, bajo 4, bajo 5) y progreso por instrumento.
- Mueve la detección a un Web Worker para no competir con el dibujado, y convierte el afinador en
  una escena del motor.
- Pantalla de calibración: el jugador toca sobre un metrónomo y se mide la latencia total, que se
  guarda en el perfil.
Usa pixel-artist para los sprites y playtester para revisar las capturas con los tres instrumentos.
Hecho cuando: el salón se ve bien a 1280x720 y 1920x1080, el afinador sigue reconociendo las
cuerdas al aire del fixture y la calibración da un valor estable con un WAV de clics.
```

## Fase 2 — Motor de ejercicios, puntuación y dominio

```text
Implementa, sin interfaz y con pruebas en Node:
- src/exercises/: un generador por habilidad de la primera tanda (ritmo, trastes, cuerdas, acordes,
  escalas) que produzca un Exercise a partir de instrumento, nivel y semilla. Niveles del 1 al 10
  donde cada uno añade una sola dificultad. Los de trastes y cuerdas no pueden pedir notas que
  suenen igual en dos sitios de la zona usada.
- src/scoring/: un juez que recibe los eventos del detector y un Exercise y devuelve un
  TargetResult por objetivo. Dos modos: con reloj (ventanas de acierto, temprano, tarde) y sin reloj
  (tiempo de reacción). Aplica la latencia calibrada. Ventanas más anchas para bajo.
- src/progress/: dominio por itemId con repetición espaciada (sube con aciertos, baja con fallos y
  con el tiempo), estrellas por ronda y selección de elementos para el repaso.
- Un "jugador robot" de pruebas: convierte un Exercise en audio con src/synth, con errores
  inyectables (notas equivocadas, retraso, notas omitidas), lo pasa por el detector y el juez.
Hecho cuando: el robot perfecto saca más del 95 %, el robot con 150 ms de retraso cae a "tarde" y el
robot con un 30 % de notas equivocadas saca alrededor del 70 %. Pasa pedagogo sobre los generadores.
```

## Fase 3 — Ritmo: Pulso y Salto

```text
Construye la primera pareja de juegos sobre el generador de ritmo y el juez con reloj.
- Reloj de juego único basado en el tiempo de audio, y un metrónomo con sonido propio.
- Pulso (aprender): el patrón recorre la pantalla hacia una línea de golpeo; sin castigo; muestra si
  cada golpe fue temprano, a tiempo o tarde y por cuánto.
- Salto (practicar): carrera lateral donde el terreno se genera a partir del patrón rítmico. Tocar a
  tiempo salta el obstáculo; fallar tropieza y frena. La velocidad se adapta al acierto reciente;
  perder reinicia la ronda más lenta.
- Pantalla de resultados común: estrellas, precisión, tendencia a adelantarse o retrasarse.
- Define aquí la interfaz común de juego (cargar Exercise, recibir juicios, terminar ronda) que
  usarán todos los demás.
Personaje y obstáculos originales, con pixel-artist. Cierra con playtester usando un WAV perfecto y
otro retrasado.
```

## Fase 4 — Trastes: Luciérnagas y Ninja

```text
Segunda pareja, sobre el generador de trastes y el juez sin reloj.
- Luciérnagas (aprender): mástil horizontal de una cuerda; se enciende una luz en un traste y espera
  a que el jugador lo toque. Si toca otro, indica si debe subir o bajar.
- Ninja (practicar): un puente con posiciones numeradas como los trastes. Aparecen enemigos en una
  posición con una cuenta atrás; tocar ese traste lanza al ninja allí. Combos por aciertos seguidos,
  enemigos con escudo que piden dos golpes, saltos largos en niveles altos.
- Progresión: trastes 0 a 5 de una cuerda, luego hasta el 12, luego dos cuerdas.
Funciona igual en guitarra y bajo. Cierra con playtester y pedagogo.
```

## Fase 5 — Cuerdas: Telar y Portero

```text
Tercera pareja, sobre el generador de cuerdas.
- Telar (aprender): las cuerdas del instrumento como hilos con su color; se ilumina una secuencia y
  se toca en orden, primero cuerdas contiguas y luego con saltos.
- Portero (practicar): tanda de penaltis; cada cuerda es una altura de la portería. El disparo se ve
  venir y hay que tocar la cuerda a tiempo. Disparos dobles para el salto de cuerda; las rachas
  suben la velocidad.
- Progresión: cuerdas al aire, luego con un traste fijo, luego patrones de púa alterna.
El número de alturas sale del instrumento (4, 5 o 6). Cierra con playtester y pedagogo.
```

## Fase 6 — Acordes: Forja y Hechicero

```text
Primero la detección, después los juegos.
- src/detection/chord.ts: verificación de acorde esperado. Dado un conjunto de notas, medir la
  energía en sus fundamentales y armónicos frente al resto del espectro tras un ataque, y devolver
  una puntuación de 0 a 1 y qué notas parecen faltar. Amplía el banco con acordes sintetizados:
  correctos, con una cuerda apagada, y el acorde equivocado más parecido (Mi menor frente a Mi mayor,
  La menor frente a Do).
- Forja (aprender): diagrama del acorde; el jugador rasguea hasta que la puntuación supera el umbral.
  Después, cambios entre dos acordes contando los limpios en un minuto.
- Hechicero (practicar): enemigos con la runa de un acorde; tocarlo lanza el hechizo. Acorde limpio,
  golpe crítico; cambios rápidos, combo.
- Bajo: en lugar del acorde, fundamental, quinta y octava en secuencia.
- Progresión: Mi menor, La menor, Mi, La, Re, Sol, Do; después Fa con cejilla y acordes de quinta.
Hecho cuando dsp-tester confirma más del 90 % de acordes correctos aceptados y más del 90 % de
equivocados rechazados. Si no se llega, baja la exigencia a fundamental más dos notas.
```

## Fase 7 — Escalas: Escalada y Torre

```text
Quinta pareja, sobre el generador de escalas.
- Escalada (aprender): la digitación de la escala dibujada en el mástil; se sube y se baja nota a
  nota. Después, modo libre: cualquier nota de la escala vale y las de fuera se marcan.
- Torre (practicar): plataformas verticales; cada nota correcta en orden es un salto. En las salas
  de jefe suena una base de acompañamiento sintetizada y el jugador improvisa: solo hacen daño las
  notas de la escala, y repetir siempre la misma hace menos.
- Progresión: pentatónica menor en primera posición, escala mayor, secuencias por terceras, otras
  posiciones.
Cierra con playtester y pedagogo.
```

## Fase 8 — Curso completo

```text
Une los juegos en el plan de estudio de docs/DISENO.md.
- Definición del curso como datos: módulos, sus pasos (aprender, practicar, repasar, jefe) y qué
  desbloquea cada uno. Una versión para guitarra y otra para bajo.
- Sondeo de nivel opcional de cinco minutos que desbloquea módulos, y desbloqueo manual en ajustes.
- Repaso diario: sesión de 5 a 10 minutos con los elementos elegidos por src/progress, mezclando juegos.
- Un jefe por módulo: enfrentamiento en fases que alterna las mecánicas del módulo.
- Turbo: modo supervivencia sobre cualquier arcade, con tabla de récords.
- El salón refleja el progreso: máquinas encendidas, mejores marcas y parpadeo en lo no repasado.
Cierra con pedagogo revisando el orden completo y playtester recorriendo el curso con un perfil nuevo.
```

## Fase 9 — Segunda tanda

Una sesión por pareja, con la misma plantilla que las fases 3 a 7:

- **Compás y Concierto** — rasgueo con acordes; necesita la verificación de acordes de la fase 6.
- **Diana y Cohete** — seguimiento continuo del tono para bends y slides; añadir detección de ligados
  y medirla en el banco antes de usarla para puntuar.
- **Eco y Contraseña** — frases generadas dentro de una escala y reproducidas con `src/synth`.
- **Cartógrafo y Código** — nombres de notas; aceptar cualquier octava salvo que se pida la cuerda.

## Fase 10 — Canciones

```text
Añade canciones desde archivos Guitar Pro con alphaTab: convertir la pista elegida en un Exercise con
reloj, reproducirla con el sintetizador del archivo y jugarla con una vista de notas que se acercan,
reutilizando el juez, el dominio y los modos de bucle y velocidad. Los archivos los carga el jugador;
el repositorio no incluye ninguno.
```
