// Starting lineups with live player ratings for the widget, from the event's
// lineups endpoint (formation, starters, subs used, captain, missing
// players). 404 (no coverage) -> { home: null, away: null, missing: [] }.
const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";

export interface LineupPlayer {
  name: string;
  pos: string;
  num: number | null;
  rating: number | null;
  goals: number;
  xg: number;
  minutes: number;
  captain: boolean;
  sub: boolean;
}

export interface LineupSide {
  formation: string;
  players: LineupPlayer[];
}

const nameOf = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o.shortName === "string" && o.shortName) return o.shortName;
    if (typeof o.name === "string") return o.name;
  }
  return "";
};

const numOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function sideOf(body: unknown, side: string): LineupSide | null {
  const root = (body as Record<string, unknown> | null)?.[side];
  if (typeof root !== "object" || root === null) return null;
  const r = root as Record<string, unknown>;
  const players = Array.isArray(r.players)
    ? (r.players as unknown[]).flatMap((p): LineupPlayer[] => {
        if (typeof p !== "object" || p === null) return [];
        const row = p as Record<string, unknown>;
        const st =
          typeof row.statistics === "object" && row.statistics !== null
            ? (row.statistics as Record<string, unknown>)
            : {};
        const name = nameOf(row.player);
        if (!name) return [];
        return [
          {
            name,
            pos: typeof row.position === "string" ? row.position : "",
            num: numOf(row.shirtNumber) ?? numOf(row.jerseyNumber),
            rating: numOf(st.rating),
            goals: numOf(st.goals) ?? 0,
            xg: typeof st.expectedGoals === "number" ? st.expectedGoals : 0,
            minutes: numOf(st.minutesPlayed) ?? 0,
            captain: row.captain === true,
            sub: row.substitute === true,
          },
        ];
      })
    : [];
  if (players.length === 0) return null;
  return {
    formation: typeof r.formation === "string" ? r.formation : "",
    players,
  };
}

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  let raw: Response;
  try {
    raw = await fetch(`${SCRAPER}/raw?path=${encodeURIComponent(`/event/${id}/lineups`)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ error: "scraper-offline" }, { status: 503 });
  }
  if (raw.status === 404) return Response.json({ home: null, away: null, missing: [] });
  if (!raw.ok) return Response.json({ error: "upstream" }, { status: 502 });
  const body = await raw.json().catch(() => null);
  const missing: { name: string; home: boolean }[] = [];
  for (const [side, isHome] of [["home", true], ["away", false]] as const) {
    const root = (body as Record<string, unknown> | null)?.[side];
    const list =
      typeof root === "object" && root !== null
        ? (root as Record<string, unknown>).missingPlayers
        : null;
    if (Array.isArray(list)) {
      for (const m of list) {
        const name =
          typeof m === "object" && m !== null ? nameOf((m as Record<string, unknown>).player) : "";
        if (name) missing.push({ name, home: isHome });
      }
    }
  }
  return Response.json(
    { home: sideOf(body, "home"), away: sideOf(body, "away"), missing },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
