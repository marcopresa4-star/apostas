import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import StatusBadge from "@/components/StatusBadge";
import StatusButtons from "@/components/StatusButtons";
import type { BetStatus } from "@/lib/database.types";

interface BetRow {
  id: string;
  match_date: string;
  match_time: string;
  reason: string | null;
  status: BetStatus;
  competition: { id: string; name: string; country: { name: string } | null } | null;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
}

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "pending", label: "Pendentes" },
  { value: "green", label: "Green" },
  { value: "red", label: "Red" },
  { value: "void", label: "Devolvidas" },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const activeFilter = FILTERS.some((f) => f.value === status) ? status! : "all";

  const supabase = await createClient();

  let queryBuilder = supabase
    .from("bets")
    .select(
      `id, match_date, match_time, reason, status,
       competition:competitions(id, name, country:countries(name)),
       home_team:teams!bets_home_team_id_fkey(id, name),
       away_team:teams!bets_away_team_id_fkey(id, name)`
    );

  if (activeFilter !== "all") {
    queryBuilder = queryBuilder.eq("status", activeFilter as BetStatus);
  }

  const { data: bets, error } = await queryBuilder
    .order("match_date", { ascending: false })
    .order("match_time", { ascending: false })
    .returns<BetRow[]>();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">As minhas apostas</h1>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? "/" : `/?status=${f.value}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              activeFilter === f.value
                ? "bg-emerald-600 text-white"
                : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {error && (
        <p className="rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Erro ao carregar apostas: {error.message}
        </p>
      )}

      {!error && bets?.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-800 px-4 py-10 text-center text-neutral-500">
          Ainda não tens apostas registadas.{" "}
          <Link href="/apostas/nova" className="text-emerald-400 hover:underline">
            Regista a primeira aposta
          </Link>
          .
        </div>
      )}

      <div className="space-y-3">
        {bets?.map((bet) => (
          <div
            key={bet.id}
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
          >
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-neutral-500">
                  {bet.competition?.name}
                  {bet.competition?.country?.name
                    ? ` · ${bet.competition.country.name}`
                    : ""}
                </p>
                <p className="text-base font-medium text-neutral-100">
                  {bet.home_team?.name} vs {bet.away_team?.name}
                </p>
                <p className="text-sm text-neutral-400">
                  {new Date(`${bet.match_date}T00:00:00`).toLocaleDateString("pt-PT", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}{" "}
                  às {bet.match_time?.slice(0, 5)}
                </p>
              </div>
              <StatusBadge status={bet.status} />
            </div>

            {bet.reason && (
              <p className="mb-3 rounded-lg bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
                {bet.reason}
              </p>
            )}

            <StatusButtons betId={bet.id} status={bet.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
