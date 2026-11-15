/** `npm run test:dsp` — runs the detector over synthetic guitar and bass audio and prints a report. */
import { runScenario, scenarios } from './bench-lib';

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
