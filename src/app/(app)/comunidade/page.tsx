import { createClient } from "@/lib/supabase/server";
import CommunityTicket from "@/components/CommunityTicket";
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
       picks!inner(id, selection, reason, status, bet_type, odd, odd_min, alert_minute, category:bet_categories(name), pick_images(id, image_path))`
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

  const preJogoTickets = all
    .map((t) => ({ ...t, picks: t.picks.filter((p) => p.bet_type === "pre_jogo") }))
    .filter((t) => t.picks.length > 0);

  const liveTickets = all
    .map((t) => ({ ...t, picks: t.picks.filter((p) => p.bet_type === "live") }))
    .filter((t) => t.picks.length > 0);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">🌐 Comunidade</h1>
      <p className="mb-6 text-sm text-neutral-500">Apostas partilhadas para veres e acompanhares.</p>

      {error && (
        <p className="mb-5 rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Erro ao carregar: {error.message}
        </p>
      )}

      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-emerald-400">🎟️ Apostas</h2>
        {preJogoTickets.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-neutral-800 px-4 py-10 text-center text-neutral-500">
            Ainda não há apostas partilhadas.
          </p>
        ) : (
          <div className="space-y-3">
            {preJogoTickets.map((ticket) => (
              <CommunityTicket key={ticket.id} ticket={ticket} imagesByPick={imagesByPick} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-sky-400">
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          A vigiar em live
        </h2>
        {liveTickets.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-neutral-800 px-4 py-10 text-center text-neutral-500">
            Sem jogos live partilhados.
          </p>
        ) : (
          <div className="space-y-3">
            {liveTickets.map((ticket) => (
              <CommunityTicket key={ticket.id} ticket={ticket} imagesByPick={imagesByPick} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
