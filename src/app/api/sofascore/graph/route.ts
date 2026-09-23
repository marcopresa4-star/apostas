// Match momentum graph (attack momentum over minutes) for the widget
// fallback when a game has no live tracker. Proxied like the event route.
const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";

export interface MomentumPoint {
  minute: number;
  value: number;
}

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  let raw: Response;
  try {
    raw = await fetch(`${SCRAPER}/graph?id=${id}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ error: "scraper-offline" }, { status: 503 });
  }
  if (raw.status === 404) return Response.json({ error: "notfound" }, { status: 404 });
  if (!raw.ok) return Response.json({ error: "upstream" }, { status: 502 });
  const body = await raw.json();
  const points: MomentumPoint[] = Array.isArray((body as { graphPoints?: unknown }).graphPoints)
    ? ((body as { graphPoints: unknown[] }).graphPoints.flatMap((p) => {
        if (typeof p !== "object" || p === null) return [];
        const { minute, value } = p as { minute?: unknown; value?: unknown };
        return typeof minute === "number" && typeof value === "number" ? [{ minute, value }] : [];
      }))
    : [];
  return Response.json(
    { points, periodTime: typeof (body as { periodTime?: unknown }).periodTime === "number" ? (body as { periodTime: number }).periodTime : 45 },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
