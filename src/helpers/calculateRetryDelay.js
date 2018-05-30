export const DELAY_INTERVALS = [100, 200, 400, 800, 1600, 3200, 6400];

export function calculateRetryDelay(retries) {
  return DELAY_INTERVALS[Math.min(retries, DELAY_INTERVALS.length - 1)];
}

export const INVERSE_DELAY_INTERVALS = [6400, 3200, 1600, 800, 400, 200, 100];

export function calculateInverseRetryDelay(retries) {
  return INVERSE_DELAY_INTERVALS[Math.max(retries, 0)];
}
