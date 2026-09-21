import { formatCount } from "@/lib/betResult";
import { MIN_SAMPLE, type MinuteBucket } from "@/lib/minuteAnalysis";

// Win rate of the live bets you entered, by the game minute of the entry.
export default function MinuteAnalysis({
  buckets,
  best,
  withoutMinute,
}: {
  buckets: MinuteBucket[];
  best: MinuteBucket | null;
  withoutMinute: number;
}) {
  return (
    <div className="mb-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-300">Live por minuto de entrada</h3>
      <p className="mb-3 text-xs text-neutral-500">
        Percentagem de Green nas apostas live em que entraste, conforme o minuto do jogo.
      </p>

      <div className="space-y-2">
        {buckets.map((bucket) => {
          const total = bucket.green + bucket.red;
          const rate = total > 0 ? Math.round((bucket.green / total) * 100) : null;
          const few = total > 0 && total < MIN_SAMPLE;
          return (
            <div
              key={bucket.label}
              className="flex items-center gap-3 text-sm"
              title={few ? "Poucas apostas para tirar conclusões" : undefined}
            >
              <span className="w-16 shrink-0 text-neutral-300">{bucket.label}</span>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-800">
                {rate !== null && (
                  <div
                    className={`h-full rounded-full ${few ? "bg-emerald-700/60" : "bg-emerald-500"}`}
                    style={{ width: `${rate}%` }}
                  />
                )}
              </div>
              <span className={`w-10 shrink-0 text-right font-medium ${few ? "text-neutral-500" : "text-neutral-200"}`}>
                {rate === null ? "—" : `${rate}%`}
              </span>
              <span className="w-20 shrink-0 text-right text-xs">
                {total === 0 ? (
                  <span className="text-neutral-600">sem apostas</span>
                ) : (
                  <>
                    <span className="text-emerald-400">{formatCount(bucket.green)}G</span>{" "}
                    <span className="text-red-400">{formatCount(bucket.red)}R</span>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-neutral-500">
        {best ? (
          <>
            Melhor fase: <span className="font-medium text-neutral-300">{best.label}</span> com{" "}
            {Math.round((best.green / (best.green + best.red)) * 100)}% em{" "}
            {formatCount(best.green + best.red)} apostas.
          </>
        ) : (
          <>Ainda não há {MIN_SAMPLE} apostas resolvidas em nenhuma fase para apontar a melhor.</>
        )}
        {withoutMinute > 0 && (
          <>
            {" "}
            {withoutMinute} {withoutMinute === 1 ? "aposta antiga" : "apostas antigas"} sem minuto
            não {withoutMinute === 1 ? "entra" : "entram"} aqui.
          </>
        )}
      </p>
    </div>
  );
}
