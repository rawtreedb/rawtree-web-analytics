/** Difference between two rates (for "points" deltas), or null when either is missing. */
export const pointChange = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
