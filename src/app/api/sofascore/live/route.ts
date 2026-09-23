import { parseSofascoreLiveList } from "@/lib/sofascore";

// Every football match live right now, worldwide, from SofaScore via the local
// CloakBrowser scraper. Scraper offline -> 503 { error: "scraper-offline" }.
const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";

export async function GET() {
  let raw: Response;
  try {
    raw = await fetch(`${SCRAPER}/live`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json(
      { error: "scraper-offline", hint: "Liga o scraper local (scraper/npm start)." },
      { status: 503 }
    );
  }
  if (!raw.ok) return Response.json({ error: "upstream" }, { status: 502 });
  const games = parseSofascoreLiveList(await raw.json());
  return Response.json(
    { games },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
