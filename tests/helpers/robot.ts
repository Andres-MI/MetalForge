/**
 * Robot player: turns an Exercise into audio (Karplus-Strong), with injectable mistakes, runs it through
 * the real Detector and the Judge, and returns the summary.
 *
 * Mistakes are applied to an EXACT number of targets (round(rate * n), chosen with the seed) so a test
 * of "30% wrong" measures 30%, not a lucky or unlucky draw.
 */
import { Detector, type DetectorEvent } from '../../src/detection/detector';
import type { Exercise, Target } from '../../src/model/exercise';
import { INSTRUMENTS, midiAt, pitchRange, positionsFor } from '../../src/model/instrument';
import { Judge, type JudgeOptions } from '../../src/scoring/judge';
import { chordSet } from '../../src/scoring/chordSet';
import { nearestWrong, shapeOf } from '../../scripts/bench-chords';
import type { RoundSummary, ScoredTarget } from '../../src/scoring/types';
import { renderPlucks, rng, type PluckedNote } from '../../src/synth/karplus';

export const SR = 48000;

export interface RobotOptions {
  /** Share of targets played with a wrong pitch. */
  wrongRate?: number;
  /**
   * Share of CHORD targets strummed as the nearest wrong chord of the list (E for Em, Am for C...), whole shape,
   * not just a shifted note. Exact count like `wrongRate`. Untimed: the player then tries again with the right one.
   */
  wrongChordRate?: number;
  /** Share of targets not played at all (timed only: untimed exercises would wait forever). */
  skipRate?: number;
  /** Constant delay of every pluck, in milliseconds. */
  delayMs?: number;
  seed?: number;
  /** Seconds of silence before beat 0 / the first note. */
  leadIn?: number;
  /** Seconds between notes when the exercise is untimed. */
  untimedGap?: number;
  noise?: number;
  /** Chords are verified spectrally (the real path). Default true; false = the old pitch-class verifier. */
  spectralChords?: boolean;
  judge?: JudgeOptions;
}

export interface RobotRun {
  summary: RoundSummary;
  results: ScoredTarget[];
  events: DetectorEvent[];
  seconds: number;
}

function chooseExact(r: () => number, n: number, rate: number): Set<number> {
  const k = Math.round(rate * n);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return new Set(idx.slice(0, k));
}

function stringFor(exercise: Exercise, midi: number, target: Target): number {
  const inst = INSTRUMENTS[exercise.instrument];
  if (target.kind.type === 'note' && target.kind.pos) return target.kind.pos.string;
  return positionsFor(inst, midi)[0]?.string ?? 0;
}

/** The plucks that satisfy a target (one for notes, one per string for a chord). */
function correctPlucks(exercise: Exercise, target: Target, time: number, rand: () => number, wrong: boolean, wrongChord = false): PluckedNote[] {
  const inst = INSTRUMENTS[exercise.instrument];
  const k = target.kind;
  const shift = wrong ? 1 + Math.floor(rand() * 2) : 0; // 1 or 2 semitones off
  switch (k.type) {
    case 'attack':
      return [{ time, midi: inst.openStrings[1] + 3, string: 1 }];
    case 'note':
      return [{ time, midi: k.midi + shift, string: stringFor(exercise, k.midi, target) }];
    case 'pitchClass': {
      const midi = inst.openStrings[0] + ((k.pc - inst.openStrings[0] + 120) % 12) + 12;
      return [{ time, midi: midi + shift, string: stringFor(exercise, midi, target) }];
    }
    case 'anyOf': {
      const midi = k.midis[Math.floor(rand() * k.midis.length)];
      return [{ time, midi: midi + (wrong ? 1 : 0), string: stringFor(exercise, midi, target) }];
    }
    case 'chord': {
      if (wrongChord) {
        const options = nearestWrong(k.name);
        const other = options[Math.floor(rand() * options.length)];
        return shapeOf(other).map((n, i) => ({ time: time + i * 0.012, midi: n.midi, string: n.string }));
      }
      const shape = k.shape ?? [];
      return shape.map((p, i) => ({ time: time + i * 0.012, midi: midiAt(inst, p) + (wrong ? 1 : 0), string: p.string }));
    }
  }
}

export function runRobot(exercise: Exercise, opts: RobotOptions = {}): RobotRun {
  const inst = INSTRUMENTS[exercise.instrument];
  const rand = rng(opts.seed ?? 1);
  const n = exercise.targets.length;
  const leadIn = opts.leadIn ?? 1;
  const gap = opts.untimedGap ?? 0.6;
  const delay = (opts.delayMs ?? 0) / 1000;
  const wrongSet = chooseExact(rand, n, opts.wrongRate ?? 0);
  const chordIdx = exercise.targets.map((t, i) => (t.kind.type === 'chord' ? i : -1)).filter((i) => i >= 0);
  const wrongChordSet = new Set([...chooseExact(rand, chordIdx.length, opts.wrongChordRate ?? 0)].map((j) => chordIdx[j]));
  const skipSet = exercise.timed ? chooseExact(rand, n, opts.skipRate ?? 0) : new Set<number>();

  const plucks: PluckedNote[] = [];
  let clock = leadIn;
  exercise.targets.forEach((t, i) => {
    const ideal = exercise.timed ? leadIn + ((t.beat ?? 0) * 60) / (exercise.bpm ?? 60) : clock;
    if (skipSet.has(i)) return;
    if (wrongSet.has(i) || wrongChordSet.has(i)) {
      plucks.push(...correctPlucks(exercise, t, ideal + delay, rand, wrongSet.has(i), wrongChordSet.has(i)));
      // Timed: the wrong note takes the place of the right one. Untimed: the player tries again.
      if (exercise.timed) return;
      clock += gap;
    }
    const at = exercise.timed ? ideal + delay : clock + delay;
    plucks.push(...correctPlucks(exercise, t, at, rand, false));
    if (!exercise.timed) clock += gap;
  });

  const last = plucks.reduce((m, p) => Math.max(m, p.time), 0);
  const seconds = last + 1.2;
  const audio = renderPlucks(plucks, { sampleRate: SR, duration: seconds, noise: opts.noise, seed: 7 });
  const det = new Detector({ sampleRate: SR, windowSize: inst.windowSize, ...pitchRange(inst) });
  // The game tells the detector which notes the exercise uses, as the real session does.
  det.setExpected(
    exercise.targets.flatMap((t) =>
      t.kind.type === 'note' ? [t.kind.midi] : t.kind.type === 'anyOf' || t.kind.type === 'chord' ? t.kind.midis : [],
    ),
  );
  // Chords go through the spectral path, as in a GameSession: the detector checks the chord being waited for.
  const spectral = opts.spectralChords ?? true;
  const hasChords = exercise.targets.some((t) => t.kind.type === 'chord');
  const judge = new Judge(exercise, { startTime: leadIn, spectralChords: spectral && hasChords, ...opts.judge });
  let candidatesFor = -2;
  const syncCandidates = () => {
    if (!spectral || !hasChords) return;
    const idx = judge.done ? -1 : judge.currentIndex;
    if (idx === candidatesFor) return;
    candidatesFor = idx;
    const k = exercise.targets[idx]?.kind;
    if (k && k.type === 'chord') {
      const set = chordSet(k);
      det.setChordCandidates(set.required, set.contradicting);
    } else det.setChordCandidates([]);
  };
  syncCandidates();
  const events: DetectorEvent[] = [];
  const chunk = 128;
  for (let i = 0; i < audio.length; i += chunk) {
    const ev = det.process(audio.subarray(i, i + chunk));
    events.push(...ev);
    judge.push(ev);
    judge.advance((i + chunk) / SR);
    syncCandidates();
  }
  judge.finish();
  return { summary: judge.summary(), results: judge.results(), events, seconds };
}
