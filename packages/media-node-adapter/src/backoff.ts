/** Bounded exponential backoff with jitter: 1, 2, 4, 8, then 15 s (B§17.1). */
const STEPS_S = [1, 2, 4, 8, 15];

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = STEPS_S[Math.min(Math.max(attempt, 0), STEPS_S.length - 1)]! * 1000;
  return Math.round(base * (0.8 + random() * 0.4));
}
