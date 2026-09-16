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

export default async function LivePage() {
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

  const displayTickets = (tickets ?? [])
    .map((ticket) => ({
      ...ticket,
      picks: ticket.picks.filter((p) => p.bet_type === "live"),
    }))
    .filter((ticket) => ticket.picks.length > 0);

  const imagesByPick = new Map<string, PickImageItem[]>();
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
      const existing = imagesByPick.get(row.pickId) ?? [];
      existing.push({ id: row.id, path: row.image_path, url: result.data.signedUrl });
      imagesByPick.set(row.pickId, existing);
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">🔴 Live</h1>
          <p className="text-sm text-neutral-500">
            Jogos que estás a vigiar para uma possível entrada em live.
          </p>
        </div>
        <Link
          href="/live/nova"
          className="whitespace-nowrap rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-500"
        >
          + Vigiar jogo
        </Link>
      </div>

      {error && (
        <p className="rounded-lg bg-red-950 px-4 py-3 text-sm text-red-300">
          Erro ao carregar: {error.message}
        </p>
      )}

      {!error && displayTickets.length === 0 && (
        <div className="rounded-2xl border border-dashed border-neutral-800 px-4 py-12 text-center text-neutral-500">
          <p aria-hidden className="mb-2 text-3xl">
            📡
          </p>
          Ainda não tens jogos a vigiar para live.{" "}
          <Link href="/live/nova" className="text-sky-400 hover:underline">
            Adiciona um
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
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  picks={ticket.picks}
                  imagesByPick={imagesByPick}
                  addPickBetType="live"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
