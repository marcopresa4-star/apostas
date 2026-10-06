// Forecast dashboard for the Previsão tab: the model's numbers in cards, each
// with the pp delta against what actually happens in this league (the base
// rates) and the fair odd. Same numbers as the market tables below — only
// the presentation is new. Second-half splits marked ~ use the same
// independent-Poisson approximation as the halves markets (untested).
import { leagueRates, type PlayedMatch, type Prediction } from "@/lib/footballModel";
import { baseRates } from "@/lib/recommendation";
import { formatOdd } from "@/lib/multiples";

const pct1 = (p: number): string => `${(p * 100).toFixed(1).replace(".", ",")}%`;
const pp = (p: number, base: number): string => {
  const d = (p - base) * 100;
  return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1).replace(".", ",")}pp`;
};
const ppCls = (p: number, base: number): string => (p >= base ? "text-emerald-400" : "text-red-400");
const arrow = (p: number, base: number): string => (p >= base ? "↑" : "↓");

function poissonOver(mu: number, line: number): number {
  let p = 1;
  let acc = 0;
  for (let k = 0; k <= Math.floor(line) + 12; k++) {
    if (k > 0) p *= mu / k;
    else p = Math.exp(-mu);
    if (k > line) acc += p;
  }
  return acc;
}

function poissonUnder(mu: number, line: number): number {
  return 1 - poissonOver(mu, line);
}

function Cell({ big, sub, delta }: { big: string; sub?: string; delta?: { p: number; base: number } }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-lg font-bold tabular-nums text-neutral-100">{big}</p>
      {sub && <p className="truncate text-[11px] text-neutral-500">{sub}</p>}
      {delta && (
        <p className={`text-[11px] font-medium tabular-nums ${ppCls(delta.p, delta.base)}`}>
          {arrow(delta.p, delta.base)} {pp(delta.p, delta.base)}
        </p>
      )}
    </div>
  );
}

function Title({ children }: { children: string }) {
  return <h3 className="mb-3 text-sm font-semibold text-neutral-200">{children}</h3>;
}

export default function ForecastDashboard({
  prediction,
  matches,
  home,
  away,
  now,
}: {
  prediction: Prediction;
  matches: PlayedMatch[];
  home: string;
  away: string;
  now: Date;
}) {
  const base = baseRates(matches);
  const fhs = leagueRates(matches, now).firstHalfShare;
  const ft = prediction.fullTime;
  const ht = prediction.halfTime;
  const withHt = matches.filter((m) => m.ht !== null && m.ht !== undefined);
  const nHt = withHt.length;
  const htHist = (test: (h: number, a: number) => boolean): number =>
    nHt > 0 ? withHt.filter((m) => test(m.ht![0], m.ht![1])).length / nHt : 0;
  const teamHtGoals = (team: string): number[] =>
    withHt.map((m) => (m.team1 === team ? m.ht![0] : m.ht![1]));
  const teamHist = (team: string, line: number): number => {
    const gs = matches.flatMap((m) => (m.team1 === team ? [m.ft[0]] : m.team2 === team ? [m.ft[1]] : []));
    return gs.length > 0 ? gs.filter((g) => g > line).length / gs.length : 0;
  };
  const teamHtHist = (team: string, line: number): number => {
    const gs = teamHtGoals(team);
    return gs.length > 0 ? gs.filter((g) => g > line).length / gs.length : 0;
  };
  const lh1 = prediction.lambdaHome * fhs;
  const la1 = prediction.lambdaAway * fhs;
  const lh2 = prediction.lambdaHome * (1 - fhs);
  const la2 = prediction.lambdaAway * (1 - fhs);
  const t1 = lh1 + la1;
  const t2 = lh2 + la2;
  const bttsHt = (1 - Math.exp(-lh1)) * (1 - Math.exp(-la1));
  const btts2 = (1 - Math.exp(-lh2)) * (1 - Math.exp(-la2));
  const teamHt = (team: string): { over05: number; over15: number } => {
    const isHome = team === home;
    return isHome
      ? { over05: ht.homeOver05, over15: ht.homeOver15 }
      : { over05: ht.awayOver05, over15: ht.awayOver15 };
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <Title>Resultado do jogo (1X2)</Title>
        <div className="grid grid-cols-3 gap-2 text-center">
          {(
            [
              { label: "Casa", p: ft.home, base: base.home },
              { label: "Empate", p: ft.draw, base: base.draw },
              { label: "Fora", p: ft.away, base: base.away },
            ] as const
          ).map((r) => (
            <div key={r.label}>
              <p className="text-[11px] uppercase tracking-wide text-neutral-500">{r.label}</p>
              <p className="text-2xl font-bold tabular-nums tracking-tight text-neutral-100">{pct1(r.p)}</p>
              <p className={`text-[11px] font-medium tabular-nums ${ppCls(r.p, r.base)}`}>
                {arrow(r.p, r.base)} {pp(r.p, r.base)}
              </p>
              <p className="text-[11px] text-neutral-500">Odd justa {formatOdd(1 / r.p)}</p>
              <p className="text-[11px] text-neutral-500">Histórico {pct1(r.base)}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-neutral-800 pt-3 text-center">
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">1ª parte</p>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  { label: "Casa", p: ht.home, base: htHist((h, a) => h > a) },
                  { label: "Empate", p: ht.draw, base: htHist((h, a) => h === a) },
                  { label: "Fora", p: ht.away, base: htHist((h, a) => h < a) },
                ] as const
              ).map((r) => (
                <div key={r.label}>
                  <p className="text-sm font-bold tabular-nums text-neutral-100">{pct1(r.p)}</p>
                  <p className="text-[11px] text-neutral-500">{r.label}</p>
                  <p className={`text-[11px] font-medium tabular-nums ${ppCls(r.p, r.base)}`}>
                    {arrow(r.p, r.base)} {pp(r.p, r.base)}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">2ª parte ~</p>
            <p className="text-[11px] text-neutral-500">Só golos (sem 1X2 de parte no modelo).</p>
            <p className="mt-1 text-sm font-bold tabular-nums text-neutral-100">{t2.toFixed(2).replace(".", ",")}</p>
            <p className="text-[11px] text-neutral-500">golos esperados</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <Title>Golos esperados</Title>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Jogo completo</p>
            <p className="text-2xl font-bold tabular-nums text-neutral-100">{(prediction.lambdaHome + prediction.lambdaAway).toFixed(2).replace(".", ",")}</p>
            <p className="text-[11px] text-neutral-500">golos esperados</p>
            <p className="mt-1 text-xs text-neutral-300">
              Casa {prediction.lambdaHome.toFixed(2).replace(".", ",")} · Fora {prediction.lambdaAway.toFixed(2).replace(".", ",")}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">1ª parte</p>
            <p className="text-2xl font-bold tabular-nums text-neutral-100">{t1.toFixed(2).replace(".", ",")}</p>
            <p className="text-[11px] text-neutral-500">golos esperados</p>
            <p className="mt-1 text-xs text-neutral-300">
              Over 0.5 {pct1(ht.over05)} · Over 1.5 {pct1(ht.over15)}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">2ª parte ~</p>
            <p className="text-2xl font-bold tabular-nums text-neutral-100">{t2.toFixed(2).replace(".", ",")}</p>
            <p className="text-[11px] text-neutral-500">golos esperados</p>
            <p className="mt-1 text-xs text-neutral-300">
              Over 0.5 {pct1(poissonOver(t2, 0.5))} · Over 1.5 {pct1(poissonOver(t2, 1.5))}
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-neutral-800 pt-3">
          {(
            [
              { team: home, l1: lh1, l2: lh2, over05: ht.homeOver05, over15: ht.homeOver15 },
              { team: away, l1: la1, l2: la2, over05: ht.awayOver05, over15: ht.awayOver15 },
            ] as const
          ).map((s) => (
            <div key={s.team} className="text-center">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-neutral-500">{s.team}</p>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <p className="text-sm font-bold tabular-nums text-neutral-100">{s.l1.toFixed(2).replace(".", ",")}</p>
                  <p className="text-[11px] text-neutral-500">1ª parte</p>
                  <p className="text-[11px] text-neutral-400">Over 0.5 {pct1(s.over05)} · Over 1.5 {pct1(s.over15)}</p>
                </div>
                <div>
                  <p className="text-sm font-bold tabular-nums text-neutral-100">{s.l2.toFixed(2).replace(".", ",")}</p>
                  <p className="text-[11px] text-neutral-500">2ª parte ~</p>
                  <p className="text-[11px] text-neutral-400">
                    Over 0.5 {pct1(poissonOver(s.l2, 0.5))} · Over 1.5 {pct1(poissonOver(s.l2, 1.5))}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <Title>Mais / Menos</Title>
        <div className="grid grid-cols-3 gap-3">
          {[1.5, 2.5, 3.5].map((line) => {
            const over = prediction.over[String(line)] ?? 0.5;
            const hist = base.over[String(line)] ?? 0.5;
            return (
              <div key={line} className="grid grid-cols-3 gap-1 text-center">
                <Cell big={pct1(over)} sub={`P(Over ${String(line).replace(".", ",")})`} delta={{ p: over, base: hist }} />
                <Cell big={pct1(1 - over)} sub={`P(Under ${String(line).replace(".", ",")})`} delta={{ p: 1 - over, base: 1 - hist }} />
                <Cell big={pct1(hist)} sub={`Histórico over ${String(line).replace(".", ",")}`} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <Title>Ambas marcam</Title>
        <div className="grid grid-cols-3 gap-3 text-center">
          <Cell big={pct1(prediction.bothScore)} sub="P(Ambas marcam Sim)" delta={{ p: prediction.bothScore, base: base.btts }} />
          <Cell big={pct1(1 - prediction.bothScore)} sub="P(Ambas marcam Não)" delta={{ p: 1 - prediction.bothScore, base: 1 - base.btts }} />
          <Cell big={pct1(base.btts)} sub="Histórico Ambas marcam" />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-neutral-800 pt-2 text-center">
          <p className="text-[11px] text-neutral-500">
            1ª parte ~ {pct1(bttsHt)} <span className="text-neutral-600">(aprox.)</span>
          </p>
          <p className="text-[11px] text-neutral-500">
            2ª parte ~ {pct1(btts2)} <span className="text-neutral-600">(aprox.)</span>
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <Title>Golos da equipa — Mais / Menos</Title>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(
            [
              { team: home, mu: prediction.lambdaHome },
              { team: away, mu: prediction.lambdaAway },
            ] as const
          ).map((s) => (
            <div key={s.team}>
              <p className="mb-1 text-center text-[11px] uppercase tracking-wide text-neutral-500">{s.team}</p>
              {[1.5, 2.5].map((line) => {
                const over = poissonOver(s.mu, line);
                const hist = teamHist(s.team, line);
                return (
                  <div key={line} className="grid grid-cols-3 gap-1 border-t border-neutral-800/60 py-1.5 text-center">
                    <Cell big={pct1(over)} sub={`P(Over ${String(line).replace(".", ",")})`} delta={{ p: over, base: hist }} />
                    <Cell big={pct1(1 - over)} sub={`P(Under ${String(line).replace(".", ",")})`} delta={{ p: 1 - over, base: 1 - hist }} />
                    <Cell big={pct1(hist)} sub={`Histórico over ${String(line).replace(".", ",")}`} />
                  </div>
                );
              })}
              <div className="grid grid-cols-2 gap-1 border-t border-neutral-800/60 py-1.5 text-center">
                <p className="text-[11px] text-neutral-500">
                  1ª parte: Over 0.5 {pct1(teamHt(s.team).over05)} · Over 1.5 {pct1(teamHt(s.team).over15)}
                </p>
                <p className="text-[11px] text-neutral-500">
                  Hist. 1ª: Over 0.5 {pct1(teamHtHist(s.team, 0.5))} · Over 1.5 {pct1(teamHtHist(s.team, 1.5))}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

}
