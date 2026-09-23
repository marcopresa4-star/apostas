// "Ao vivo agora" from SofaScore, via the local CloakBrowser scraper (server
// side only). Returns only matches genuinely in progress, newest kickoff last.
// Scraper offline or blocked -> { games: [], offline: true } so the page can
// say so instead of pretending there is nothing live.
import { parseSofascoreLiveList, type SofaLiveEntry } from "./sofascore";

const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";

export interface SofaBoardResult {
  games: SofaLiveEntry[];
  offline: boolean;
}

export async function fetchSofaLiveNow(now = Date.now()): Promise<SofaBoardResult> {
  let raw: Response;
  try {
    raw = await fetch(`${SCRAPER}/live`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { games: [], offline: true };
  }
  if (!raw.ok) return { games: [], offline: true };
  const games = parseSofascoreLiveList(await raw.json(), now).filter(
    (g) => g.phase === "live" || g.phase === "halftime"
  );
  return {
    games: games.sort((a, b) => a.kickoff.localeCompare(b.kickoff)),
    offline: false,
  };
}
