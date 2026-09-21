import { pairCandidates, slugCandidates, teamsMatch } from "@/lib/sportscoreSlug";
import { slugify } from "@/lib/slugify";

// Finds the Sportscore match slug for two team names by probing likely slug
// variants against its embed endpoint, which answers 404 for unknown slugs and
// 200 once both teams (and a match between them) exist. A 200 is not proof of
// the right teams though (a slug can belong to a reserve side), so the names
// the embed shows are checked too. It also reports the slugs of the two teams
// and of the competition, which the extra blocks under a widget (lineups,
// standings, recent results) are looked up by. Sits behind the login proxy
// like every other route.
const EMBED = "https://sportscore.com/embed/match/football";
const STANDINGS = "https://sportscore.com/embed/standings/football";
const CONCURRENCY = 6;
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
// A miss is remembered only briefly: the match may simply not be listed yet.
const MISS_TTL_MS = 60 * 1000;

interface Resolved {
  slug: string | null;
  homeSlug: string | null;
  awaySlug: string | null;
  // null when Sportscore has no standings under the competition's name.
  competitionSlug: string | null;
}

const NOT_FOUND: Resolved = { slug: null, homeSlug: null, awaySlug: null, competitionSlug: null };

const cache = new Map<string, { result: Resolved; expires: number }>();

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

type Probe = "match" | "no-match" | "wrong-team" | "blocked";

// Checks the embed for `slug`: does it exist, and does it show the teams that
// were asked for. "blocked" is anything but a plain 404 (Cloudflare turning a
// datacenter IP away, a timeout, a 5xx), which says nothing about the match.
// `competition` is the league name the embed shows under the score.
async function probe(
  slug: string,
  homeVariants: string[],
  awayVariants: string[]
): Promise<{ outcome: Probe; competition: string | null }> {
  const result = (outcome: Probe, competition: string | null = null) => ({ outcome, competition });
  try {
    const res = await fetch(`${EMBED}/${slug}/`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (res.status === 404) return result("no-match");
    if (!res.ok) return result("blocked");
    const html = await res.text();
    const competition = html.match(/<div class="meta"><a[^>]*>([^<]*)<\/a>/)?.[1];
    const names = [...html.matchAll(/<div class="nm">([^<]*)<\/div>/g)].map((m) =>
      decodeEntities(m[1]).trim()
    );
    const league = competition ? decodeEntities(competition).trim() : null;
    // Can't tell who is playing if the markup changes: trust the 200.
    if (names.length < 2) return result("match", league);
    return teamsMatch([names[0], names[1]], homeVariants, awayVariants)
      ? result("match", league)
      : result("wrong-team");
  } catch {
    return result("blocked");
  }
}

// The competition's standings live under a slug made from its name. A valid
// one has the name in its title ("Brazilian Serie A standings"); an unknown one
// still answers 200 with a generic "League standings" page, so the title is
// what tells them apart.
async function competitionSlugFor(name: string | null): Promise<string | null> {
  if (!name) return null;
  const slug = slugify(name);
  if (!slug) return null;
  try {
    const res = await fetch(`${STANDINGS}/${slug}/`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const title = (await res.text()).match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    return decodeEntities(title).toLowerCase().startsWith(name.toLowerCase()) ? slug : null;
  } catch {
    return null;
  }
}

async function firstMatch(
  pairs: { home: string; away: string }[],
  homeVariants: string[],
  awayVariants: string[]
): Promise<{
  found: { home: string; away: string; competition: string | null } | null;
  outcomes: Record<Probe, number>;
}> {
  const outcomes: Record<Probe, number> = { match: 0, "no-match": 0, "wrong-team": 0, blocked: 0 };
  let next = 0;
  let found: { home: string; away: string; competition: string | null } | null = null;
  const worker = async () => {
    while (found === null && next < pairs.length) {
      const { home, away } = pairs[next++];
      const { outcome, competition } = await probe(`${home}-vs-${away}`, homeVariants, awayVariants);
      outcomes[outcome]++;
      if (outcome === "match") found ??= { home, away, competition };
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pairs.length) }, worker));
  return { found, outcomes };
}

function namesFrom(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .flatMap((v) => v.split("|"))
    .map((v) => v.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 6);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const homeNames = namesFrom(params, "home");
  const awayNames = namesFrom(params, "away");
  if (homeNames.length === 0 || awayNames.length === 0) {
    return Response.json({ error: "home and away are required" }, { status: 400 });
  }

  const key = `${homeNames.join("|")}~${awayNames.join("|")}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return Response.json(hit.result);

  const homeVariants = slugCandidates(homeNames);
  const awayVariants = slugCandidates(awayNames);
  const { found, outcomes } = await firstMatch(
    pairCandidates(homeVariants, awayVariants),
    homeVariants,
    awayVariants
  );

  const result: Resolved = found
    ? {
        slug: `${found.home}-vs-${found.away}`,
        homeSlug: found.home,
        awaySlug: found.away,
        competitionSlug: await competitionSlugFor(found.competition),
      }
    : NOT_FOUND;

  // Failing to reach Sportscore is not the same as the match not being there:
  // report it, and don't remember it.
  const blocked = result.slug === null && outcomes.blocked > 0;
  if (!blocked) {
    cache.set(key, { result, expires: Date.now() + (result.slug ? FOUND_TTL_MS : MISS_TTL_MS) });
  }
  return Response.json(
    { ...result, blocked, outcomes },
    { headers: result.slug ? { "Cache-Control": "private, max-age=3600" } : undefined }
  );
}
