import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/requireAdmin";
import TicketCard from "@/components/TicketCard";
import MultipleCard from "@/components/MultipleCard";
import PerformanceCalendar from "@/components/PerformanceCalendar";
import StatsRow from "@/components/StatsRow";
import type { PickImageItem } from "@/components/PickImages";
import type { TagItem } from "@/components/CategoryCombobox";
import type { BetStatus, BetType, PickStage } from "@/lib/database.types";
import { sumGreen, sumRed } from "@/lib/betResult";
import { historyDayStats } from "@/lib/historyCalendar";
import {
  MULTIPLE_SELECT,
  firstLegKickoff,
  lastLegDate,
  multipleStatus,
  type MultipleRow,
} from "@/lib/multiples";

const IMAGE_BUCKET = "game-images";

interface PickImageRow {
  id: string;
  image_path: string;
}

interface Pick {
  id: string;
  selection: string;
  reason: string | null;
  status: BetStatus;
  bet_type: BetType;
  stage: PickStage;
  odd: number | null;
  odd_min: number | null;
  entry_odd: number | null;
  entry_minute: number | null;
  alert_minute: number | null;
  sofascore_url: string | null;
  bookmaker_url: string | null;
  is_published: boolean;
  category: { id: string; name: string } | null;
  pick_images: PickImageRow[];
}

interface TicketRow {
  id: string;
  match_date: string;
  match_time: string;
  live_ended: boolean;
  competition: { id: string; name: string; country: { name: string } | null } | null;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
  picks: Pick[];
}

const SCOPES: { value: string; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "historico", label: "Histórico" },
];

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function todayISODate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  await requireAdmin();
  const { scope } = await searchParams;
  const activeScope = SCOPES.some((s) => s.value === scope) ? scope! : "hoje";

  const supabase = await createClient();

  const [{ data: tickets, error }, { data: categories }, { data: multipleRows }] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        `id, match_date, match_time, live_ended,
         competition:competitions(id, name, country:countries(name)),
         home_team:teams!tickets_home_team_id_fkey(id, name),
         away_team:teams!tickets_away_team_id_fkey(id, name),
         picks(id, selection, reason, status, bet_type, stage, odd, odd_min, entry_odd, entry_minute, alert_minute, sofascore_url, bookmaker_url, is_published, category:bet_categories(id, name), pick_images(id, image_path))`
      )
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true })
      .returns<TicketRow[]>(),
    supabase.from("bet_categories").select("id, name").order("name").returns<TagItem[]>(),
    // Left empty (never an error) if the multiples migration has not run yet.
    supabase
      .from("multiples")
      .select(MULTIPLE_SELECT)
      .eq("bet_type", "live")
      .returns<MultipleRow[]>(),
  ]);

  const todayISO = todayISODate();
  const all = tickets ?? [];

  // Stats only count live picks you actually entered. A live multiple is
  // always registered once entered, and counts as one bet.
  const livePicksAll = all
    .flatMap((t) => t.picks)
    .filter((p) => p.bet_type === "live" && p.stage === "active");
  const allMultiples = (multipleRows ?? []).map((m) => ({
    multiple: m,
    status: multipleStatus(m.legs),
  }));
  const betResults = [...livePicksAll, ...allMultiples];
  const stats = {
    total: betResults.length,
    green: sumGreen(betResults),
    red: sumRed(betResults),
    pending: betResults.filter((b) => b.status === "pending").length,
  };

  const displayMultiples = allMultiples
    .filter(({ multiple }) => {
      const last = lastLegDate(multiple.legs);
      return activeScope === "hoje" ? last >= todayISO : last < todayISO;
    })
    .sort((a, b) => {
      const order = firstLegKickoff(a.multiple.legs).localeCompare(firstLegKickoff(b.multiple.legs));
      return activeScope === "hoje" ? order : -order;
    })
    .map(({ multiple }) => multiple);

  // "Hoje" = today onwards, minus anything you marked "não entrei";
  // "Histórico" = past games plus every "não entrei", whatever its date.
  const displayTickets = all
    .map((ticket) => ({
      ...ticket,
      picks: ticket.picks.filter((p) => {
        if (p.bet_type !== "live") return false;
        return activeScope === "hoje"
          ? ticket.match_date >= todayISO && p.stage !== "skipped"
          : ticket.match_date < todayISO || p.stage === "skipped";
      }),
    }))
    .filter((ticket) => ticket.picks.length > 0);

  const imagesByPick: Record<string, PickImageItem[]> = {};
  const allImageRows = displayTickets.flatMap((t) =>
    t.picks.flatMap((p) => p.pick_images.map((img) => ({ pickId: p.id, ...img })))
  );
  if (allImageRows.length > 0) {
    const signedResults = await Promise.all(
      allImageRows.map((img) =>
        supabase.storage.from(IMAGE_BUCKET).createSignedUrl(img.image_path, 3600)
      )
    );
    signedResults.forEach((result, i) => {
      if (!result.data?.signedUrl) return;
      const row = allImageRows[i];
      const existing = imagesByPick[row.pickId] ?? [];
      existing.push({ id: row.id, path: row.image_path, url: result.data.signedUrl });
      imagesByPick[row.pickId] = existing;
    });
  }

  const groups: { date: string; tickets: typeof displayTickets }[] = [];
  for (const ticket of displayTickets) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.date === ticket.match_date) {
      lastGroup.tickets.push(ticket);
    } else {
      groups.push({ date: ticket.match_date, tickets: [ticket] });
    }
  }

  // The Histórico is a calendar (a colour per day, click a day for its bets)
  // instead of one long list. Clicking a day shows the same full cards as the
  // list, so results can still be set or corrected there.
  const dayCards: Record<string, ReactNode[]> = {};
  if (activeScope === "historico") {
    for (const multiple of displayMultiples) {
      (dayCards[lastLegDate(multiple.legs)] ??= []).push(
        <MultipleCard key={multiple.id} multiple={multiple} />
      );
    }
    for (const group of groups) {
      for (const ticket of group.tickets) {
        (dayCards[group.date] ??= []).push(
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            picks={ticket.picks}
            imagesByPick={imagesByPick}
            addPickBetType="live"
            initialCategories={categories ?? []}
          />
        );
      }
    }
  }
  const dayDetail = Object.fromEntries(
    Object.entries(dayCards).map(([day, cards]) => [day, <div key={day} className="space-y-3">{cards}</div>])
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">🔴 Live</h1>
          <p className="text-sm text-neutral-500">
            Jogos que estás a vigiar e apostas live em que já entraste.
          </p>
        </div>
        <Link
          href="/live/nova"
          className="whitespace-nowrap rounded-lg bg-gradient-to-r from-sky-600 to-sky-500 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-sky-600/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sky-500/30"
        >
          + Nova live
        </Link>
      </div>

      <StatsRow total={stats.total} green={stats.green} red={stats.red} pending={stats.pending} />

      <div className="mb-5 inline-flex rounded-lg border border-neutral-800 bg-neutral-900 p-1">
        {SCOPES.map((s) => (
          <Link
            key={s.value}
            href={s.value === "hoje" ? "/live" : `/live?scope=${s.value}`}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
              activeScope === s.value
                ? "bg-gradient-to-r from-sky-600 to-sky-500 text-white shadow-md shadow-sky-600/25"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {error && (
        <p className="rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Erro ao carregar: {error.message}
        </p>
      )}

      {!error && displayTickets.length === 0 && displayMultiples.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-800 px-4 py-12 text-center text-neutral-500">
          <p aria-hidden className="mb-2 text-3xl">
            📡
          </p>
          {activeScope === "hoje"
            ? "Sem jogos a vigiar para hoje ou próximos dias."
            : "Ainda não tens jogos live no histórico."}{" "}
          <Link href="/live/nova" className="text-sky-400 hover:underline">
            Adiciona um
          </Link>
          .
        </div>
      )}

      {activeScope === "historico" ? (
        (displayTickets.length > 0 || displayMultiples.length > 0) && (
          <PerformanceCalendar
            dayStats={historyDayStats(displayTickets, displayMultiples)}
            ticketsByDay={{}}
            dayDetail={dayDetail}
          />
        )
      ) : (
        <>
          {displayMultiples.length > 0 && (
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-3">
                <h2 className="whitespace-nowrap text-sm font-semibold text-neutral-400">Múltiplas</h2>
                <div aria-hidden className="h-px flex-1 bg-neutral-800" />
              </div>
              <div className="space-y-3">
                {displayMultiples.map((multiple) => (
                  <MultipleCard key={multiple.id} multiple={multiple} />
                ))}
              </div>
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
                    <TicketCard
                      key={ticket.id}
                      ticket={ticket}
                      picks={ticket.picks}
                      imagesByPick={imagesByPick}
                      addPickBetType="live"
                      initialCategories={categories ?? []}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
