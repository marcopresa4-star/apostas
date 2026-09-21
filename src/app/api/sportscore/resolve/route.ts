import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/slugify";
import { pairCandidates, slugCandidates, teamsMatch } from "@/lib/sportscoreSlug";

// Finds the Sportscore match slug for two team names by probing likely slug
// variants against its embed endpoint, which answers 404 for unknown slugs and
// 200 once both teams (and a match between them) exist. A 200 is not proof of
// the right teams though (a slug can belong to a reserve side), so the names
// the embed shows are checked too. Names taught by hand (a pasted Sportscore
// link, see saveSportscoreLink) are tried first and trusted, and are also
// returned even when Sportscore cannot be reached, so the widget can still be
// built from them. Sits behind the login proxy like every other route.
const EMBED = "https://sportscore.com/embed/match/football";
const CONCURRENCY = 6;
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
// A miss is remembered only briefly: the match may simply not be listed yet.
const MISS_TTL_MS = 60 * 1000;

interface Hints {
  home: string | null;
  away: string | null;
}

const cache = new Map<string, { slug: string | null; expires: number }>();

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

type Probe = "match" | "no-match" | "wrong-team" | "blocked";

// Checks the embed for `slug`: does it exist, and does it show the teams that
// were asked for (a side with null variants was taught by hand and is not
// checked). "blocked" is anything but a plain 404 (Cloudflare turning a
// datacenter IP away, a timeout, a 5xx), which says nothing about the match.
async function probe(
  slug: string,
  homeVariants: string[] | null,
  awayVariants: string[] | null
): Promise<Probe> {
  try {
    const res = await fetch(`${EMBED}/${slug}/`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (res.status === 404) return "no-match";
    if (!res.ok) return "blocked";
    const names = [...(await res.text()).matchAll(/<div class="nm">([^<]*)<\/div>/g)].map((m) =>
      decodeEntities(m[1]).trim()
    );
    // Can't tell who is playing if the markup changes: trust the 200.
    if (names.length < 2) return "match";
    return teamsMatch([names[0], names[1]], homeVariants, awayVariants) ? "match" : "wrong-team";
  } catch {
    return "blocked";
  }
}

async function firstMatch(
  pairs: { home: string; away: string }[],
  homeVariants: string[],
  awayVariants: string[],
  hints: Hints
): Promise<{ slug: string | null; outcomes: Record<Probe, number> }> {
  const outcomes: Record<Probe, number> = { match: 0, "no-match": 0, "wrong-team": 0, blocked: 0 };
  let next = 0;
  let found: string | null = null;
  const worker = async () => {
    while (found === null && next < pairs.length) {
      const { home, away } = pairs[next++];
      const slug = `${home}-vs-${away}`;
      const outcome = await probe(
        slug,
        home === hints.home ? null : homeVariants,
        away === hints.away ? null : awayVariants
      );
      outcomes[outcome]++;
      if (outcome === "match") found ??= slug;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pairs.length) }, worker));
  return { slug: found, outcomes };
}

// What was taught for these clubs, by any of their names. If the table is not
// there yet (migration not run) or the lookup fails, nothing was taught.
async function loadHints(homeNames: string[], awayNames: string[]): Promise<Hints> {
  const none: Hints = { home: null, away: null };
  try {
    const keys = [...new Set([...homeNames, ...awayNames].map(slugify).filter(Boolean))];
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sportscore_teams")
      .select("name_key, slug")
      .in("name_key", keys)
      .returns<{ name_key: string; slug: string }[]>();
    if (error || !data) return none;
    const bySlug = new Map(data.map((row) => [row.name_key, row.slug]));
    const pick = (names: string[]) => {
      for (const name of names) {
        const slug = bySlug.get(slugify(name));
        if (slug) return slug;
      }
      return null;
    };
    return { home: pick(homeNames), away: pick(awayNames) };
  } catch {
    return none;
  }
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

  const hints = await loadHints(homeNames, awayNames);

  // A new lesson changes the answer, so it is part of the key.
  const key = `${homeNames.join("|")}~${awayNames.join("|")}~${hints.home}~${hints.away}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return Response.json({ slug: hit.slug, hints });

  // What was taught goes first on its side.
  const withHint = (hint: string | null, variants: string[]) =>
    hint ? [hint, ...variants.filter((v) => v !== hint)] : variants;
  const homeVariants = slugCandidates(homeNames);
  const awayVariants = slugCandidates(awayNames);
  const { slug, outcomes } = await firstMatch(
    pairCandidates(withHint(hints.home, homeVariants), withHint(hints.away, awayVariants)),
    homeVariants,
    awayVariants,
    hints
  );

  // Failing to reach Sportscore is not the same as the match not being there:
  // report it, and don't remember it.
  const blocked = slug === null && outcomes.blocked > 0;
  if (!blocked) cache.set(key, { slug, expires: Date.now() + (slug ? FOUND_TTL_MS : MISS_TTL_MS) });
  return Response.json(
    { slug, blocked, outcomes, hints },
    { headers: slug ? { "Cache-Control": "private, max-age=3600" } : undefined }
  );
}
