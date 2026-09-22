// "Ao vivo agora" across every league in the world, from the free SportScore
// API. Its list endpoint (every recent/upcoming game) turns out to be stale —
// testing it live, games from hours ago still say "not started" — so it is
// only used to find candidate games (and their slug); each candidate is then
// checked with the same per-match lookup the live calculator already trusts,
// and only the ones that come back live or at half time are kept.

import { parseLiveMatch, type LiveGameState } from "./sportscoreLive";

const LIST_URL = "https://sportscore.com/api/widget/matches/?sport=football&limit=50";
const MATCH_URL = "https://sportscore.com/api/widget/match/?sport=football&slug=";

export interface Candidate {
  slug: string;
  competition: string;
  home: string;
  away: string;
  kickoff: string; // ISO
}

// A game whose listed kickoff was recent enough that it could plausibly be live
// or at half time by now (the list's own status is not trusted for this).
const WINDOW_MS = 150 * 60_000; // a game is live for about this long

function parseCandidates(json: unknown, now: number): Candidate[] {
  const matches = (json as { matches?: unknown[] })?.matches;
  if (!Array.isArray(matches)) return [];
  const out: Candidate[] = [];
  for (const item of matches) {
    const m = item as Record<string, unknown>;
    const url = typeof m.url === "string" ? m.url : "";
    const slug = /\/football\/match\/([^/]+)\/?$/.exec(url)?.[1];
    const kickoff = typeof m.time === "string" ? Date.parse(m.time) : NaN;
    if (!slug || !Number.isFinite(kickoff)) continue;
    const age = now - kickoff;
    if (age < 0 || age > WINDOW_MS) continue; // not started yet, or long over
    out.push({
      slug,
      competition: typeof m.competition === "string" ? m.competition : "",
      home: typeof m.home === "string" ? m.home : "",
      away: typeof m.away === "string" ? m.away : "",
      kickoff: new Date(kickoff).toISOString(),
    });
  }
  return out;
}

export async function fetchCandidates(now: number): Promise<Candidate[]> {
  try {
    const res = await fetch(LIST_URL, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) return [];
    return parseCandidates(await res.json(), now);
  } catch {
    return [];
  }
}

export interface LiveGame extends Candidate {
  state: LiveGameState;
}

// Confirms one candidate with the reliable per-match lookup; null unless it is
// genuinely live or at half time right now.
async function verify(candidate: Candidate): Promise<LiveGame | null> {
  try {
    const res = await fetch(MATCH_URL + encodeURIComponent(candidate.slug), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const state = parseLiveMatch(await res.json());
    if (!state || (state.phase !== "live" && state.phase !== "halftime")) return null;
    return { ...candidate, state };
  } catch {
    return null;
  }
}

// Every game in the world that is genuinely live or at half time right now, as
// far as the free data can tell (see the note above: a busy matchday can have
// more live games than the list surfaces at all).
export async function fetchLiveNow(now = Date.now()): Promise<LiveGame[]> {
  const candidates = await fetchCandidates(now);
  const checked = await Promise.all(candidates.map(verify));
  return checked.filter((g): g is LiveGame => g !== null).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}
