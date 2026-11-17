// "Ao vivo agora" from SofaScore, via the local CloakBrowser scraper (server
// side only). Returns only matches genuinely in progress, newest kickoff last.
// Scraper offline or blocked -> { games: [], offline: true } so the page can
// say so instead of pretending there is nothing live.
import { parseSofascoreLiveList, type SofaLiveEntry } from "./sofascore";

const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";

export interface SofaBoardResult {
  games: SofaLiveEntry[];
  // No data to show: either the scraper is unreachable or SofaScore refuses it.
  offline: boolean;
  // Why there is nothing: "offline" (scraper not running), "blocked" (running
  // but Cloudflare is refusing: someone must solve the challenge in its
  // window) or "ok". Pages word the notice from this instead of blaming the
  // scraper for a 403.
  state: "ok" | "offline" | "blocked";
  // The scraper's own hint, when it sends one.
  hint: string | null;
}

export async function fetchSofaLiveNow(now = Date.now()): Promise<SofaBoardResult> {
  let raw: Response;
  try {
    raw = await fetch(`${SCRAPER}/live`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { games: [], offline: true, state: "offline", hint: null };
  }
  if (!raw.ok) {
    const body = (await raw.json().catch(() => null)) as { error?: unknown; hint?: unknown } | null;
    const hint = typeof body?.hint === "string" ? body.hint : null;
    return { games: [], offline: true, state: body?.error === "blocked" ? "blocked" : "offline", hint };
  }
  const games = parseSofascoreLiveList(await raw.json(), now).filter(
    (g) => g.phase === "live" || g.phase === "halftime"
  );
  return {
    games: games.sort((a, b) => a.kickoff.localeCompare(b.kickoff)),
    offline: false,
    state: "ok",
    hint: null,
  };
}
