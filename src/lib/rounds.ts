import type { Fixture } from "./footballModel";

export interface Round {
  name: string; // "Matchday 7"
  fixtures: Fixture[]; // by date and time
  first: string; // date of its first game
}

// The season's rounds in date order, keeping the ones that still have a game to
// come (a round in progress counts: some games played, some not).
export function upcomingRounds(fixtures: Fixture[], today: string): Round[] {
  const byRound = new Map<string, Fixture[]>();
  for (const f of fixtures) {
    const key = f.round ?? "—";
    byRound.set(key, [...(byRound.get(key) ?? []), f]);
  }
  return [...byRound.entries()]
    .map(([name, list]): Round => {
      const sorted = [...list].sort((a, b) =>
        `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`)
      );
      return { name, fixtures: sorted, first: sorted[0].date };
    })
    .sort((a, b) => a.first.localeCompare(b.first))
    .filter((r) => r.fixtures.some((f) => !f.ft && f.date >= today));
}

// "Matchday 7" -> "Jornada 7"
export const roundLabel = (name: string): string => name.replace(/^Matchday\s*/i, "Jornada ");
