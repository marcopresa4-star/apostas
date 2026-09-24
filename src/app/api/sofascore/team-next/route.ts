// The next scheduled game of one team (for the command palette): event id,
// sides and kickoff, or nothing when the team has no upcoming game listed.
import { createClient } from "@/lib/supabase/server";
import { sofaRaw } from "@/lib/sofaRaw";

export async function GET(request: Request) {
  const teamId = Number(new URL(request.url).searchParams.get("teamId"));
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return Response.json({ error: "teamId is required" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await sofaRaw<{ events?: unknown[] }>(`/team/${teamId}/events/next/0`).catch(() => null);
  const events = Array.isArray(body?.events) ? body.events : [];
  for (const item of events) {
    const e = (item ?? {}) as Record<string, unknown>;
    const id = typeof e.id === "number" ? e.id : null;
    const status = ((e.status ?? {}) as Record<string, unknown>).type;
    if (id === null || (status !== "notstarted" && status !== "inprogress")) continue;
    const home = ((e.homeTeam ?? {}) as Record<string, unknown>).name;
    const away = ((e.awayTeam ?? {}) as Record<string, unknown>).name;
    const tournament = ((e.tournament ?? {}) as Record<string, unknown>).name;
    const start = typeof e.startTimestamp === "number" ? e.startTimestamp : null;
    if (typeof home !== "string" || typeof away !== "string") continue;
    return Response.json(
      {
        eventId: id,
        home,
        away,
        tournament: typeof tournament === "string" ? tournament : "",
        kickoff: start !== null ? new Date(start * 1000).toISOString() : null,
        live: status === "inprogress",
      },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  }
  return Response.json({ none: true });
}
