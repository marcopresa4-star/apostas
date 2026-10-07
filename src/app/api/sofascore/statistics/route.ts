// A few match statistics (possession, shots, corners...) for the widget.
// Proxied like the event/graph routes.
const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";

const NAMES: Record<string, string> = {
  "Ball possession": "Posse de bola",
  "Total shots": "Remates",
  "Shots on target": "Remates à baliza",
  "Corner kicks": "Cantos",
  Fouls: "Faltas",
  "Goalkeeper saves": "Defesas",
  "Big chances": "Grandes chances",
  Passes: "Passes",
  "Accurate passes": "Passes certos",
  Crosses: "Cruzamentos",
  Offsides: "Foras de jogo",
};

export interface StatRow {
  name: string;
  home: string;
  away: string;
}

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  let raw: Response;
  try {
    raw = await fetch(`${SCRAPER}/raw?path=${encodeURIComponent(`/event/${id}/statistics`)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ error: "scraper-offline" }, { status: 503 });
  }
  if (raw.status === 404) return Response.json({ error: "notfound" }, { status: 404 });
  if (!raw.ok) return Response.json({ error: "upstream" }, { status: 502 });
  const body = await raw.json();
  const periods = Array.isArray((body as { statistics?: unknown }).statistics)
    ? ((body as { statistics: unknown[] }).statistics as Record<string, unknown>[])
    : [];
  const all = periods.find((p) => p.period === "ALL") ?? periods[0];
  const groups = Array.isArray(all?.groups) ? (all.groups as Record<string, unknown>[]) : [];
  // Every group, not just the overview: crosses live under Passes, offsides
  // under Attack. First group wins per stat name.
  const items = groups.flatMap((g) =>
    Array.isArray(g?.statisticsItems) ? (g.statisticsItems as Record<string, unknown>[]) : []
  );
  const rows: StatRow[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const name = String(item.name ?? "");
    if (!NAMES[name] || seen.has(NAMES[name])) continue;
    seen.add(NAMES[name]);
    rows.push({ name: NAMES[name], home: String(item.home ?? "—"), away: String(item.away ?? "—") });
    if (rows.length >= 12) break;
  }
  return Response.json({ stats: rows }, { headers: { "Cache-Control": "private, max-age=60" } });
}
