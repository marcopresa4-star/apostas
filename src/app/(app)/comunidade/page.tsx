import { createClient } from "@/lib/supabase/server";
import CommunityFeed from "@/components/CommunityFeed";
import CommunityTabs from "@/components/CommunityTabs";
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
  alert_minute: number | null;
  category: { name: string } | null;
  pick_images: PickImageRow[];
}

interface TicketRow {
  id: string;
  match_date: string;
  match_time: string;
  live_ended: boolean;
  competition: { name: string; country: { name: string } | null } | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  picks: Pick[];
}

export default async function ComunidadePage() {
  const supabase = await createClient();

  const { data: tickets, error } = await supabase
    .from("tickets")
    .select(
      `id, match_date, match_time, live_ended,
       competition:competitions(name, country:countries(name)),
       home_team:teams!tickets_home_team_id_fkey(name),
       away_team:teams!tickets_away_team_id_fkey(name),
       picks!inner(id, selection, reason, status, bet_type, stage, odd, odd_min, entry_odd, alert_minute, category:bet_categories(name), pick_images(id, image_path))`
    )
    .eq("picks.is_published", true)
    .order("match_date", { ascending: false })
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

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">🌐 Comunidade</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Apostas partilhadas de jogos por acabar. Os jogos terminados saem daqui e os resultados
        ficam na Análise.
      </p>

      <CommunityTabs />

      {error && (
        <p className="mb-5 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Erro ao carregar: {error.message}
        </p>
      )}

      <CommunityFeed tickets={all} imagesByPick={imagesByPick} />
    </div>
  );
}
