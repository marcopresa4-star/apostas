import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/requireAdmin";
import StatRanking, { type RankRow } from "@/components/StatRanking";
import PerformanceCalendar from "@/components/PerformanceCalendar";
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

function bump(map: Map<string, { green: number; red: number }>, key: string, status: "green" | "red") {
  const entry = map.get(key) ?? { green: 0, red: 0 };
  entry[status]++;
  map.set(key, entry);
}

function toRankedRows(
  map: Map<string, { green: number; red: number }>,
  limit?: number
): RankRow[] {
  const rows = Array.from(map.entries()).map(([label, v]) => ({ label, ...v }));
  rows.sort((a, b) => b.green - a.green || b.green + b.red - (a.green + a.red));
  return limit ? rows.slice(0, limit) : rows;
}

export default async function AnalisePage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: tickets, error } = await supabase
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
    .returns<TicketRow[]>();

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

  const teamMap = new Map<string, { green: number; red: number }>();
  const competitionMap = new Map<string, { green: number; red: number }>();
  const categoryMap = new Map<string, { green: number; red: number }>();
  const dayStats: Record<string, { green: number; red: number }> = {};
  const ticketsByDay: Record<string, TicketRow[]> = {};

  for (const ticket of all) {
    if (ticket.picks.length === 0) continue;

    (ticketsByDay[ticket.match_date] ??= []).push({ ...ticket, picks: ticket.picks });

    const resolvedPicks = ticket.picks.filter(
      (p) => p.status === "green" || p.status === "red"
    );
    if (resolvedPicks.length === 0) continue;

    const dayEntry = dayStats[ticket.match_date] ?? { green: 0, red: 0 };

    for (const pick of resolvedPicks) {
      const status = pick.status as "green" | "red";
      if (ticket.home_team?.name) bump(teamMap, ticket.home_team.name, status);
      if (ticket.away_team?.name) bump(teamMap, ticket.away_team.name, status);
      if (ticket.competition?.name) bump(competitionMap, ticket.competition.name, status);
      if (pick.category?.name) bump(categoryMap, pick.category.name, status);
      dayEntry[status]++;
    }

    dayStats[ticket.match_date] = dayEntry;
  }

  const topTeams = toRankedRows(teamMap, 5);
  const topCompetitions = toRankedRows(competitionMap, 5);
  const topCategories = toRankedRows(categoryMap, 5);
  const hasPerformanceData = topTeams.length > 0;

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">📊 Análise</h1>

      {error && (
        <p className="mb-5 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Erro ao carregar dados: {error.message}
        </p>
      )}

      {hasPerformanceData ? (
        <div>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatRanking title="Equipas" rows={topTeams} />
            <StatRanking title="Competições" rows={topCompetitions} />
            <StatRanking title="Tipos de aposta" rows={topCategories} />
          </div>
          <PerformanceCalendar
            dayStats={dayStats}
            ticketsByDay={ticketsByDay}
            imagesByPick={imagesByPick}
          />
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-neutral-800 px-4 py-12 text-center text-neutral-500">
          Ainda não há apostas com green ou red para mostrar análise.
        </p>
      )}
    </div>
  );
}
