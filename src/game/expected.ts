import type { Exercise } from '../model/exercise';

/** MIDI notes the exercise waits for, to tell the detector (attack/pitchClass targets give none). Sorted, unique. */
export function expectedMidis(exercise: Exercise): number[] {
  const set = new Set<number>();
  for (const t of exercise.targets) {
    const k = t.kind;
    if (k.type === 'note') set.add(k.midi);
    else if (k.type === 'anyOf' || k.type === 'chord') k.midis.forEach((m) => set.add(m));
  }
  return [...set].sort((a, b) => a - b);
}
