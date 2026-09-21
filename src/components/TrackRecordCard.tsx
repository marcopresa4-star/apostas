import { formatCount } from "@/lib/betResult";
import type { TrackRecord } from "@/lib/trackRecord";

const pct = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")}%`;
const signed = (n: number, suffix: string) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2).replace(".", ",")}${suffix}`;

function Tile({ label, value, tone = "text-neutral-100" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-center">
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
    </div>
  );
}

// How the bets shared here have done so far: all of them, from the one person
// who publishes. Profit assumes 1 unit on every bet at the odd given.
export default function TrackRecordCard({ record }: { record: TrackRecord }) {
  const tone = (n: number | null) => (n === null || n === 0 ? "text-neutral-100" : n > 0 ? "text-emerald-400" : "text-red-400");
  return (
    <section className="mb-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-2 text-sm font-semibold text-neutral-300">📈 Histórico de quem publica</h2>
      {record.settled === 0 ? (
        <p className="text-xs text-neutral-500">Ainda não há apostas partilhadas com resultado.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Resolvidas" value={String(record.settled)} />
            <Tile
              label="Acerto"
              value={record.hitRate === null ? "—" : pct(record.hitRate)}
              tone={record.hitRate !== null && record.hitRate >= 0.5 ? "text-emerald-400" : "text-neutral-100"}
            />
            <Tile
              label="Lucro (unidades)"
              value={record.profit === null ? "—" : signed(record.profit, " u")}
              tone={tone(record.profit)}
            />
            <Tile label="ROI" value={record.roi === null ? "—" : signed(record.roi * 100, "%")} tone={tone(record.roi)} />
          </div>

          {record.recent.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-neutral-500">Últimas {record.recent.length} (mais recente primeiro)</span>
              {record.recent.map((result, i) => (
                <span
                  key={i}
                  title={result === "green" ? "Ganha" : "Perdida"}
                  className={`flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-[11px] font-bold ${
                    result === "green" ? "bg-emerald-600/30 text-emerald-300" : "bg-red-600/30 text-red-300"
                  }`}
                >
                  {result === "green" ? "G" : "R"}
                </span>
              ))}
            </div>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
            {formatCount(record.green)} green e {formatCount(record.red)} red
            {record.pending > 0 ? `, mais ${record.pending} por decidir` : ""}. O lucro conta 1 unidade em cada aposta,
            com a odd indicada (a de entrada, nas live)
            {record.withoutOdd > 0
              ? `; ${record.withoutOdd} ${record.withoutOdd === 1 ? "aposta sem odd fica" : "apostas sem odd ficam"} de fora do lucro`
              : ""}
            . Só há uma pessoa a publicar, por isso este é o histórico de tudo o que foi partilhado. As meias
            contam metade e as devolvidas não contam para o acerto.
          </p>
        </>
      )}
    </section>
  );
}
