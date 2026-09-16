import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import StatusBadge, { STATUS_BORDER } from "@/components/StatusBadge";
import StatusButtons from "@/components/StatusButtons";
import AddPickForm from "@/components/AddPickForm";
import DeleteTicketButton from "@/components/DeleteTicketButton";
import type { BetStatus } from "@/lib/database.types";

interface Pick {
  id: string;
  selection: string;
  reason: string | null;
  status: BetStatus;
}

interface TicketRow {
  id: string;
  match_date: string;
  match_time: string;
  competition: { id: string; name: string; country: { name: string } | null } | null;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
  picks: Pick[];
}

const FILTERS: { value: string; label: string; dot?: string }[] = [
  { value: "all", label: "Todas" },
  { value: "pending", label: "Pendentes", dot: "bg-neutral-500" },
  { value: "green", label: "Green", dot: "bg-emerald-400" },
  { value: "red", label: "Red", dot: "bg-red-400" },
  { value: "void", label: "Devolvidas", dot: "bg-amber-400" },
];

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function formatDateHeader(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const formatted = date.toLocaleDateString("pt-PT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const capitalized = formatted.charAt(0).toUpperCase() + formatted.slice(1);

  if (sameDay(date, today)) return `Hoje · ${capitalized}`;
  if (sameDay(date, tomorrow)) return `Amanhã · ${capitalized}`;
  if (sameDay(date, yesterday)) return `Ontem · ${capitalized}`;
  return capitalized;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const activeFilter = FILTERS.some((f) => f.value === status) ? status! : "all";

  const supabase = await createClient();

  const { data: tickets, error } = await supabase
    .from("tickets")
    .select(
      `id, match_date, match_time,
       competition:competitions(id, name, country:countries(name)),
       home_team:teams!tickets_home_team_id_fkey(id, name),
       away_team:teams!tickets_away_team_id_fkey(id, name),
       picks(id, selection, reason, status)`
    )
    .order("match_date", { ascending: false })
    .order("match_time", { ascending: false })
    .returns<TicketRow[]>();

  const displayTickets = (tickets ?? [])
    .map((ticket) => ({
      ...ticket,
      picks:
        activeFilter === "all"
          ? ticket.picks
          : ticket.picks.filter((p) => p.status === activeFilter),
    }))
    .filter((ticket) => ticket.picks.length > 0);

  const groups: { date: string; tickets: typeof displayTickets }[] = [];
  for (const ticket of displayTickets) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.date === ticket.match_date) {
      lastGroup.tickets.push(ticket);
    } else {
      groups.push({ date: ticket.match_date, tickets: [ticket] });
    }
  }

  const allPicks = (tickets ?? []).flatMap((t) => t.picks);
  const stats = {
    total: allPicks.length,
    green: allPicks.filter((p) => p.status === "green").length,
    red: allPicks.filter((p) => p.status === "red").length,
    pending: allPicks.filter((p) => p.status === "pending").length,
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">As minhas apostas</h1>
      </div>

      {stats.total > 0 && (
        <div className="mb-5 grid grid-cols-4 gap-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold text-neutral-100">{stats.total}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Total</p>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold text-emerald-400">{stats.green}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Green</p>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold text-red-400">{stats.red}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Red</p>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-center">
            <p className="text-lg font-semibold text-neutral-300">{stats.pending}</p>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500">Pendentes</p>
          </div>
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? "/" : `/?status=${f.value}`}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              activeFilter === f.value
                ? "bg-emerald-600 text-white"
                : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
            }`}
          >
            {f.dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />}
            {f.label}
          </Link>
        ))}
      </div>

      {error && (
        <p className="rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Erro ao carregar apostas: {error.message}
        </p>
      )}

      {!error && displayTickets.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-800 px-4 py-12 text-center text-neutral-500">
          <p aria-hidden className="mb-2 text-3xl">
            🎟️
          </p>
          Ainda não tens apostas registadas.{" "}
          <Link href="/apostas/nova" className="text-emerald-400 hover:underline">
            Regista a primeira aposta
          </Link>
          .
        </div>
      )}

      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.date}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="whitespace-nowrap text-sm font-semibold text-neutral-400">
                {formatDateHeader(group.date)}
              </h2>
              <div aria-hidden className="h-px flex-1 bg-neutral-800" />
            </div>
            <div className="space-y-3">
              {group.tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm transition-colors hover:border-neutral-700"
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs uppercase tracking-wide text-neutral-500">
                        {ticket.competition?.name}
                        {ticket.competition?.country?.name
                          ? ` · ${ticket.competition.country.name}`
                          : ""}
                      </p>
                      <p className="break-words text-base font-medium text-neutral-100">
                        {ticket.home_team?.name} <span className="text-neutral-500">vs</span>{" "}
                        {ticket.away_team?.name}
                      </p>
                      <p className="text-sm text-neutral-400">
                        às {ticket.match_time?.slice(0, 5)}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <DeleteTicketButton ticketId={ticket.id} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    {ticket.picks.map((pick) => (
                      <div
                        key={pick.id}
                        className={`rounded-lg border-l-4 bg-neutral-950 p-3 ${STATUS_BORDER[pick.status]}`}
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <p className="min-w-0 break-words text-sm font-medium text-emerald-300">
                            {pick.selection}
                          </p>
                          <div className="shrink-0">
                            <StatusBadge status={pick.status} />
                          </div>
                        </div>
                        {pick.reason && (
                          <p className="mb-2 text-sm text-neutral-300">{pick.reason}</p>
                        )}
                        <StatusButtons pickId={pick.id} status={pick.status} />
                      </div>
                    ))}
                  </div>

                  <div className="mt-3">
                    <AddPickForm ticketId={ticket.id} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
