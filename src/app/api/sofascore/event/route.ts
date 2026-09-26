import { parseSofascoreEvent, lastSofascoreChange } from "@/lib/sofascore";
import { checkLive } from "@/lib/sportscoreLive";

// One match's live status from SofaScore, via the local CloakBrowser scraper.
// The app never calls SofaScore directly (Cloudflare answers 403 to datacenter
// fetch): it asks the scraper on SOFASCORE_SCRAPER_URL, which reads SofaScore's
// own JSON API inside a cleared browser page. Scraper offline -> 503 with
// { error: "scraper-offline" }, and the UI falls back to manual entry.
const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = Number(params.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  const light = params.get("light") === "1";
  let raw: Response;
  try {
    raw = await fetch(`${SCRAPER}/event?id=${id}${light ? "&light=1" : ""}`, {
      cache: "no-store",
      // First poll per match navigates the scraper's page to the event.
      // Light reads skip that entirely, so they get a shorter leash.
      signal: AbortSignal.timeout(light ? 12_000 : 30_000),
    });
  } catch {
    return Response.json(
      { error: "scraper-offline", hint: "Liga o scraper local (scraper/npm start)." },
      { status: 503 }
    );
  }
  if (raw.status === 404) return Response.json({ error: "notfound" }, { status: 404 });
  if (!raw.ok) {
    const body = await raw.json().catch(() => null);
    return Response.json(
      { error: "upstream", detail: (body as { error?: string } | null)?.error ?? null },
      { status: 502 }
    );
  }
  const body = await raw.json();
  const fetchedAt = Date.now();
  // Recent incidents for the widget timeline (newest first, max 6).
  // Skips whistle/stoppage markers ("period", "injuryTime") and reads the
  // names the way each incident type carries them: substitutions use
  // playerIn/playerOut, the rest use player (string or object).
  const SKIP_TYPES = new Set(["period", "injurytime"]);
  const nameOf = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (typeof v === "object" && v !== null) {
      const o = v as Record<string, unknown>;
      if (typeof o.shortName === "string" && o.shortName) return o.shortName;
      if (typeof o.name === "string") return o.name;
    }
    return "";
  };
  const recent = Array.isArray(body.incidents)
    ? (body.incidents as unknown[])
        .flatMap((item) => {
          if (typeof item !== "object" || item === null) return [];
          const inc = item as Record<string, unknown>;
          const time = typeof inc.time === "number" ? inc.time : null;
          if (time === null) return [];
          const type = String(inc.incidentType ?? "").toLowerCase();
          if (SKIP_TYPES.has(type)) return [];
          const cls = String(inc.incidentClass ?? "").toLowerCase();
          const kind =
            type.includes("goal") || type.includes("penalt") ? "goal"
            : type.includes("card") ? (cls.includes("red") ? "red" : "yellow")
            : type.includes("subst") ? "sub"
            : "info";
          const text =
            kind === "sub"
              ? [nameOf(inc.playerIn), nameOf(inc.playerOut)].every(Boolean)
                ? `Entra ${nameOf(inc.playerIn)} · Sai ${nameOf(inc.playerOut)}`
                : ""
              : nameOf(inc.player) || (typeof inc.playerName === "string" ? (inc.playerName as string) : "");
          if (!text) return [];
          return [
            {
              minute: time,
              kind,
              home: inc.isHome === true,
              text,
            },
          ];
        })
        .sort((a, b) => b.minute - a.minute)
        .slice(0, 6)
    : [];
  let state = parseSofascoreEvent(body.event ?? body, { incidents: body.incidents ?? [] }, fetchedAt, fetchedAt);
  if (!state) return Response.json({ error: "unparseable" }, { status: 502 });
  // The minute SofaScore actually displays (read from the rendered page by the
  // scraper) beats the derived one — descriptions are often just "2nd half".
  // But it may lag (a stale page read once returned an incident minute), or
  // spike (a "90'" axis label read as the clock): it can confirm or nudge the
  // minute forward, never drag it back — and a reading far above the derived
  // minute is discarded outright instead of dragging everything with it.
  const shown = typeof body.displayMinute === "number" ? Math.trunc(body.displayMinute) : null;
  const saneShown =
    shown !== null && shown >= 0 && shown <= 130 && (state.minute === null || shown <= state.minute + 5)
      ? shown
      : null;
  if (saneShown !== null) {
    const minute = state.phase === "halftime" ? 45 : Math.max(state.minute ?? saneShown, saneShown);
    state = {
      ...state,
      phase: state.phase === "unknown" && minute > 0 ? "live" : state.phase,
      minute,
      raw: { ...state.raw, liveMinute: `${minute}'` },
    };
  }
  const checked = checkLive(state, fetchedAt);
  const notes = [...checked.notes];
  // Frozen event: SofaScore says "in progress" but recorded nothing for a long
  // while (status stuck after the whistle). A warning, not a rejection — the
  // reading itself may still be the best available.
  const lastChange = lastSofascoreChange(body.event ?? body);
  if (
    (checked.state.phase === "live" || checked.state.phase === "halftime") &&
    lastChange !== null &&
    fetchedAt - lastChange > 15 * 60_000
  ) {
    notes.push(
      `Sem novidades no SofaScore há ${Math.round((fetchedAt - lastChange) / 60_000)} min: o jogo pode estar parado ou já ter acabado. Confirma o resultado à mão.`
    );
  }
  return Response.json(
    {
      state: checked.state,
      stale: checked.stale,
      ageMs: checked.ageMs,
      notes,
      hasTracker: typeof body.hasTracker === "boolean" ? body.hasTracker : null,
      recent,
      meta: eventMeta(body.event ?? body),
    },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}

// What the bet form auto-fills from a pasted link: teams, tournament and
// kickoff, so nobody types them by hand.
function eventMeta(event: unknown): {
  home: string;
  away: string;
  tournament: string;
  kickoff: string | null;
} {
  const e = (event ?? {}) as Record<string, unknown>;
  const home = ((e.homeTeam ?? {}) as Record<string, unknown>).name;
  const away = ((e.awayTeam ?? {}) as Record<string, unknown>).name;
  const tournament = ((e.tournament ?? {}) as Record<string, unknown>).name;
  const start = typeof e.startTimestamp === "number" ? e.startTimestamp : null;
  return {
    home: typeof home === "string" ? home : "",
    away: typeof away === "string" ? away : "",
    tournament: typeof tournament === "string" ? tournament : "",
    kickoff: start !== null ? new Date(start * 1000).toISOString() : null,
  };
}
