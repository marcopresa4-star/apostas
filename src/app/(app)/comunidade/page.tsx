import { createClient } from "@/lib/supabase/server";
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
  category: { name: string } | null;
  pick_images: PickImageRow[];
}

interface TicketRow {
  id: string;
  match_date: string;
  match_time: string;
  competition: { name: string; country: { name: string } | null } | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
  picks: Pick[];
}

const DOT: Record<BetStatus, string> = {
  pending: "bg-neutral-500",
  green: "bg-emerald-400",
  red: "bg-red-400",
  void: "bg-amber-400",
};

export default async function ComunidadePage() {
  const supabase = await createClient();

  const { data: tickets, error } = await supabase
    .from("tickets")
    .select(
      `id, match_date, match_time,
       competition:competitions(name, country:countries(name)),
       home_team:teams!tickets_home_team_id_fkey(name),
       away_team:teams!tickets_away_team_id_fkey(name),
       picks!inner(id, selection, reason, status, bet_type, odd, odd_min, category:bet_categories(name), pick_images(id, image_path))`
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

function CommunityTicket({
  ticket,
  imagesByPick,
}: {
  ticket: TicketRow;
  imagesByPick: Record<string, PickImageItem[]>;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-sm">
      <p className="truncate text-xs uppercase tracking-wide text-neutral-500">
        {ticket.competition?.name}
        {ticket.competition?.country?.name ? ` · ${ticket.competition.country.name}` : ""}
      </p>
      <p className="mb-1 break-words text-base font-medium text-neutral-100">
        {ticket.home_team?.name} <span className="text-neutral-500">vs</span> {ticket.away_team?.name}
      </p>
      <p className="mb-3 text-sm text-neutral-400">
        {new Date(`${ticket.match_date}T00:00:00`).toLocaleDateString("pt-PT")} · às{" "}
        {ticket.match_time?.slice(0, 5)}
      </p>
      <div className="space-y-2">
        {ticket.picks.map((pick) => {
          const images = imagesByPick[pick.id] ?? [];
          return (
            <div key={pick.id} className="rounded-lg bg-neutral-950 p-3">
              <div className="mb-1 flex items-center gap-2">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[pick.status]}`} />
                {pick.bet_type === "live" && (
                  <span className="rounded bg-sky-950 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
                    LIVE
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">
                  {pick.selection}
                </span>
                {pick.odd !== null && (
                  <span className="shrink-0 text-xs text-neutral-500">@{pick.odd.toFixed(2)}</span>
                )}
                {pick.odd_min !== null && (
                  <span className="shrink-0 text-xs text-neutral-500">≥{pick.odd_min.toFixed(2)}</span>
                )}
              </div>
              {pick.reason && <p className="mb-2 text-sm text-neutral-300">{pick.reason}</p>}
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {images.map((img) => (
                    <a key={img.id} href={img.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt="Print da aposta"
                        className="h-20 w-20 rounded-md border border-neutral-700 object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
