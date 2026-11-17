import type { RoundSummary, ScoredTarget } from './types';

/** Each stray (a sound that matched no target) costs this much of the score, per target, up to STRAY_CAP in all. */
const STRAY_COST = 0.5;
const STRAY_CAP = 0.15;
/** Stars need more than score: 2 stars cleanliness >= 0.75 and accuracy >= 0.7, 3 stars cleanliness >= 0.9. */
export const STAR_RULES = { two: { score: 0.65, cleanliness: 0.75, accuracy: 0.7 }, three: { score: 0.9, cleanliness: 0.9 }, played: 0.25 };

/**
 * Round summary. `results` are the final result of each target; missing ones (`total` larger than the
 * list) count as misses.
 *
 * score = 0.6 cleanliness + 0.4 accuracy - strays (small, capped). Stars: 0 when almost nothing was played (under
 * a quarter of the targets right), 3 for score >= 0.9 and cleanliness >= 0.9, 2 for score >= 0.65, cleanliness >= 0.75
 * and accuracy >= 0.7 (a round that is all late, or all early, has accuracy 0.5 and cannot reach 2), else 1.
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
  const score = Math.max(0, 0.6 * cleanliness + 0.4 * accuracy - Math.min(STRAY_CAP, (STRAY_COST * strays) / n));
  const right = count.hit + count.early + count.late;
  const R = STAR_RULES;
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
    stars:
      right / n < R.played
        ? 0
        : score >= R.three.score && cleanliness >= R.three.cleanliness
          ? 3
          : score >= R.two.score && cleanliness >= R.two.cleanliness && accuracy >= R.two.accuracy
            ? 2
            : 1,
  };
}
