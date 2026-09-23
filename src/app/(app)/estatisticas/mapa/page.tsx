import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES, isInternational, loadLeague } from "@/lib/footballData";
import { first } from "@/lib/searchParams";
import { slugify } from "@/lib/slugify";
import { createClient } from "@/lib/supabase/server";
import { loadMaps, searchTeams, searchTournaments, seasonTeamNames, tournamentSeasons } from "@/lib/sofaHistory";
import EstatisticasTabs from "@/components/EstatisticasTabs";
import { AlignTeamsButton, AuditIntlButton, AutoAlignAllTeamsButton, AutoMapAllButton, BootstrapIntlButton, DeleteMapButton, DeleteTeamButton, RepairWrongIntlButton, SaveMapButton, SaveTeamButton } from "./buttons";
import {
  testSofaLeagueAction,
} from "./actions";

// Phase 1 of "SofaScore only": teach the app where each league lives on
// SofaScore (uniqueTournament id). Nothing here feeds the model tabs yet —
// this only proves the mapping + loader + cache chain works end to end.
// Needs the 0033 migration and the local scraper running.
export default async function MapaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const q = first(params.q).trim();
  const liga = first(params.liga);
  const testar = first(params.testar);
  const equipas = first(params.equipas);
  const tq = first(params.tq).trim();
  const equipa = first(params.equipa);
  const selecoes = first(params.selecoes) === "1";
  const tq3 = first(params.tq3).trim();
  const iselecao = first(params.iselecao);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const maps = user ? await loadMaps(supabase, user.id, "tournament") : [];
  const byCode = new Map(maps.map((m) => [m.name_key, m]));
  const leagues = LEAGUES.filter((l) => !isInternational(l.code));

  const results = q ? await searchTournaments(q).catch(() => []) : [];
  const test = testar && byCode.has(testar) ? await testSofaLeagueAction(testar) : null;

  // Teams section for one mapped league: local spellings vs linked SofaScore
  // names, with auto-align and manual search for the leftovers. Leagues
  // without files list the SofaScore names themselves as the universe.
  const teamsLeague = equipas && byCode.has(equipas) ? leagues.find((l) => l.code === equipas) ?? null : null;
  const teamsData = teamsLeague ? await loadLeague(teamsLeague.code, new Date()) : null;
  const teamsMap = teamsLeague ? byCode.get(teamsLeague.code) : undefined;
  let localTeams = teamsData?.teams ?? [];
  if (teamsLeague && localTeams.length === 0 && user && teamsMap) {
    const seasons = await tournamentSeasons(supabase, user.id, teamsMap.sofascore_id).catch(() => []);
    if (seasons.length > 0) {
      localTeams = await seasonTeamNames(supabase, user.id, teamsMap.sofascore_id, seasons[0].id, true).catch(() => []);
    }
  }
  const teamMaps = user && teamsLeague ? await loadMaps(supabase, user.id, "team") : [];
  const teamBySlug = new Map(teamMaps.map((m) => [m.name_key, m]));
  const teamResults = tq ? await searchTeams(tq).catch(() => []) : [];

  // National teams (phase 3b): files spellings vs linked SofaScore sides.
  const { loadInternationalGames, activeTeams } = await import("@/lib/internationalData");
  const intlFiles = selecoes ? (await loadInternationalGames().catch(() => null)) ?? [] : [];
  const intlTeams = selecoes ? activeTeams(intlFiles, new Date()) : [];
  const intlMaps = user && selecoes ? (await loadMaps(supabase, user.id, "team")).filter((m) => m.name_key.startsWith("int:")) : [];
  const intlBySlug = new Map(intlMaps.map((m) => [m.name_key, m]));
  const intlResults = selecoes && tq3 ? await searchTeams(tq3).catch(() => []) : [];

  const field =
    "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-amber-500";
  const mapped = maps.length;

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🧮 Estatísticas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Mapeamento SofaScore (fase 1): dizer onde vive cada liga no SofaScore para o histórico vir de lá em vez dos
        ficheiros. {mapped} de {leagues.length} ligas mapeadas. Precisa da migração 0033 e do scraper ligado.
      </p>

      <EstatisticasTabs />

      <div className="mb-4 max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="flex flex-wrap gap-2">
          {mapped < leagues.length && <AutoMapAllButton />}
          {mapped > 0 && <AutoAlignAllTeamsButton />}
        </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            Uma vez por liga, fica guardado. O mapeamento adivinha a competição de cada país pela mais seguida; o
            alinhamento liga as grafias das equipas. Revê as tabelas depois e usa Testar para confirmar — o que ficar
            por fazer faz-se à mão.
          </p>
        </div>

      {test && test.ok && (
        <div className="mb-4 max-w-4xl rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-5">
          <p className="text-sm font-semibold text-emerald-300">
            {test.tournament}: {test.finishedGames} jogos terminados em {test.currentRounds} jornadas (época atual)
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            Épocas no SofaScore: {test.seasons.map((s) => s.name).join(" · ")}
            {test.latest ? ` · último resultado ${test.latest.slice(8, 10)}/${test.latest.slice(5, 7)}/${test.latest.slice(0, 4)}` : ""}
          </p>
        </div>
      )}
      {test && !test.ok && (
        <p className="mb-4 max-w-4xl rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">{test.error}</p>
      )}

      <form method="get" action="/estatisticas/mapa" className="mb-4 max-w-4xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_16rem_auto]">
          <input type="text" name="q" defaultValue={q} placeholder="Procurar competição no SofaScore (ex: Liga Portugal)" className={field} />
          <select name="liga" defaultValue={liga} className={field}>
            <option value="">Para a liga…</option>
            {leagues.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white transition hover:bg-amber-500">
            Procurar
          </button>
        </div>
        {q && results.length === 0 && (
          <p className="mt-2 text-xs text-red-300">Nada encontrado (ou o scraper está desligado).</p>
        )}
      </form>

      {results.length > 0 && (
        <div className="mb-4 max-w-4xl space-y-2">
          {results.map((r) => (
            <div key={`${r.kind}:${r.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5">
              <div>
                <p className="text-sm font-medium text-neutral-100">{r.name}</p>
                <p className="text-[11px] text-neutral-500">
                  {r.category ? `${r.category} · ` : ""}id {r.uniqueId ?? r.id}
                  {r.uniqueId ? "" : " (sem épocas: escolhe outro)"}
                </p>
              </div>
              {liga && r.uniqueId ? (
                <SaveMapButton leagueCode={liga} candidate={r} />
              ) : (
                <p className="text-[11px] text-neutral-600">Escolhe a liga em cima para mapear.</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="max-w-4xl overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2 font-semibold">Liga</th>
              <th className="px-3 py-2 font-semibold">SofaScore</th>
              <th className="px-3 py-2 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/70">
            {leagues.map((l) => {
              const m = byCode.get(l.code);
              return (
                <tr key={l.code}>
                  <td className="px-3 py-2.5 text-neutral-200">{l.label}</td>
                  <td className="px-3 py-2.5 text-xs text-neutral-400">
                    {m ? (
                      <>
                        <span className="font-medium text-emerald-400">{m.name}</span> · id {m.sofascore_id}
                      </>
                    ) : (
                      <span className="text-neutral-600">por mapear</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex justify-end gap-3">
                      {m && (
                        <>
                          <a
                            href={`/estatisticas/mapa?${new URLSearchParams({ testar: l.code })}`}
                            className="text-xs font-medium text-amber-400 hover:underline"
                          >
                            Testar
                          </a>
                          <a
                            href={`/estatisticas/mapa?${new URLSearchParams({ equipas: l.code })}`}
                            className="text-xs font-medium text-sky-400 hover:underline"
                          >
                            Equipas
                          </a>
                          <DeleteMapButton leagueCode={l.code} />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 max-w-4xl text-[11px] leading-relaxed text-neutral-600">
        “Testar” lê as épocas, as jornadas da época atual e os jogos terminados através do scraper (lento à primeira,
        instantâneo depois, por causa da cache). As seleções ficam para depois: ainda não há mapeamento de torneios de
        seleções.
      </p>

      {teamsLeague && (
        <section className="mt-6 max-w-4xl">
          <h2 className="mb-2 text-sm font-semibold text-neutral-200">
            Equipas · {teamsLeague.label}
            <a href="/estatisticas/mapa" className="ml-2 text-xs font-normal text-neutral-500 hover:underline">
              fechar
            </a>
          </h2>
          <div className="mb-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <AlignTeamsButton leagueCode={teamsLeague.code} />
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
              Liga as grafias locais às do SofaScore (ex: Sporting ↔ Sporting CP). O que ficar por ligar liga-se à mão
              em baixo.
            </p>
          </div>

          <form method="get" action="/estatisticas/mapa" className="mb-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <input type="hidden" name="equipas" value={teamsLeague.code} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_16rem_auto]">
              <input type="text" name="tq" defaultValue={tq} placeholder="Procurar equipa no SofaScore" className={field} />
              <select name="equipa" defaultValue={equipa} className={field}>
                <option value="">Para a equipa…</option>
                {localTeams.map((t) => (
                  <option key={t} value={slugify(t)}>
                    {t}
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white transition hover:bg-amber-500">
                Procurar
              </button>
            </div>
          </form>

          {teamResults.length > 0 && (
            <div className="mb-3 space-y-2">
              {teamResults.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-neutral-100">{r.name}</p>
                    <p className="text-[11px] text-neutral-500">id {r.id}</p>
                  </div>
                  {equipa ? (
                    <SaveTeamButton
                      localSlug={equipa}
                      localName={localTeams.find((t) => slugify(t) === equipa) ?? equipa}
                      candidate={r}
                    />
                  ) : (
                    <p className="text-[11px] text-neutral-600">Escolhe a equipa em cima para ligar.</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2 font-semibold">Equipa (ficheiros)</th>
                  <th className="px-3 py-2 font-semibold">SofaScore</th>
                  <th className="px-3 py-2 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/70">
                {localTeams.map((t) => {
                  const m = teamBySlug.get(slugify(t));
                  return (
                    <tr key={t}>
                      <td className="px-3 py-2 text-neutral-200">{t}</td>
                      <td className="px-3 py-2 text-xs text-neutral-400">
                        {m ? <span className="font-medium text-emerald-400">{m.name}</span> : <span className="text-neutral-600">por ligar</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{m && <DeleteTeamButton localSlug={slugify(t)} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="mt-6 max-w-4xl">
        <a href={selecoes ? "/estatisticas/mapa" : "/estatisticas/mapa?selecoes=1"} className="text-sm font-semibold text-neutral-200 hover:underline">
          {selecoes ? "Seleções · fechar" : `Seleções (${intlMaps.length} ligadas)`}
        </a>
      </div>

      {selecoes && (
        <section className="mt-2 max-w-4xl">
          <div className="mb-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex flex-wrap gap-2">
              <BootstrapIntlButton />
              <RepairWrongIntlButton />
              <AuditIntlButton />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
              Liga cada seleção à sua equipa nacional no SofaScore (só futebol). O que ficar por ligar liga-se à mão
              em baixo.
            </p>
          </div>

          <form method="get" action="/estatisticas/mapa" className="mb-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <input type="hidden" name="selecoes" value="1" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_16rem_auto]">
              <input type="text" name="tq3" defaultValue={tq3} placeholder="Procurar seleção no SofaScore" className={field} />
              <select name="iselecao" defaultValue={iselecao} className={field}>
                <option value="">Para a seleção…</option>
                {intlTeams.map((t) => (
                  <option key={t} value={`int:${slugify(t)}`}>
                    {t}
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded-lg bg-amber-600 px-4 py-2 font-medium text-white transition hover:bg-amber-500">
                Procurar
              </button>
            </div>
          </form>

          {intlResults.length > 0 && (
            <div className="mb-3 space-y-2">
              {intlResults
                .filter((r) => r.national)
                .map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-neutral-100">{r.name}</p>
                      <p className="text-[11px] text-neutral-500">id {r.id}</p>
                    </div>
                    {iselecao ? (
                      <SaveTeamButton
                        localSlug={iselecao}
                        localName={intlTeams.find((t) => `int:${slugify(t)}` === iselecao) ?? iselecao}
                        candidate={r}
                      />
                    ) : (
                      <p className="text-[11px] text-neutral-600">Escolhe a seleção em cima para ligar.</p>
                    )}
                  </div>
                ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2 font-semibold">Seleção (ficheiros)</th>
                  <th className="px-3 py-2 font-semibold">SofaScore</th>
                  <th className="px-3 py-2 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/70">
                {intlTeams.map((t) => {
                  const m = intlBySlug.get(`int:${slugify(t)}`);
                  return (
                    <tr key={t}>
                      <td className="px-3 py-2 text-neutral-200">{t}</td>
                      <td className="px-3 py-2 text-xs text-neutral-400">
                        {m ? <span className="font-medium text-emerald-400">{m.name}</span> : <span className="text-neutral-600">por ligar</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{m && <DeleteTeamButton localSlug={`int:${slugify(t)}`} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
