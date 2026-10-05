// Logs the first suggestion of each analysed game for continuous
// calibration (hit-rate vs predicted chance on the Calibração tab).
// Fire-and-forget from the report page: never fails loudly.
import { createClient } from "@/lib/supabase/server";

const str = (v: unknown, max = 120): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const b = (body ?? {}) as Record<string, unknown>;
  const league = str(b.league, 24);
  const home = str(b.home);
  const away = str(b.away);
  const matchDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.match_date ?? "")) ? String(b.match_date) : null;
  const picks = Array.isArray(b.picks) ? b.picks.slice(0, 5) : [];
  if (!league || !home || !away || !matchDate || home === away || picks.length === 0) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const rows = [];
  for (const item of picks) {
    const r = (item ?? {}) as Record<string, unknown>;
    const key = str(r.key, 64);
    const group = str(r.group, 16);
    const label = str(r.label);
    const p = num(r.p);
    const base = num(r.base);
    const fair = num(r.fair);
    if (!key || !group || !label || p === null || base === null || fair === null) continue;
    rows.push({ user_id: user.id, league, home, away, match_date: matchDate, pick_key: key, pick_group: group, label, p, base, fair });
  }
  if (rows.length === 0) return Response.json({ error: "bad request" }, { status: 400 });
  const { error } = await supabase
    .from("calibration_picks")
    .upsert(rows, { onConflict: "user_id,league,home,away,match_date,pick_key" });
  if (error) return Response.json({ error: "not stored" }, { status: 500 });
  return Response.json({ ok: true, logged: rows.length });
}
