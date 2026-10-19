import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import DayFilters from "@/components/DayFilters";
import DayMatrix, { prewarmUpcomingDays } from "@/components/DayMatrix";
import DayDetail from "@/components/DayDetail";
import { first } from "@/lib/searchParams";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const shift = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayMonth = (date: string): string => {
  const wd = new Date(`${date}T00:00:00`).toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "2-digit" });
  return wd;
};

export default async function JogosDiaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const day = DATE.test(first(params.data)) ? first(params.data) : today;
  const pais = first(params.pais).trim();
  const ligaSel = first(params.liga).trim();
  const equipa = first(params.equipa).trim().toLowerCase();
  const refresh = first(params.refresh) === "1";
  const diretos = first(params.diretos) === "1";
  const detalhada = first(params.vista) === "detalhada";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Ao abrir Jogos por dia, amanhã (e +2) avalia-se em fundo — quando
  // navegares para um dia novo, a matriz e a detalhada já lá estão.
  if (user) prewarmUpcomingDays(supabase, user.id, 2, now);
  const maps = user ? await loadMaps(supabase, user.id, "tournament").catch(() => []) : [];
  const codes = new Set(maps.map((m) => m.name_key));
  const leagues = LEAGUES.filter((l) => codes.has(l.code) && !l.code.startsWith("int."));
  const countryOf = (label: string): string => label.split("·")[0]?.trim() ?? label;
  const countries = [...new Set(leagues.map((l) => countryOf(l.label as string)))].sort((a, b) => a.localeCompare(b));
  const filterLeagues = leagues.map((l) => ({ code: l.code, label: l.label as string, country: countryOf(l.label as string) }));

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Os jogos do dia das ligas mapeadas. Quando um jogo está a decorrer, aparece o minuto e abre direto na
        calculadora live.
      </p>

      <EstatisticasTabs />

      <div className="mb-4 flex max-w-4xl flex-wrap items-center gap-2">
        <Link
          href={`/estatisticas/jogos-dia?${new URLSearchParams({ data: shift(day, -1) })}`}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500"
        >
          ‹
        </Link>
        <Link
          href="/estatisticas/jogos-dia"
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500"
        >
          Hoje
        </Link>
        <Link
          href={`/estatisticas/jogos-dia?${new URLSearchParams({ data: shift(day, 1) })}`}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500"
        >
          ›
        </Link>
        <form method="get" action="/estatisticas/jogos-dia" className="flex items-center gap-2">
          <input
            type="date"
            name="data"
            defaultValue={day}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
          />
          <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500">
            Ver
          </button>
        </form>
        <span className="text-sm text-neutral-400">{dayMonth(day)}</span>
      </div>

      <DayFilters
        day={day}
        countries={countries}
        leagues={filterLeagues}
        initial={{ pais, liga: ligaSel, equipa: first(params.equipa).trim(), diretos: diretos ? "1" : "0", vista: detalhada ? "detalhada" : "compacta" }}
      />

      <Suspense
        key={`${day}|${pais}|${ligaSel}|${equipa}|${refresh ? "r" : ""}|${diretos ? "d" : ""}|${detalhada ? "D" : "c"}`}
        fallback={
          <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
            {detalhada
              ? "A calcular a detalhada… (históricos + odds por jogo: demora minutos à primeira, depois é cache)"
              : "A calcular a matriz… (carrega os históricos das ligas: demora minutos à primeira, depois é cache)"}
          </p>
        }
      >
        {detalhada ? (
          <DayDetail day={day} pais={pais} ligaSel={ligaSel} equipa={equipa} diretos={diretos} refresh={refresh} />
        ) : (
          <DayMatrix day={day} pais={pais} ligaSel={ligaSel} equipa={equipa} diretos={diretos} refresh={refresh} />
        )}
      </Suspense>
    </div>
  );
}
