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
 * Longest name/candidate suggest() will run Levenshtein on. Beyond this a
 * "did you mean" is meaningless anyway, and the guard caps the O(n·m) cost so an
 * attacker-controlled long string (e.g. a decision-table target) cannot make
 * suggestion generation quadratic and hang the validator.
 */
const MAX_SUGGEST_LENGTH = 64;

/**
 * Per-validation-run cap on how many suggestions we will *compute*. Each call
 * that reaches the Levenshtein scan costs O(candidates × MAX_SUGGEST_LENGTH²),
 * so an unbounded number of unresolved references (agent-zone members,
 * decision-table `next` cells, boundary targets) in a single hostile document
 * would multiply that cost by the reference count and hang the validator. Once
 * this many suggestions have been computed in a run, further calls still let the
 * diagnostic be emitted but return no "did you mean", capping total suggestion
 * work at O(budget × candidates) regardless of document size. The value is far
 * above any legitimate spec's count of typo-like references, so real documents
 * keep every suggestion.
 */
export const DEFAULT_SUGGEST_BUDGET = 500;

let suggestBudget = DEFAULT_SUGGEST_BUDGET;

/**
 * Resets the per-run suggestion budget. Called at the start of each independent
 * validation pass (feature parse, feature validation, catalog validation) so a
 * document exhausting the budget can never suppress suggestions for the next.
 */
export function resetSuggestBudget(budget: number = DEFAULT_SUGGEST_BUDGET): void {
  suggestBudget = budget;
}

/**
 * Returns the closest candidate within an edit-distance budget, or undefined.
 * The budget scales with the length of the misspelled name so short names
 * do not produce absurd suggestions.
 */
export function suggest(name: string, candidates: Iterable<string>): string | undefined {
  // An over-long name can never produce a useful suggestion and would only
  // amplify the per-candidate Levenshtein cost; bail before doing any work.
  if (name.length > MAX_SUGGEST_LENGTH) return undefined;
  // Once the run's suggestion budget is spent, still let the caller report the
  // diagnostic but skip the (potentially expensive) nearest-name search. Counted
  // per computed suggestion so total cost stays bounded no matter how many
  // unresolved references a single document contains.
  if (suggestBudget <= 0) return undefined;
  suggestBudget -= 1;
  const maxDistance = name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
  let best: string | undefined;
  let bestDistance = maxDistance + 1;
  for (const candidate of candidates) {
    if (candidate === name) continue;
    // Skip over-long candidates for the same reason — they bound each
    // comparison to MAX_SUGGEST_LENGTH² work.
    if (candidate.length > MAX_SUGGEST_LENGTH) continue;
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
