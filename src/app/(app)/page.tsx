import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TicketCard from "@/components/TicketCard";
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
  pick_images: PickImageRow[];
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

function todayISODate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: tickets, error } = await supabase
    .from("tickets")
    .select(
      `id, match_date, match_time,
       competition:competitions(id, name, country:countries(name)),
       home_team:teams!tickets_home_team_id_fkey(id, name),
       away_team:teams!tickets_away_team_id_fkey(id, name),
       picks(id, selection, reason, status, bet_type, odd, odd_min, pick_images(id, image_path))`
    )
    .order("match_date", { ascending: true })
    .order("match_time", { ascending: true })
    .returns<TicketRow[]>();

  const imagesByPick = new Map<string, PickImageItem[]>();
  const allImageRows = (tickets ?? []).flatMap((t) =>
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
      const existing = imagesByPick.get(row.pickId) ?? [];
      existing.push({ id: row.id, path: row.image_path, url: result.data.signedUrl });
      imagesByPick.set(row.pickId, existing);
    });
  }

  const todayISO = todayISODate();
  const all = tickets ?? [];

  const preJogoPicks = all.flatMap((t) => t.picks).filter((p) => p.bet_type === "pre_jogo");
  const stats = {
    total: preJogoPicks.length,
    green: preJogoPicks.filter((p) => p.status === "green").length,
    red: preJogoPicks.filter((p) => p.status === "red").length,
    pending: preJogoPicks.filter((p) => p.status === "pending").length,
  };

  const todayTickets = all
    .filter((t) => t.match_date === todayISO)
    .map((t) => ({ ...t, picks: t.picks.filter((p) => p.bet_type === "pre_jogo") }))
    .filter((t) => t.picks.length > 0);

  const liveTickets = all
    .map((t) => ({ ...t, picks: t.picks.filter((p) => p.bet_type === "live") }))
    .filter((t) => t.picks.length > 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex gap-2">
          <Link
            href="/apostas/nova"
            className="whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
          >
            + Nova aposta
          </Link>
          <Link
            href="/live/nova"
            className="whitespace-nowrap rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-500"
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

      {stats.total > 0 && (
        <div className="mb-6 grid grid-cols-4 gap-2">
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

      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-300">Jogos de hoje</h2>
          <Link href="/apostas" className="text-xs font-medium text-emerald-400 hover:underline">
            Ver todas →
          </Link>
        </div>
        {todayTickets.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
            Sem apostas pré-jogo registadas para hoje.
          </p>
        ) : (
          <div className="space-y-3">
            {todayTickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                picks={ticket.picks}
                imagesByPick={imagesByPick}
                addPickBetType="pre_jogo"
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-sky-400">🔴 A vigiar em live</h2>
          <Link href="/live" className="text-xs font-medium text-sky-400 hover:underline">
            Ver todas →
          </Link>
        </div>
        {liveTickets.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
            Sem jogos a vigiar para live.
          </p>
        ) : (
          <div className="space-y-3">
            {liveTickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                picks={ticket.picks}
                imagesByPick={imagesByPick}
                addPickBetType="live"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
