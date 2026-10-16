import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import type { LiveTableDef } from "@/lib/planeamento";
import PlaneamentoClient from "@/components/PlaneamentoClient";

// PRO page: user-defined pattern tables over the mapped leagues' upcoming
// games (today + tomorrow), to prepare the live session. Each table scans on
// its own (Suspense-like client fetch, cached reads behind it).
export default async function PlaneamentoPage() {
  await requireAdmin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: rows } = user
    ? await supabase
        .from("live_tables")
        .select("id,name,leagues_mode,leagues,sample,venue_split,criteria")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
    : { data: null };
  const tables = ((rows ?? []) as unknown[]).flatMap((r): LiveTableDef[] => {
    if (typeof r !== "object" || r === null) return [];
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string" || !Array.isArray(o.criteria)) return [];
    return [
      {
        id: o.id,
        name: o.name,
        leaguesMode: o.leagues_mode === "favs" || o.leagues_mode === "custom" ? o.leagues_mode : "all",
        leagues: Array.isArray(o.leagues) ? o.leagues.filter((l): l is string => typeof l === "string") : [],
        sample: o.sample === "season" ? "season" : "last10",
        venueSplit: o.venue_split === true,
        criteria: o.criteria as LiveTableDef["criteria"],
      },
    ];
  });
  const maps = user ? await loadMaps(supabase, user.id, "tournament").catch(() => []) : [];
  const codes = new Set(maps.map((m) => m.name_key));
  const leagues = LEAGUES.filter((l) => codes.has(l.code) && !l.code.startsWith("int.")).map((l) => ({
    code: l.code,
    label: l.label as string,
  }));
  const { data: favRows } = user
    ? await supabase.from("favorite_games").select("event_id").eq("user_id", user.id)
    : { data: null };
  const favIds = new Set(
    ((favRows ?? []) as { event_id?: unknown }[])
      .map((r) => r.event_id)
      .filter((n): n is number => typeof n === "number")
  );

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🗂️ Planeamento Live</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Tabelas com os jogos que encaixam nos teus filtros — para preparar o live. Cada tabela vai buscar os jogos de
        hoje e amanhã das ligas e fica só com os que cumprem o padrão.
      </p>
      <PlaneamentoClient tables={tables} leagues={leagues} favIds={[...favIds]} />
    </div>
  );
}
