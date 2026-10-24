/**
 * Free-text search helpers shared by the three `?q=` endpoints (people,
 * video captions, follower lists).
 *
 * All three do the same thing — a case-insensitive substring match on a short
 * string typed into a box — so they do it the same way, in one place, rather
 * than three slightly different ILIKE expressions that drift apart.
 */

/**
 * A user's text as a safe ILIKE pattern.
 *
 * `%` and `_` are wildcards and `\` escapes them, so a search for "100%"
 * would otherwise match every row, and one for "a_b" would match "axb".
 * None of that is dangerous — the value is still bound as a parameter, so
 * this is not an injection concern — but it is wrong, and a search box that
 * quietly means something other than what was typed is a bug people cannot
 * diagnose.
 *
 * Escapes first, then wraps: the wrapping `%` are ours and must survive.
 */
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The shortest query worth running.
 *
 * One character matches most of any real table, so the database would rank
 * thousands of rows to answer a question the person has not finished asking.
 * The mobile client holds its requests to the same floor.
 */
export const MIN_SEARCH_LENGTH = 2;

/** Trimmed, or undefined when it is too short to be a search. */
export function searchTerm(raw: string | undefined): string | undefined {
  const term = raw?.trim();
  return term && term.length >= MIN_SEARCH_LENGTH ? term : undefined;
}
