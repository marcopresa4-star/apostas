import type { H2HPattern, VenueSplit } from "@/lib/headToHeadPattern";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const one = (x: number) => x.toFixed(1).replace(".", ",");
const shortDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "2-digit" });

const CHIP = {
  V: "bg-emerald-600 text-white",
  E: "bg-neutral-600 text-white",
  D: "bg-red-600 text-white",
} as const;

// One way round: the team at home, with how those games went.
function VenueBlock({ host, guest, split }: { host: string; guest: string; split: VenueSplit | null }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        Com {host} em casa {split ? `· ${split.games} ${split.games === 1 ? "jogo" : "jogos"}` : ""}
      </p>
      {!split ? (
        <p className="mt-2 text-xs text-neutral-500">Nunca jogaram desta maneira nos dados.</p>
      ) : (
        <>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-neutral-800">
            <div className="bg-emerald-500" style={{ width: `${(split.hostWins / split.games) * 100}%` }} />
            <div className="bg-neutral-500" style={{ width: `${(split.draws / split.games) * 100}%` }} />
            <div className="bg-sky-500" style={{ width: `${(split.guestWins / split.games) * 100}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-neutral-300">
            <span className="text-emerald-400">●</span> {host} {split.hostWins} · <span className="text-neutral-400">●</span>{" "}
            empates {split.draws} · <span className="text-sky-400">●</span> {guest} {split.guestWins}
          </p>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-neutral-500">Golos por jogo</dt>
            <dd className="text-right text-neutral-200">
              {one(split.hostGoals)} – {one(split.guestGoals)}
            </dd>
            <dt className="text-neutral-500">Mais de 2,5 golos</dt>
            <dd className="text-right text-neutral-200">{pct(split.over25)}</dd>
            <dt className="text-neutral-500">Ambas marcam</dt>
            <dd className="text-right text-neutral-200">{pct(split.btts)}</dd>
          </dl>
          {split.games < 5 && <p className="mt-1.5 text-[11px] text-amber-400">Poucos jogos: pode ser só acaso.</p>}
        </>
      )}
    </div>
  );
}

// What the meetings between the two teams have in common, keeping track of who
// played at home. `homeChance` is what the model gives the home team to win.
export default function H2HPatternCard({
  pattern,
  home,
  away,
  from,
  homeChance,
  international = false,
}: {
  pattern: H2HPattern;
  home: string;
  away: string;
  from: string | null;
  homeChance: number;
  // National teams: the games are of every competition, from the year `from`.
  international?: boolean;
}) {
  if (pattern.total === 0) return null;
  const s = pattern.homeAtHome;
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-sm font-semibold text-neutral-300">Padrão dos confrontos diretos</h2>
      <p className="mb-3 text-xs text-neutral-500">
        {pattern.total} {pattern.total === 1 ? "jogo" : "jogos"} {international ? "entre seleções" : "nesta liga"}
        {from ? `, desde ${international ? "" : "a época "}${from}` : ""}. Média de{" "}
        {one(pattern.goalsPerGame)} golos por jogo, mais de 2,5 golos em {pct(pattern.over25)} e ambas marcam em{" "}
        {pct(pattern.btts)}.
      </p>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <VenueBlock host={home} guest={away} split={pattern.homeAtHome} />
        <VenueBlock host={away} guest={home} split={pattern.awayAtHome} />
      </div>
      {pattern.neutral && (
        <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Em campo neutro · {pattern.neutral.games} {pattern.neutral.games === 1 ? "jogo" : "jogos"}
          </p>
          <p className="mt-1 text-xs text-neutral-300">
            {home} {pattern.neutral.homeWins} · empates {pattern.neutral.draws} · {away} {pattern.neutral.awayWins}
          </p>
          <p className="mt-1 text-[11px] text-neutral-500">
            Nestes jogos (Mundial, fases finais) ninguém jogou em casa, por isso não entram nos dois quadros de cima.
          </p>
        </div>
      )}

      <div className="mt-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Últimos jogos, do ponto de vista de {home}
        </p>
        <div className="flex flex-wrap gap-2">
          {pattern.recent.map((r) => (
            <span key={`${r.date}-${r.score}`} className="flex flex-col items-center gap-0.5">
              <span className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-bold ${CHIP[r.result]}`}>
                {r.result}
              </span>
              <span className="text-[10px] leading-none text-neutral-300">{r.score}</span>
              <span className="text-[10px] leading-none text-neutral-500">
                {r.neutral ? "neutro" : r.homeWasHost ? "casa" : "fora"} · {shortDate(r.date)}
              </span>
            </span>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-neutral-500">
          Golos de {home} primeiro, seja em casa, fora ou em campo neutro.
        </p>
      </div>

      <div className="mt-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">O que se destaca</p>
        {pattern.notes.length === 0 ? (
          <p className="text-xs text-neutral-500">Nada de marcante: os jogos não têm um padrão claro (ou há poucos).</p>
        ) : (
          <ul className="list-disc space-y-1 pl-4 text-xs text-neutral-300 marker:text-neutral-600">
            {pattern.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>

      {s && s.games >= 3 && (
        <p className="mt-3 text-xs text-neutral-400">
          Para comparar: o modelo dá {pct(homeChance)} de vitória a {home}; nos {s.games} jogos em que jogou em casa
          frente a {away} ganhou {s.hostWins} ({pct(s.hostWins / s.games)}).
        </p>
      )}

      {international ? (
        <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
          O que vale isto? Nas seleções há muito menos jogos entre as mesmas duas equipas, e o plantel muda de um jogo
          para o outro: trata os padrões como curiosidade. Não testei o valor deste historial nas seleções, e o modelo
          não o usa nas contas (usa o ataque e a defesa de cada seleção).
        </p>
      ) : (
      <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
        O que vale isto? Testei nos jogos de 2025/26 com pelo menos 4 confrontos anteriores. No <span className="text-neutral-400">resultado</span>{" "}
        há alguma informação: quando um dos lados dominava o historial (65% dos pontos ou mais), ganhou mais do que o
        modelo previa, uns 3 a 5 pontos percentuais. Nos <span className="text-neutral-400">golos e em ambas marcam</span>{" "}
        não ajudou: os pares com muitos golos antes não os repetiram mais do que o modelo dizia. Por isso trata os padrões
        de golos como curiosidade. Com poucos jogos (2 ou 3) é quase só acaso. O modelo ainda não usa este historial nas
        contas.
      </p>
      )}
    </div>
  );
}
