/**
 * Shot planning and timing of Portero (pure). The Exercise has one target per string; the arcade turns them into
 * SHOTS: a skip between two strings (distance >= 2) becomes a DOUBLE shot (two balls at non-adjacent heights,
 * telegraphed together and saved in order). Everything else is a single shot.
 */

/** Targets of one telegraph: one (single) or two (double, saved in order). */
export interface ShotGroup {
  indices: number[];
}

export const isSkip = (a: number, b: number): boolean => Math.abs(a - b) >= 2;

/**
 * Greedy grouping: at every target, if the next one is a skip away they form a double (and are consumed);
 * in timed exercises they must also be at most one beat apart ("quick succession").
 */
export function planShots(strings: number[], beats?: (number | undefined)[]): ShotGroup[] {
  const groups: ShotGroup[] = [];
  for (let i = 0; i < strings.length; i++) {
    const next = i + 1 < strings.length ? i + 1 : -1;
    const quick = !beats || (beats[i] !== undefined && beats[next] !== undefined && beats[next]! - beats[i]! <= 1 + 1e-9);
    if (next >= 0 && isSkip(strings[i], strings[next]) && quick) {
      groups.push({ indices: [i, next] });
      i++;
    } else groups.push({ indices: [i] });
  }
  return groups;
}

/** Timed: the marker and ring appear this many beats before the ball arrives, the ball flies the last FLIGHT_BEATS. */
export const TELEGRAPH_BEATS = 2;
export const FLIGHT_BEATS = 1;

export interface TimedPhase {
  /** The marker is on screen. */
  visible: boolean;
  /** Timing ring: 1 when it appears, 0 when the ball arrives (the moment to play). */
  ring: number;
  /** Ball flight: 0 while the shooter aims, 0..1 in the air, 1 when it has arrived. */
  flight: number;
}

export function timedPhase(beat: number, arrival: number): TimedPhase {
  const left = arrival - beat;
  return {
    visible: left <= TELEGRAPH_BEATS,
    ring: Math.min(1, Math.max(0, left / TELEGRAPH_BEATS)),
    flight: Math.min(1, Math.max(0, (FLIGHT_BEATS - left) / FLIGHT_BEATS)),
  };
}

export type ShotRole = 'single' | 'first' | 'second';

/** Seconds an untimed shot lasts: the pace, sped up by the streak; the second ball of a double has 70 % of it. */
export function shotLimit(pace: number, speed: number, role: ShotRole): number {
  return Math.round(pace * speed * (role === 'second' ? 0.7 : 1) * 100) / 100;
}

/** Fraction of the time still left: 1 when the shot starts, 0 at its deadline. */
export function timeLeft(now: number, start: number, deadline: number): number {
  if (deadline <= start) return 0;
  return Math.min(1, Math.max(0, (deadline - now) / (deadline - start)));
}

/** Radius of the timing ring for a remaining fraction: wide at the start, tight at the deadline. */
export function ringRadius(left: number, max = 16, min = 3): number {
  return Math.round(min + (max - min) * Math.min(1, Math.max(0, left)));
}
