export interface RankRow {
  label: string;
  green: number;
  red: number;
}

export default function StatRanking({ title, rows }: { title: string; rows: RankRow[] }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-3 text-sm font-semibold text-neutral-300">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Ainda sem dados suficientes.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const total = row.green + row.red;
            const winRate = total > 0 ? Math.round((row.green / total) * 100) : 0;
            return (
              <div key={row.label} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-neutral-200">{row.label}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-medium text-emerald-400">{row.green}G</span>
                  <span className="font-medium text-red-400">{row.red}R</span>
                  <span className="w-9 text-right text-xs text-neutral-500">{winRate}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
