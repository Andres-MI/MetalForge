import { describe, expect, it } from 'vitest';
import { BlockProcessor } from '../src/audio/blocks';
import { generate } from '../src/exercises';
import { expectedMidis } from '../src/game/expected';
import { FakeInput } from '../src/game/input';
import { GameSession } from '../src/game/session';
import { INSTRUMENTS, pitchRange } from '../src/model/instrument';
import type { Exercise } from '../src/model/exercise';

function session(exercise: Exercise) {
  const input = new FakeInput();
  return { input, session: new GameSession({ exercise, input, metronome: { on: false } }) };
}

describe('expected notes plumbing', () => {
  it('derives midis from note, anyOf and chord targets; attack/pitchClass give none', () => {
    const base = generate('rhythm', { instrument: 'guitar', level: 1, seed: 1, length: 4 });
    expect(expectedMidis(base)).toEqual([]);
    const note: Exercise = { ...base, targets: [{ itemId: 'a', kind: { type: 'note', midi: 52 }, beat: 0 }, { itemId: 'b', kind: { type: 'note', midi: 52 }, beat: 1 }, { itemId: 'c', kind: { type: 'pitchClass', pc: 3 }, beat: 2 }] };
    expect(expectedMidis(note)).toEqual([52]);
    const mixed: Exercise = { ...base, targets: [{ itemId: 'a', kind: { type: 'anyOf', midis: [60, 62] } }, { itemId: 'b', kind: { type: 'chord', name: 'Em', midis: [40, 47, 52] } }] };
    expect(expectedMidis(mixed)).toEqual([40, 47, 52, 60, 62]);
    const frets = generate('frets', { instrument: 'bass4', level: 2, seed: 3, length: 8 });
    const got = expectedMidis(frets);
    expect(got.length).toBeGreaterThan(0);
    for (const t of frets.targets) if (t.kind.type === 'note') expect(got).toContain(t.kind.midi);
  });

  it('the session sets them when it starts and clears them on dispose', () => {
    const ex = generate('frets', { instrument: 'guitar', level: 1, seed: 2, length: 6 });
    const { input, session: s } = session(ex);
    expect(input.expected).toEqual([]);
    s.start();
    expect(input.expected).toEqual(expectedMidis(ex));
    expect(input.expected.length).toBeGreaterThan(0);
    s.dispose();
    expect(input.expected).toEqual([]);
  });

  it('rhythm sessions pass nothing', () => {
    const { input, session: s } = session(generate('rhythm', { instrument: 'guitar', level: 1, seed: 2, length: 8 }));
    s.start();
    expect(input.expected).toEqual([]);
    s.dispose();
  });

  it('BlockProcessor forwards them to the detector (and an empty list clears)', () => {
    const inst = INSTRUMENTS.guitar;
    const proc = new BlockProcessor({ sampleRate: 48000, windowSize: inst.windowSize, ...pitchRange(inst) });
    const det = (proc as unknown as { detector: { expectedMidis: number[] } }).detector;
    proc.setExpected([52, 52, 55]);
    expect(det.expectedMidis).toEqual([52, 55]);
    proc.setExpected([]);
    expect(det.expectedMidis).toEqual([]);
  });
});
