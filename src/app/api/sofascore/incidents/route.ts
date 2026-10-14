import { createClient } from "@/lib/supabase/server";

// Full incident timeline for one event (goals, cards, substitutions): what
// the "lances do jogo" list and the momentum markers are drawn from. The
// event route only serves the 6 most recent; this serves everything, newest
// last. Proxied through the local scraper like the event route.
const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";

export interface GameIncident {
  minute: number;
  kind: "goal" | "red" | "yellow" | "sub" | "info";
  home: boolean;
  text: string;
}

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

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = Number(params.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  let raw: Response;
  try {
    raw = await fetch(`${SCRAPER}/event?id=${id}&light=1`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return Response.json({ error: "scraper-offline" }, { status: 503 });
  }
  if (raw.status === 404) return Response.json({ error: "notfound" }, { status: 404 });
  if (!raw.ok) return Response.json({ error: "upstream" }, { status: 502 });
  const body = await raw.json();
  const list = Array.isArray((body as { incidents?: unknown })?.incidents)
    ? ((body as { incidents: unknown[] }).incidents as unknown[])
    : [];
  const incidents: GameIncident[] = list
    .flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const inc = item as Record<string, unknown>;
      const time = typeof inc.time === "number" ? inc.time : null;
      if (time === null || time < 0 || time > 130) return [];
      const type = String(inc.incidentType ?? "").toLowerCase();
      if (SKIP_TYPES.has(type)) return [];
      const cls = String(inc.incidentClass ?? "").toLowerCase();
      const kind =
        type.includes("goal") || type.includes("penalt")
          ? ("goal" as const)
          : type.includes("card")
            ? cls.includes("red")
              ? ("red" as const)
              : ("yellow" as const)
            : type.includes("subst")
              ? ("sub" as const)
              : ("info" as const);
      if (kind !== "goal" && kind !== "red" && kind !== "yellow" && kind !== "sub") return [];
      const text =
        kind === "sub"
          ? [nameOf(inc.playerIn), nameOf(inc.playerOut)].every(Boolean)
            ? `Entra ${nameOf(inc.playerIn)} · Sai ${nameOf(inc.playerOut)}`
            : ""
          : nameOf(inc.player) || (typeof inc.playerName === "string" ? (inc.playerName as string) : "");
      if (!text) return [];
      return [{ minute: time, kind, home: inc.isHome === true, text }];
    })
    .sort((a, b) => a.minute - b.minute);
  return Response.json({ incidents }, { headers: { "Cache-Control": "private, max-age=60" } });
}
