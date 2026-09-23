// Cumulative xG (expected goals) progression for the widget chart, from the
// event's shotmap (every shot carries its minute and xG). Proxied like the
// graph route. 404 (no shot coverage for this game) -> { shots: [] }.
const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";

export interface XgShot {
  minute: number;
  home: boolean;
  xg: number;
  goal: boolean;
}

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  let raw: Response;
  try {
    raw = await fetch(`${SCRAPER}/raw?path=${encodeURIComponent(`/event/${id}/shotmap`)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ error: "scraper-offline" }, { status: 503 });
  }
  if (raw.status === 404) return Response.json({ shots: [] });
  if (!raw.ok) return Response.json({ error: "upstream" }, { status: 502 });
  const body = await raw.json().catch(() => null);
  const list = (body as { shotmap?: unknown } | null)?.shotmap;
  const shots: XgShot[] = Array.isArray(list)
    ? list.flatMap((s): XgShot[] => {
        if (typeof s !== "object" || s === null) return [];
        const shot = s as Record<string, unknown>;
        const minute = typeof shot.time === "number" ? shot.time : null;
        const xg = typeof shot.xg === "number" ? shot.xg : null;
        if (minute === null || xg === null || minute < 0 || minute > 130 || xg < 0 || xg > 2) return [];
        return [{ minute, home: shot.isHome === true, xg, goal: shot.shotType === "goal" }];
      })
    : [];
  shots.sort((a, b) => a.minute - b.minute);
  return Response.json({ shots }, { headers: { "Cache-Control": "private, max-age=60" } });
}
