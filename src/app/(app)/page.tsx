import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CompactTicketList from "@/components/CompactTicketList";
import StatsRow from "@/components/StatsRow";
import LiveClock from "@/components/LiveClock";
import LiveAlerts from "@/components/LiveAlerts";
import LiveWidgetsPanel from "@/components/LiveWidgetsPanel";
import type { PickImageItem } from "@/components/PickImages";
import type { BetStatus, BetType } from "@/lib/database.types";

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
  odd: number | null;
  odd_min: number | null;
  alert_minute: number | null;
  sofascore_url: string | null;
  bookmaker_url: string | null;
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

interface WatchedMatchRow {
  id: string;
  home_team: string;
  away_team: string;
}

function todayISODate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: tickets, error }, { data: watchedMatches }] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        `id, match_date, match_time, live_ended,
         competition:competitions(id, name, country:countries(name)),
         home_team:teams!tickets_home_team_id_fkey(id, name),
         away_team:teams!tickets_away_team_id_fkey(id, name),
         picks(id, selection, reason, status, bet_type, odd, odd_min, alert_minute, sofascore_url, bookmaker_url, category:bet_categories(id, name), pick_images(id, image_path))`
      )
      .order("match_date", { ascending: true })
      .order("match_time", { ascending: true })
      .returns<TicketRow[]>(),
    supabase
      .from("watched_matches")
      .select("id, home_team, away_team")
      .order("created_at", { ascending: true })
      .returns<WatchedMatchRow[]>(),
  ]);

  const todayISO = todayISODate();
  const all = tickets ?? [];

  const imagesByPick: Record<string, PickImageItem[]> = {};
  const allImageRows = all.flatMap((t) =>
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

  const allPicks = all.flatMap((t) => t.picks);
  const stats = {
    total: allPicks.length,
    green: allPicks.filter((p) => p.status === "green").length,
    red: allPicks.filter((p) => p.status === "red").length,
    pending: allPicks.filter((p) => p.status === "pending").length,
  };

  const todayTickets = all
    .filter((t) => t.match_date === todayISO)
    .map((t) => ({ ...t, picks: t.picks.filter((p) => p.bet_type === "pre_jogo") }))
    .filter((t) => t.picks.length > 0);

  const liveTickets = all
    .filter((t) => t.match_date >= todayISO)
    .map((t) => ({ ...t, picks: t.picks.filter((p) => p.bet_type === "live") }))
    .filter((t) => t.picks.length > 0);

  const liveWidgetCandidates = all.filter((t) => t.picks.length > 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <LiveClock />
        <div className="flex gap-2">
          <Link
            href="/apostas/nova"
            className="whitespace-nowrap rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-500 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-emerald-600/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-emerald-500/30"
          >
            + Nova aposta
          </Link>
          <Link
            href="/live/nova"
            className="whitespace-nowrap rounded-lg bg-gradient-to-r from-sky-600 to-sky-500 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-sky-600/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sky-500/30"
          >
            + Vigiar jogo
          </Link>
        </div>
      </div>

      {error && (
        <p className="mb-5 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Erro ao carregar dados: {error.message}
        </p>
      )}

      <LiveAlerts tickets={liveTickets} />

      <StatsRow total={stats.total} green={stats.green} red={stats.red} pending={stats.pending} />

      <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-300">
              <span aria-hidden>⚽</span> Jogos de hoje
            </h2>
            <Link
              href="/apostas"
              className="text-xs font-medium text-emerald-400 transition hover:translate-x-0.5 hover:underline"
            >
              Ver todas →
            </Link>
          </div>
          {todayTickets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
              Sem apostas pré-jogo registadas para hoje.
            </p>
          ) : (
            <CompactTicketList tickets={todayTickets} imagesByPick={imagesByPick} />
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-sky-400">
              <span
                aria-hidden
                className="h-2 w-2 animate-pulse rounded-full bg-red-500"
              />
              A vigiar em live
            </h2>
            <Link
              href="/live"
              className="text-xs font-medium text-sky-400 transition hover:translate-x-0.5 hover:underline"
            >
              Ver todas →
            </Link>
          </div>
          {liveTickets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
              Sem jogos a vigiar para live.
            </p>
          ) : (
            <CompactTicketList tickets={liveTickets} imagesByPick={imagesByPick} />
          )}
        </div>
      </div>

      <LiveWidgetsPanel tickets={liveWidgetCandidates} watched={watchedMatches ?? []} />
    </div>
  );
}
