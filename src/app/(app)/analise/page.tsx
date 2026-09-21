import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/requireAdmin";
import StatRanking from "@/components/StatRanking";
import MinuteAnalysis from "@/components/MinuteAnalysis";
import PerformanceCalendar from "@/components/PerformanceCalendar";
import { buildAnalysis } from "@/lib/analysis";
import { buildMinuteAnalysis } from "@/lib/minuteAnalysis";
import { MULTIPLE_SELECT, withMultiples, type MultipleRow } from "@/lib/multiples";
import type { PickImageItem } from "@/components/PickImages";
import type { BetStatus, BetType, PickStage } from "@/lib/database.types";

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
       picks(id, selection, reason, status, bet_type, stage, odd, odd_min, entry_odd, entry_minute, alert_minute, sofascore_url, bookmaker_url, is_published, category:bet_categories(id, name), pick_images(id, image_path))`
    )
    .order("match_date", { ascending: true })
    .order("match_time", { ascending: true })
    .returns<TicketRow[]>();

  // Left empty (never an error) if the multiples migration has not run yet.
  const { data: multipleRows } = await supabase
    .from("multiples")
    .select(MULTIPLE_SELECT)
    .returns<MultipleRow[]>();

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

  const { topTeams, topCompetitions, topCategories, dayStats, ticketsByDay } =
    buildAnalysis(all);

  const {
    dayStats: calendarStats,
    multiplesByDay,
    hasResolved: hasResolvedMultiple,
  } = withMultiples(dayStats, multipleRows ?? []);

  const hasPerformanceData = topTeams.length > 0 || hasResolvedMultiple;
  const minutes = buildMinuteAnalysis(all);

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
          {minutes.resolved + minutes.withoutMinute > 0 && (
            <MinuteAnalysis
              buckets={minutes.buckets}
              best={minutes.best}
              withoutMinute={minutes.withoutMinute}
            />
          )}
          <PerformanceCalendar
            dayStats={calendarStats}
            ticketsByDay={ticketsByDay}
            multiplesByDay={multiplesByDay}
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
