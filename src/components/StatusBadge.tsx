import type { BetStatus } from "@/lib/database.types";

const STYLES: Record<BetStatus, string> = {
  pending: "bg-neutral-800 text-neutral-300",
  green: "bg-emerald-950 text-emerald-400 shadow-[0_0_0_1px] shadow-emerald-500/20",
  red: "bg-red-950 text-red-400 shadow-[0_0_0_1px] shadow-red-500/20",
  void: "bg-amber-950 text-amber-400 shadow-[0_0_0_1px] shadow-amber-500/20",
};

const DOT_STYLES: Record<BetStatus, string> = {
  pending: "bg-neutral-500",
  green: "bg-emerald-400",
  red: "bg-red-400",
  void: "bg-amber-400",
};

const LABELS: Record<BetStatus, string> = {
  pending: "Pendente",
  green: "Green",
  red: "Red",
  void: "Devolvida",
};

export const STATUS_BORDER: Record<BetStatus, string> = {
  pending: "border-l-neutral-700",
  green: "border-l-emerald-500",
  red: "border-l-red-500",
  void: "border-l-amber-500",
};

export default function StatusBadge({ status }: { status: BetStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[status]}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT_STYLES[status]}`} />
      {LABELS[status]}
    </span>
  );
}
