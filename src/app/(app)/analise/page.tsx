import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/requireAdmin";
import StatRanking from "@/components/StatRanking";
import MinuteAnalysis from "@/components/MinuteAnalysis";
import PerformanceCalendar from "@/components/PerformanceCalendar";
import { buildAnalysis } from "@/lib/analysis";
import { buildMinuteAnalysis } from "@/lib/minuteAnalysis";
import { MULTIPLE_SELECT, withMultiples, type MultipleRow } from "@/lib/multiples";
import BetReliabilityCard from "@/components/BetReliabilityCard";
import { LEAGUES, isInternational, loadLeague } from "@/lib/footballData";
import { computeReliability, summarize, type ReliabilityBet } from "@/lib/betReliability";
import type { PlayedMatch } from "@/lib/footballModel";
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
  home_team: { id: string; name: string; aliases: string | null } | null;
  away_team: { id: string; name: string; aliases: string | null } | null;
  picks: Pick[];
}

// Other names a club goes by, kept separated by " | " in the teams table.
function splitAliases(aliases: string | null | undefined): string[] {
  return aliases ? aliases.split("|").map((a) => a.trim()).filter(Boolean) : [];
}

export default async function AnalisePage() {
  await requireAdmin();
  const supabase = await createClient();

  const { data: tickets, error } = await supabase
    .from("tickets")
    .select(
      `id, match_date, match_time, live_ended,
       competition:competitions(id, name, country:countries(name)),
       home_team:teams!tickets_home_team_id_fkey(id, name, aliases),
       away_team:teams!tickets_away_team_id_fkey(id, name, aliases),
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

  // What the model would have said, at the time, about your own settled bets.
  const SETTLED = new Set(["green", "red", "half_green", "half_red", "void"]);
  const reliabilityBets: ReliabilityBet[] = [
    ...all.flatMap((t) =>
      t.picks
        .filter((p) => SETTLED.has(p.status))
        .map((p) => ({
          id: p.id,
          kind: "pick" as const,
          date: t.match_date,
          home: t.home_team?.name ?? "?",
          away: t.away_team?.name ?? "?",
          homeNames: t.home_team ? [t.home_team.name, ...splitAliases(t.home_team.aliases)] : [],
          awayNames: t.away_team ? [t.away_team.name, ...splitAliases(t.away_team.aliases)] : [],
          selection: p.selection,
          status: p.status,
        }))
    ),
    ...(multipleRows ?? []).flatMap((m) =>
      m.legs
        .filter((leg) => SETTLED.has(leg.status))
        .map((leg) => ({
          id: leg.id,
          kind: "leg" as const,
          date: leg.match_date,
          home: leg.home_team?.name ?? "?",
          away: leg.away_team?.name ?? "?",
          homeNames: leg.home_team ? [leg.home_team.name, ...splitAliases(leg.home_team.aliases)] : [],
          awayNames: leg.away_team ? [leg.away_team.name, ...splitAliases(leg.away_team.aliases)] : [],
          selection: leg.selection,
          status: leg.status,
        }))
    ),
  ];
  let reliabilityRows: ReturnType<typeof computeReliability> = [];
  if (reliabilityBets.length > 0) {
    const now = new Date();
    const loaded = await Promise.all(
      LEAGUES.filter((l) => !isInternational(l.code)).map(async (l) => ({ label: l.label as string, data: await loadLeague(l.code, now) }))
    );
    const leagues: { label: string; matches: PlayedMatch[] }[] = [];
    for (const l of loaded) if (l.data) leagues.push({ label: l.label, matches: l.data.matches });
    reliabilityRows = computeReliability(reliabilityBets, leagues);
  }
  const reliabilitySummary = summarize(reliabilityRows);

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
          <BetReliabilityCard summary={reliabilitySummary} rows={reliabilityRows} />
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
