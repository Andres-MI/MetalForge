/** `npm run test:dsp` — runs the detector over synthetic guitar and bass audio and prints a report. */
import { runChordBench, runScenario, scenarios } from './bench-lib';

const verbose = process.argv.includes('--verbose');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rows = scenarios().map((sc) => runScenario(sc).report);

console.log('escenario'.padEnd(44), 'notas', 'recall ', 'precis.', 'ataques', 'lat.media', 'lat.p95', 'error t.');
for (const r of rows) {
  console.log(
    r.name.padEnd(44),
    String(r.expected).padStart(5),
    pct(r.recall).padStart(7),
    pct(r.precision).padStart(7),
    pct(r.onsetRecall).padStart(7),
    `${r.latencyMs.mean.toFixed(0)} ms`.padStart(9),
    `${r.latencyMs.p95.toFixed(0)} ms`.padStart(7),
    `${r.timingMs.toFixed(1)} ms`.padStart(8),
  );
  if (verbose || r.recall < 0.95) {
    r.missed.slice(0, 8).forEach((m) => console.log('    falta:', m));
    r.extra.slice(0, 8).forEach((m) => console.log('    sobra:', m));
  }
}

// ---- Acordes: se verifica el acorde esperado contra rasgueos sintéticos (ver src/detection/chord.ts) ----
console.log('\nacordes (guitarra, rasgueos de todas las cuerdas con 8-15 ms entre ellas)');
const chords = runChordBench();
const of = (n: number, d: number) => (d ? pct(n / d) : '-');
console.log(
  'acorde'.padEnd(6),
  'bien aceptado'.padEnd(15),
  'mal rechazado'.padEnd(15),
  'cuerda muda rechazada'.padEnd(23),
  'nota hallada (sin octava)'.padEnd(27),
  'nota hallada (con octava)'.padEnd(27),
  'lat.media',
  'lat.máx',
);
const t = { c: [0, 0], w: [0, 0], rej: [0, 0], uniq: [0, 0], dbl: [0, 0], lat: 0 };
for (const r of chords.rows) {
  const m = r.muted;
  console.log(
    r.chord.padEnd(6),
    `${of(r.correct.accepted, r.correct.n)} (${r.correct.n})`.padEnd(15),
    `${of(r.wrong.rejected, r.wrong.n)} (${r.wrong.n})`.padEnd(15),
    `${of(m.rejected, m.n)} (${m.n})`.padEnd(23),
    `${of(m.identifiedUnique, m.nUnique)} (${m.nUnique})`.padEnd(27),
    `${of(m.identifiedDoubled, m.nDoubled)} (${m.nDoubled})`.padEnd(27),
    `${r.latency.mean.toFixed(0)} ms`.padStart(9),
    `${r.latency.max.toFixed(0)} ms`.padStart(8),
  );
  t.c[0] += r.correct.accepted;
  t.c[1] += r.correct.n;
  t.w[0] += r.wrong.rejected;
  t.w[1] += r.wrong.n;
  t.rej[0] += m.rejected;
  t.rej[1] += m.n;
  t.uniq[0] += m.identifiedUnique;
  t.uniq[1] += m.nUnique;
  t.dbl[0] += m.identifiedDoubled;
  t.dbl[1] += m.nDoubled;
  t.lat = Math.max(t.lat, r.latency.max);
}
console.log(
  'total'.padEnd(6),
  `${of(t.c[0], t.c[1])} (${t.c[1]})`.padEnd(15),
  `${of(t.w[0], t.w[1])} (${t.w[1]})`.padEnd(15),
  `${of(t.rej[0], t.rej[1])} (${t.rej[1]})`.padEnd(23),
  `${of(t.uniq[0], t.uniq[1])} (${t.uniq[1]})`.padEnd(27),
  `${of(t.dbl[0], t.dbl[1])} (${t.dbl[1]})`.padEnd(27),
  '         ',
  `${t.lat.toFixed(0)} ms`.padStart(8),
);
if (verbose) {
  for (const o of chords.outcomes) {
    const k = o.trial;
    const ok = k.kind === 'correct' ? o.analysis?.verdict === 'ok' : k.kind === 'wrong' ? o.analysis?.verdict === 'wrong' : true;
    if (ok) continue;
    const s = o.strengths ? Object.entries(o.strengths).map(([n, v]) => `${n}:${v.toFixed(2)}`).join(' ') : 'sin evento strum';
    console.log(`    fallo: ${k.kind} ${k.chord}${k.kind === 'wrong' ? ` <- ${k.played}` : ''} (${k.variant}) ${s}`);
  }
}
