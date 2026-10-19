import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import AutoRefresh from "@/components/AutoRefresh";
import {
  dayList,
  dayModelKey,
  ensureDayModels,
  leagueOptions,
  prewarmUpcomingDaysLite,
  readModelBucket,
  type LiteLeague,
} from "@/lib/dayLite";
import { first } from "@/lib/searchParams";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const shift = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayMonth = (date: string): string =>
  new Date(`${date}T00:00:00`).toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "2-digit" });
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : "–");

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <p className="text-sm text-neutral-400">Sem sessão.</p>;

  // Selects dos filtros (todas as ligas mapeadas, independentes do dia).
  const mapsAll = await loadMaps(supabase, user.id, "tournament").catch(() => []);
  const codesAll = new Set(mapsAll.map((m) => m.name_key));
  const countryOf = (label: string): string => label.split("·")[0]?.trim() ?? label;
  const allLeagues = LEAGUES.filter((l) => codesAll.has(l.code) && !l.code.startsWith("int."));
  const countries = [...new Set(allLeagues.map((l) => countryOf(l.label as string)))].sort((a, b) => a.localeCompare(b));
  const filterLeagues = allLeagues
    .filter((l) => !pais || countryOf(l.label as string) === pais)
    .map((l) => ({ code: l.code, label: l.label as string }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // 1) Lista de jogos (sonda leve, cache 30 min) — abre sempre em segundos.
  const list = await dayList(supabase, user.id, day, pais, ligaSel);
  const filtered: LiteLeague[] = equipa
    ? list
        .map((l) => ({ ...l, rows: l.rows.filter((r) => r.home.toLowerCase().includes(equipa) || r.away.toLowerCase().includes(equipa)) }))
        .filter((l) => l.rows.length > 0)
    : list;

  // 2) Modelo por liga: lança o que falta em fundo e lê os blocos já prontos.
  ensureDayModels(supabase, user.id, day, filtered);
  if (pais === "" && ligaSel === "") prewarmUpcomingDaysLite(supabase, user.id, 2, now);
  const buckets = await Promise.all(
    filtered.map(async (l) => {
      const st = await readModelBucket(supabase, user.id, day, l.code);
      return { league: l, ...st, inflightKey: dayModelKey(day, l.code) };
    })
  );
  const pending = buckets.filter((b) => b.pending).length;
  const refreshing = buckets.filter((b) => b.refreshing || b.bucket?.failed).length;
  const nGames = filtered.reduce((a, l) => a + l.rows.length, 0);

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Os jogos do dia das ligas mapeadas. A lista abre já; o modelo pinta liga a liga em fundo — uma liga em falta nunca
        refaz as outras.
      </p>

      <EstatisticasTabs />

      <div className="mb-4 flex max-w-4xl flex-wrap items-center gap-2">
        <Link
          href={`/estatisticas/jogos-dia?${new URLSearchParams({ data: shift(day, -1), ...(pais ? { pais } : {}), ...(ligaSel ? { liga: ligaSel } : {}) })}`}
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
          href={`/estatisticas/jogos-dia?${new URLSearchParams({ data: shift(day, 1), ...(pais ? { pais } : {}), ...(ligaSel ? { liga: ligaSel } : {}) })}`}
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
          <input type="hidden" name="pais" value={pais} />
          <input type="hidden" name="liga" value={ligaSel} />
          <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500">
            Ver
          </button>
        </form>
        <span className="text-sm text-neutral-400">{dayMonth(day)}</span>
      </div>

      <form method="get" action="/estatisticas/jogos-dia" className="mb-4 flex max-w-4xl flex-wrap items-center gap-2">
        <input type="hidden" name="data" value={day} />
        <select
          name="pais"
          defaultValue={pais}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none"
        >
          <option value="">Todos os países</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          name="liga"
          defaultValue={ligaSel}
          className="max-w-56 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none"
        >
          <option value="">Todas as ligas</option>
          {filterLeagues.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="equipa"
          defaultValue={first(params.equipa).trim()}
          placeholder="Filtrar por equipa…"
          className="w-44 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-500"
        />
        <button type="submit" className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:border-neutral-500">
          Filtrar
        </button>
      </form>

      <AutoRefresh active={pending > 0 || refreshing > 0} />

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-500">
        <span>
          {nGames} jogo{nGames === 1 ? "" : "s"} · 1X2 + sobre 2,5 + ambas (% do modelo, sem odds) ·{" "}
          <Link
            href={`/estatisticas/jogos-dia?${new URLSearchParams({ data: day, ...(pais ? { pais } : {}), ...(ligaSel ? { liga: ligaSel } : {}), ...(equipa ? { equipa: first(params.equipa).trim() } : {}) })}`}
            className="text-neutral-400 hover:text-neutral-200 hover:underline"
          >
            refrescar
          </Link>
        </span>
        {pending > 0 && <span className="text-sky-300">Modelo a calcular em {pending} ligas — recarrega em ~1 min.</span>}
        {pending === 0 && refreshing > 0 && (
          <span className="text-amber-300">
            {refreshing} liga{refreshing === 1 ? "" : "s"} por refrescar (em fundo) — recarrega em ~1 min.
          </span>
        )}
      </div>

      <p className="mb-4 max-w-4xl text-[11px] leading-relaxed text-neutral-600">
        Linhas esbatidas: menos de 5 jogos da competição nos dados — estimativa frágil. «–»: a equipa não casou com os dados
        da época (grafia desatualizada; liga no Mapa → Equipas, se importa). Sem odds reais nem cantos/cartões: o histórico
        não traz esses dados.
      </p>

      {filtered.length === 0 ? (
        <p className="max-w-4xl rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-sm text-neutral-500">
          Sem jogos para este dia nos filtros escolhidos.
        </p>
      ) : (
        filtered.map((l) => {
          const b = buckets.find((x) => x.league.code === l.code);
          const model = new Map((b?.bucket?.model ?? []).map((m) => [m.eventId, m]));
          return (
            <div key={l.code} className="mb-3 overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
              <p className="border-b border-neutral-800 bg-neutral-800/40 px-4 py-2 text-sm font-semibold text-neutral-200">
                {l.label} · {l.rows.length} {l.rows.length === 1 ? "jogo" : "jogos"}
                {b?.pending && <span className="ml-2 text-[11px] font-normal text-sky-300">modelo a calcular…</span>}
                {b?.bucket?.failed && <span className="ml-2 text-[11px] font-normal text-amber-300">sem leitura agora</span>}
              </p>
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                    <th className="px-4 py-2 font-medium">Hora</th>
                    <th className="px-2 py-2 font-medium">Casa</th>
                    <th className="px-2 py-2 font-medium">Fora</th>
                    <th className="px-2 py-2 text-right font-medium">1</th>
                    <th className="px-2 py-2 text-right font-medium">X</th>
                    <th className="px-2 py-2 text-right font-medium">2</th>
                    <th className="px-2 py-2 text-right font-medium">+2,5</th>
                    <th className="px-4 py-2 text-right font-medium">Ambas</th>
                  </tr>
                </thead>
                <tbody>
                  {l.rows.map((r) => {
                    const m = model.get(r.eventId);
                    const cells = m?.cells;
                    const fragile = m?.fragile === true;
                    return (
                      <tr
                        key={r.eventId}
                        className={`border-t border-neutral-800 ${m ? "" : "text-neutral-500"} ${fragile ? "opacity-60" : ""}`}
                      >
                        <td className="px-4 py-2 tabular-nums text-neutral-400">{hhmm(r.time)}</td>
                        <td className="px-2 py-2 font-medium text-neutral-200">{r.home}</td>
                        <td className="px-2 py-2 font-medium text-neutral-200">{r.away}</td>
                        {cells ? (
                          <>
                            <td className="px-2 py-2 text-right tabular-nums text-neutral-200">{pct(cells.h)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-neutral-400">{pct(cells.d)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-neutral-200">{pct(cells.a)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-neutral-300">{pct(cells.o25)}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-neutral-300">{pct(cells.btts)}</td>
                          </>
                        ) : (
                          <td colSpan={5} className="px-2 py-2 text-right text-neutral-600">
                            {b?.bucket?.failed ? "sem leitura" : "…"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}
