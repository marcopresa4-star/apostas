// Which SofaScore competition a league label points at. Pure and server-free
// so it can be unit-tested: the bug it fixes (Brasil · Série B saved on the
// first division's id, because both names contain "série" and Série A is far
// more followed) was invisible until someone opened the table.

export interface TournamentCandidate {
  name: string;
  userCount: number;
}

// Best candidate by whole-word overlap, then popularity. Words are compared
// exactly ("Série B" needs the "b"), so a shared word never decides alone.
export function pickTournament<T extends TournamentCandidate>(query: string, cands: T[]): T | null {
  if (cands.length === 0) return null;
  const tokensOf = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const words = tokensOf(query);
  const scored = cands.map((c) => {
    const own = new Set(tokensOf(c.name));
    return { c, overlap: words.filter((w) => own.has(w)).length };
  });
  const withWords = scored.filter((s) => s.overlap > 0);
  const pool = (withWords.length > 0 ? withWords : scored.map((s) => ({ ...s, overlap: 0 }))).sort(
    (a, b) => b.overlap - a.overlap || b.c.userCount - a.c.userCount
  );
  const top = pool[0];
  // An obscure competition nobody follows is probably the wrong one.
  if (top.c.userCount < 1000) return null;
  return top.c;
}
