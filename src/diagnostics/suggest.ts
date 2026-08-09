/**
 * Nearest-name suggestions for typo-like errors ("chekout" → "checkout").
 * Tiny Levenshtein implementation; deliberately no dependency.
 */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] as number) + 1,
        (curr[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] as number;
}

/**
 * Returns the closest candidate within an edit-distance budget, or undefined.
 * The budget scales with the length of the misspelled name so short names
 * do not produce absurd suggestions.
 */
export function suggest(name: string, candidates: Iterable<string>): string | undefined {
  const maxDistance = name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
  let best: string | undefined;
  let bestDistance = maxDistance + 1;
  for (const candidate of candidates) {
    if (candidate === name) continue;
    const d = levenshtein(name.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return bestDistance <= maxDistance ? best : undefined;
}

/** Appends `Did you mean "x"?` when a suggestion exists. */
export function withSuggestion(message: string, suggestion: string | undefined): string {
  return suggestion === undefined ? message : `${message} Did you mean "${suggestion}"?`;
}
