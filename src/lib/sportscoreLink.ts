import { slugify } from "./slugify";

// Sportscore names a match "<home team>-vs-<away team>" in the address of its
// match page (sportscore.com/football/match/<slug>/...), and in its embed. This
// takes what someone pastes, an address or the bare slug, and returns the two
// team slugs, or null if it does not look like a match.
export function parseSportscoreMatch(input: string): { slugs: [string, string] } | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  let path = text;
  try {
    path = new URL(text).pathname;
  } catch {
    // Not an address: treat it as a bare slug.
  }

  for (const segment of path.split("/")) {
    if (!/^[a-z0-9-]+$/.test(segment)) continue;
    const parts = segment.split("-vs-");
    // A slug that says "vs" more than once is ambiguous about where one team ends.
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
    if (parts[0].startsWith("-") || parts[1].endsWith("-")) continue;
    return { slugs: [parts[0], parts[1]] };
  }
  return null;
}

// How well a team's names fit a slug: the words they share.
function overlap(names: string[], slug: string): number {
  const slugWords = new Set(slug.split("-"));
  return Math.max(
    0,
    ...names.map((name) => slugify(name).split("-").filter((w) => w.length > 1 && slugWords.has(w)).length)
  );
}

// The link lists the teams in Sportscore's order, which is not always the
// order they were entered in here. Each slug goes to the team whose names fit
// it better; on a tie the order of the link is kept.
export function assignSlugs(
  homeNames: string[],
  awayNames: string[],
  slugs: [string, string]
): { home: string; away: string } {
  const [first, second] = slugs;
  const straight = overlap(homeNames, first) + overlap(awayNames, second);
  const swapped = overlap(homeNames, second) + overlap(awayNames, first);
  return swapped > straight ? { home: second, away: first } : { home: first, away: second };
}
