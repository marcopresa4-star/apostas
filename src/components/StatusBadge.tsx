import type { BetStatus } from "@/lib/database.types";

const STYLES: Record<BetStatus, string> = {
  pending: "bg-neutral-800 text-neutral-300",
  green: "bg-emerald-950 text-emerald-400",
  red: "bg-red-950 text-red-400",
  void: "bg-amber-950 text-amber-400",
};

const LABELS: Record<BetStatus, string> = {
  pending: "Pendente",
  green: "Green",
  red: "Red",
  void: "Devolvida",
};

export default function StatusBadge({ status }: { status: BetStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
