import type { TeamCountsSummary } from "@/lib/sofaLeague";

// Cantos e cartões da equipa nos últimos jogos da liga: feitos e sofridos, no
// jogo e na 1.ª parte. Só perfil: não entra no modelo.
export default function TeamCornersCards({
  team,
  data,
}: {
  team: string;
  data: TeamCountsSummary;
}) {
  const per = (total: number): string =>
    data.games > 0 ? (total / data.games).toFixed(2).replace(".", ",") : "—";
  const row = (label: string, made: number, suffered: number) => (
    <tr>
      <td className="py-1.5 pr-3 text-neutral-300">{label}</td>
      <td className="py-1.5 pr-3 font-medium text-neutral-100">{per(made)}</td>
      <td className="py-1.5 text-neutral-400">{per(suffered)}</td>
    </tr>
  );

  return (
    <div className="glass p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-300">Cantos e cartões · últimos {data.games} jogos</h3>
      <p className="mb-2 text-xs text-neutral-500">
        Média por jogo de {team} (feitos) e do adversário (sofridos). Lido da ficha de cada jogo.
      </p>
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="py-1.5 pr-3 font-medium"> </th>
            <th className="py-1.5 pr-3 font-medium">Feitos</th>
            <th className="py-1.5 font-medium">Sofridos</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {row("Cantos", data.cornersFor, data.cornersAgainst)}
          {row("Cantos · 1.ª parte", data.cornersHtFor, data.cornersHtAgainst)}
          {row("Amarelos", data.yellowsFor, data.yellowsAgainst)}
          {row("Amarelos · 1.ª parte", data.yellowsHtFor, data.yellowsHtAgainst)}
        </tbody>
      </table>
    </div>
  );
}
