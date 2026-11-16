# Diseño del juego

## Idea

Un plan de estudio de guitarra y bajo en el que cada lección es un juego. El jugador toca su
instrumento real; el programa escucha y puntúa.

## Estructura del curso

Cada **módulo** trabaja una habilidad en tres pasos y una prueba:

1. **Aprender** — juego sobrio, sin reloj ni penalización, con el diagrama del mástil a la vista.
2. **Practicar** — juego arcade con presión de tiempo y puntuación de 1 a 3 estrellas.
3. **Repasar** — rondas cortas que mezclan este módulo con los anteriores.
4. **Jefe** — enfrentamiento en varias fases que combina las mecánicas del módulo.

El programa guarda el **dominio por elemento** (cada traste, cada cambio de acorde, cada patrón) y
arma un **repaso diario** de 5 a 10 minutos con lo más flojo o lo más olvidado.

**Nivel de partida:** por defecto desde cero. Hay un sondeo opcional de cinco minutos que desbloquea
lo que ya dominas, y cualquier módulo se puede abrir a mano desde ajustes.

**Instrumentos:** guitarra, bajo de 4 y bajo de 5. Se elige al crear el perfil y cada uno tiene su
progreso.

## Juegos

| Habilidad | Aprender | Practicar (arcade) | Tanda |
|---|---|---|---|
| Ritmo | Pulso | Salto | 1 |
| Trastes en una cuerda | Luciérnagas | Ninja | 1 |
| Cambio y salto de cuerda | Telar | Portero | 1 |
| Acordes y cambios | Forja | Hechicero | 1 |
| Escalas | Escalada | Torre | 1 |
| Rasgueo con acordes | Compás | Concierto | 2 |
| Bends, slides, ligados | Diana | Cohete | 2 |
| Oído | Eco | Contraseña | 2 |
| Notas del mástil | Cartógrafo | Código | 2 |
| Velocidad | — | Turbo (supervivencia de cualquier arcade) | 1 |

### Modos de aprender

- **Pulso:** un patrón rítmico recorre la pantalla; tocas cualquier nota en cada golpe.
- **Luciérnagas:** se encienden luces sobre trastes de una cuerda; tocas ese traste.
- **Telar:** los hilos son las cuerdas; se ilumina un patrón y lo tocas en orden.
- **Forja:** formas el acorde y rasgueas hasta que suena limpio; después, cambios entre dos acordes.
- **Escalada:** subes una pared tocando la escala en orden; después, modo libre dentro de la escala.
- **Compás:** progresiones de acordes con un patrón de rasgueo.
- **Diana:** ves la curva de tu tono y la llevas hasta la línea objetivo.
- **Eco:** el juego toca una frase corta y la repites.
- **Cartógrafo:** te pide una nota en una cuerda; al acertar se revela el mapa del mástil.

### Arcades

- **Salto:** carrera sin fin; el personaje salta los obstáculos solo si tocas a tiempo. El patrón
  rítmico es el dibujo del terreno.
- **Ninja:** un puente con posiciones numeradas como los trastes. Los enemigos aparecen en una
  posición y tocar ese traste lanza al ninja allí. Los enemigos con escudo piden dos golpes; los
  saltos largos entrenan cambios de posición.
- **Portero:** tanda de penaltis; cada cuerda es una altura de la portería. Los disparos dobles son
  los saltos de cuerda. Las rachas suben la velocidad.
- **Hechicero:** cada acorde es un hechizo. Los enemigos llevan la runa del acorde que los vence; un
  acorde limpio es golpe crítico y los cambios rápidos hacen combo.
- **Torre:** plataformas; cada nota de la escala en orden es un salto al piso siguiente. En las salas
  de jefe improvisas y solo hacen daño las notas de la escala.
- **Concierto:** el rasgueo a tiempo llena la energía del público; los cambios de acorde disparan las
  luces y la sala crece del garaje al estadio.
- **Cohete:** la altura de tu tono es la altura de una nave que cruza una cueva.
- **Contraseña:** mazmorra de puertas; cada guardián pita una melodía y la repites para abrir.
- **Código:** como un juego de mecanografía con notas; los enemigos bajan con el nombre de una nota.
- **Turbo:** cualquier arcade en bucle con el tempo subiendo hasta que caes; guarda el récord.

### Reglas para que lo arcade no estropee el aprendizaje

- La presión de tiempo solo existe en Practicar.
- La velocidad de los enemigos se adapta al acierto reciente.
- Perder una ronda la reinicia más lenta; no devuelve al menú.
- La puntuación premia la limpieza antes que la velocidad.

## Bajo

- Los juegos de cuerdas y trastes se ajustan solos al número de cuerdas.
- Forja y Hechicero piden fundamental, quinta y octava en lugar del acorde completo.
- Compás y Concierto pasan a ser encajar un patrón de bajo con un bombo.
- Las ventanas de acierto son algo más amplias: las notas graves tardan más en reconocerse.

## Aspecto

- Píxel de baja resolución escalado en limpio; sprites pequeños con pocos fotogramas, generados
  desde matrices en código y sustituibles.
- Paleta de acuario nocturno (`src/ui/palette.ts`): fondo negro azulado; cian, magenta y violeta como
  luces; verde lima para avisos. Un color fijo por cuerda en todos los juegos.
- Toque psicodélico en el fondo: resplandor, ciclos de color y una ondulación suave que responde a lo
  que tocas. Objetivos y números de traste nunca se deforman.
- Menú principal: un salón recreativo a oscuras iluminado como un acuario. Cada juego es una máquina
  que se enciende al desbloquearlo y muestra la mejor marca; lo que lleva tiempo sin repasar parpadea.

## Límites de la detección

- Se oye el tono, no la cuerda ni el traste.
- Los acordes se comprueban contra lo esperado; no se transcriben. Se miden ~230 ms tras el rasgueo; una cuerda silenciada cuya nota es la octava de otra que suena no se puede detectar (si hiciera falta: «fundamental más dos notas basta»). Medido solo con cuerdas sintéticas.
- Bends y slides se siguen bien; los ligados son dudosos; el palm mute queda fuera.

## Etapa 2 (después del curso)

Canciones importadas desde Guitar Pro, tocadas sobre la pista sintetizada del archivo.
