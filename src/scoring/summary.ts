import type { RoundSummary, ScoredTarget } from './types';

/**
 * Round summary. `results` are the final result of each target; missing ones (`total` larger than the
 * list) count as misses.
 */
export function summarize(results: ScoredTarget[], total: number, timed: boolean, strays = 0): RoundSummary {
  const count = { hit: 0, early: 0, late: 0, wrong: 0, miss: Math.max(0, total - results.length) };
  let credit = 0;
  let clean = 0;
  const errors: number[] = [];
  const reactions: number[] = [];
  for (const r of results) {
    count[r.judgement]++;
    const right = r.judgement === 'hit' || r.judgement === 'early' || r.judgement === 'late';
    const noRetries = r.wrongAttempts === 0;
    if (right && noRetries) {
      clean++;
      credit += r.judgement === 'hit' ? 1 : 0.5;
    }
    if (right) {
      if (timed) errors.push(r.delta);
      else reactions.push(r.delta);
    }
  }
  const n = Math.max(1, total);
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const meanTimingError = mean(errors);
  const accuracy = credit / n;
  const cleanliness = clean / n;
  const score = 0.6 * cleanliness + 0.4 * accuracy;
  return {
    total,
    hits: count.hit,
    early: count.early,
    late: count.late,
    wrong: count.wrong,
    miss: count.miss,
    accuracy,
    cleanliness,
    meanTimingError,
    tendency: meanTimingError === null ? null : meanTimingError > 0.025 ? 'drag' : meanTimingError < -0.025 ? 'rush' : 'steady',
    meanReaction: mean(reactions),
    strays,
    score,
    stars: score >= 0.9 ? 3 : score >= 0.65 ? 2 : 1,
  };
}
