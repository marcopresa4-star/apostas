import { formatCount } from "@/lib/betResult";

const CARD_STYLES = {
  neutral:
    "bg-gradient-to-br from-neutral-800/80 to-neutral-900 hover:border-neutral-600 hover:shadow-neutral-900/40",
  green:
    "bg-gradient-to-br from-emerald-950 to-neutral-900 hover:border-emerald-700 hover:shadow-emerald-900/30",
  red: "bg-gradient-to-br from-red-950 to-neutral-900 hover:border-red-700 hover:shadow-red-900/30",
  gray: "bg-gradient-to-br from-neutral-800/60 to-neutral-900 hover:border-neutral-600 hover:shadow-neutral-900/30",
} as const;

function StatCard({
  value,
  label,
  valueColor,
  style,
}: {
  value: number;
  label: string;
  valueColor: string;
  style: keyof typeof CARD_STYLES;
}) {
  return (
    <div
      className={`rounded-xl border border-neutral-800 px-3 py-2.5 text-center shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${CARD_STYLES[style]}`}
    >
      <p className={`text-xl font-bold ${valueColor}`}>{formatCount(value)}</p>
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
    </div>
  );
}

export default function StatsRow({
  total,
  green,
  red,
  pending,
}: {
  total: number;
  green: number;
  red: number;
  pending: number;
}) {
  if (total === 0) return null;

  return (
    <div className="mb-6 grid grid-cols-4 gap-2">
      <StatCard value={total} label="Total" valueColor="text-neutral-100" style="neutral" />
      <StatCard value={green} label="Green" valueColor="text-emerald-400" style="green" />
      <StatCard value={red} label="Red" valueColor="text-red-400" style="red" />
      <StatCard value={pending} label="Pendentes" valueColor="text-neutral-300" style="gray" />
    </div>
  );
}
