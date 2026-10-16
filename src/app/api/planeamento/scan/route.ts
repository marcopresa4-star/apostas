// Planeamento Live scan: POST { table, favLabels? } -> games matching every
// criterion, today + tomorrow, across the resolved leagues. Heavy on cold
// cache (incident/statistics reads per sampled game), then cached 30 days.
import { createClient } from "@/lib/supabase/server";
import { LEAGUES } from "@/lib/footballData";
import { todayISO } from "@/lib/searchParams";
import { loadMaps } from "@/lib/sofaHistory";
import { cacheGet, cacheSet } from "@/lib/sofaCache";
import { sanitizeTable } from "@/lib/planeamento";
import { scanTable } from "@/lib/planeamentoEngine";

const SCAN_TTL_MS = 30 * 60_000;

const shift = (date: string, by: number): string => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + by);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { table?: unknown; favLabels?: unknown; refresh?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad-request" }, { status: 400 });
  }
  const table = sanitizeTable(
    body.table as Parameters<typeof sanitizeTable>[0]
  );
  if (!table) return Response.json({ error: "tabela invalida" }, { status: 400 });

  const maps = await loadMaps(supabase, user.id, "tournament").catch(() => []);
  const codes = new Set(maps.map((m) => m.name_key));
  let leagues: string[] = LEAGUES.filter((l) => codes.has(l.code) && !l.code.startsWith("int.")).map((l) => l.code as string);
  if (table.leaguesMode === "custom") {
    leagues = table.leagues.filter((c) => codes.has(c));
  } else if (table.leaguesMode === "favs" && Array.isArray(body.favLabels)) {
    const labels = new Set((body.favLabels as unknown[]).filter((x): x is string => typeof x === "string"));
    const picked = LEAGUES.filter((l) => codes.has(l.code) && labels.has(l.label as string)).map((l) => l.code);
    if (picked.length > 0) leagues = picked;
  }
  if (leagues.length === 0) return Response.json({ jogos: [], semDados: 0, truncated: false, stale: false });

  const today = todayISO(new Date());
  // Repeat views reuse the verdict for 30 minutes (the pattern only shifts
  // as games finish): without this every page open re-reads everything.
  const hash = (): string => {
    const s = JSON.stringify([table.criteria, table.sample, table.venueSplit, leagues]);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  };
  const cacheKey = `plan:${table.id || "new"}:${today}:${hash()}`;
  if (body.refresh !== true) {
    const hit = await cacheGet(supabase, user.id, cacheKey, SCAN_TTL_MS).catch(() => null);
    if (hit && typeof hit === "object" && !Array.isArray(hit)) return Response.json(hit);
  }
  const out = await scanTable(supabase, user.id, table, leagues, today, shift(today, 1));
  await cacheSet(supabase, user.id, cacheKey, out).catch(() => {});
  return Response.json(out);
}
