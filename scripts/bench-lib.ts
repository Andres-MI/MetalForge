/** Shared by the DSP bench and the tests: build a scenario, run the detector, compare with the truth. */
import { Detector, type DetectorEvent } from '../src/detection/detector';
import { INSTRUMENTS, pitchRange, type InstrumentId } from '../src/model/instrument';
import { renderPlucks, rng, type PluckedNote } from '../src/synth/karplus';

export const SR = 48000;

export interface Scenario {
  name: string;
  instrument: InstrumentId;
  notes: PluckedNote[];
  noise?: number;
  duration: number;
}

export interface Report {
  name: string;
  expected: number;
  found: number;
  recall: number;
  precision: number;
  onsetRecall: number;
  /** Milliseconds between the pluck and the moment the note was identified. */
  latencyMs: { mean: number; p95: number };
  /** Mean absolute timing error of the reported pluck time, ms. */
  timingMs: number;
  missed: string[];
  extra: string[];
}

/** Random notes across the whole neck, each on a random string, at a fixed rate. */
export function randomWalk(instrument: InstrumentId, count: number, gap: number, seed: number, maxFret = 12): PluckedNote[] {
  const inst = INSTRUMENTS[instrument];
  const rand = rng(seed);
  const notes: PluckedNote[] = [];
  for (let i = 0; i < count; i++) {
    const string = Math.floor(rand() * inst.openStrings.length);
    const fret = Math.floor(rand() * (maxFret + 1));
    notes.push({ time: 0.3 + i * gap, midi: inst.openStrings[string] + fret, string });
  }
  return notes;
}

/** Same notes, all on one "string", so each note cuts the previous one. */
export function monophonic(notes: PluckedNote[]): PluckedNote[] {
  return notes.map((n) => ({ ...n, string: 0 }));
}

export function runScenario(sc: Scenario, chunk = 128): { report: Report; events: DetectorEvent[] } {
  const inst = INSTRUMENTS[sc.instrument];
  const audio = renderPlucks(sc.notes, { sampleRate: SR, duration: sc.duration, noise: sc.noise, seed: 7 });
  const det = new Detector({ sampleRate: SR, windowSize: inst.windowSize, ...pitchRange(inst) });
  const events: DetectorEvent[] = [];
  for (let i = 0; i < audio.length; i += chunk) events.push(...det.process(audio.subarray(i, i + chunk)));
  return { report: compare(sc, events), events };
}

export function compare(sc: Scenario, events: DetectorEvent[]): Report {
  const tol = 0.06;
  const found = events.filter((e) => e.type === 'note');
  const onsets = events.filter((e) => e.type === 'onset');
  const used = new Set<number>();
  const latencies: number[] = [];
  const timing: number[] = [];
  const missed: string[] = [];
  for (const n of sc.notes) {
    const i = found.findIndex((e, k) => !used.has(k) && e.type === 'note' && e.midi === n.midi && Math.abs(e.time - n.time) <= tol);
    if (i >= 0) {
      const e = found[i];
      used.add(i);
      if (e.type === 'note') {
        latencies.push((e.emittedAt - n.time) * 1000);
        timing.push(Math.abs(e.time - n.time) * 1000);
      }
    } else {
      const near = found.find((e) => Math.abs(e.time - n.time) <= tol);
      missed.push(`t=${n.time.toFixed(2)}s midi ${n.midi} (cuerda ${n.string})${near && near.type === 'note' ? ` -> oído ${near.midi}` : ''}`);
    }
  }
  const extra = found.filter((_, k) => !used.has(k)).map((e) => (e.type === 'note' ? `t=${e.time.toFixed(2)}s midi ${e.midi}` : ''));
  const onsetHits = sc.notes.filter((n) => onsets.some((o) => Math.abs(o.time - n.time) <= tol)).length;
  latencies.sort((a, b) => a - b);
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  return {
    name: sc.name,
    expected: sc.notes.length,
    found: found.length,
    recall: used.size / sc.notes.length,
    precision: found.length ? used.size / found.length : 1,
    onsetRecall: onsetHits / sc.notes.length,
    latencyMs: { mean: mean(latencies), p95: latencies[Math.floor(latencies.length * 0.95)] ?? NaN },
    timingMs: mean(timing),
    missed,
    extra,
  };
}

export function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (const instrument of ['guitar', 'bass4', 'bass5'] as InstrumentId[]) {
    const base = randomWalk(instrument, 60, 0.4, 11);
    const dur = 0.3 + 60 * 0.4 + 1;
    out.push({ name: `${instrument} · notas sueltas, limpio`, instrument, notes: monophonic(base), duration: dur });
    out.push({ name: `${instrument} · notas sueltas, con ruido`, instrument, notes: monophonic(base), noise: 0.01, duration: dur });
    out.push({
      name: `${instrument} · desafinado ±15 cents`,
      instrument,
      notes: monophonic(base).map((n, i) => ({ ...n, detune: i % 2 ? 15 : -15 })),
      duration: dur,
    });
    out.push({ name: `${instrument} · cuerdas que siguen sonando`, instrument, notes: base, duration: dur });
    const fast = randomWalk(instrument, 80, 0.15, 23);
    out.push({ name: `${instrument} · rápido (400 notas/min)`, instrument, notes: monophonic(fast), duration: 0.3 + 80 * 0.15 + 1 });
    const inst = INSTRUMENTS[instrument];
    const repeated = Array.from({ length: 24 }, (_, i) => ({ time: 0.3 + i * 0.3, midi: inst.openStrings[1] + 3, string: 0 }));
    out.push({ name: `${instrument} · misma nota repetida`, instrument, notes: repeated, duration: 0.3 + 24 * 0.3 + 1 });
  }
  return out;
}
