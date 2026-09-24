"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { deleteBet, enterWatchedBet, setBetStatus, updateBet } from "@/app/(app)/actions";
import { useNow } from "@/lib/useNow";
import { KIND_LABEL, MARKET_OPTIONS, STATUS_LABEL, oddText, type Bet } from "@/lib/bets";

const pad = (n: number) => String(n).padStart(2, "0");

// Countdown to kickoff (HH:MM:SS). Past kickoff: just says so — the page
// cannot know the live minute from here.
export function Countdown({ kickoff }: { kickoff: string }) {
  const now = useNow(1000);
  if (!now) return null;
  const ms = new Date(kickoff).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return <span className="font-semibold text-red-400">A decorrer?</span>;
  const s = Math.floor(ms / 1000);
  return (
    <span className="font-semibold tabular-nums text-red-400">
      {pad(Math.floor(s / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}
    </span>
  );
}

function RowButtons({ bet, watch }: { bet: Bet; watch?: boolean }) {  const [, startTransition] = useTransition();
  const run = (fn: () => Promise<void>) => startTransition(() => fn().catch(() => {}));
  const btn = "rounded-lg px-2.5 py-1 text-xs font-medium transition";
  if (watch) {
    return (
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => run(() => enterWatchedBet(bet.id))}
          className={`${btn} bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30`}
        >
          Entrei
        </button>
        <button
          type="button"
          onClick={() => run(() => deleteBet(bet.id))}
          className={`${btn} bg-neutral-800 text-neutral-400 hover:bg-neutral-700`}
        >
          Não entrei
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {(
        [
          ["won", "Ganha"],
          ["lost", "Perdida"],
          ["void", "Anulada"],
        ] as const
      ).map(([status, label]) => (
        <button
          key={status}
          type="button"
          onClick={() => run(() => setBetStatus(bet.id, status))}
          className={`${btn} bg-neutral-800 text-neutral-400 hover:bg-neutral-700`}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => run(() => deleteBet(bet.id))}
        title="Apagar"
        className={`${btn} text-neutral-600 hover:text-red-300`}
      >
        ✕
      </button>
    </div>
  );
}

// Live minute and score for an open live bet, refreshing every minute.
function LiveStatus({ eventId }: { eventId: number }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/sofascore/event?id=${eventId}`, { cache: "no-store" });
        if (!res.ok || stop) return;
        const body = await res.json();
        const s = body?.state;
        if (!s) return;
        if (s.phase === "live") setText(`${s.minute ?? "?"}' · ${s.homeGoals ?? "?"}–${s.awayGoals ?? "?"}`);
        else if (s.phase === "halftime") setText(`Intervalo · ${s.homeGoals}–${s.awayGoals}`);
        else if (s.phase === "finished") setText(`Fim · ${s.homeGoals}–${s.awayGoals}`);
        else setText(null);
      } catch {
        // Offline: stays quiet.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [eventId]);
  if (!text) return null;
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
      <span aria-hidden className="h-1 w-1 animate-pulse rounded-full bg-red-500" />
      {text}
    </span>
  );
}

// Fix a placed bet inline (market, odd, league, kickoff). Teams and kind stay.
function EditForm({ bet, onDone }: { bet: Bet; onDone: () => void }) {
  const [market, setMarket] = useState(bet.market_key);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = (form: FormData) => {
    setError(null);
    const customLabel = String(form.get("custom_label") ?? "").trim().slice(0, 80);
    if (market === "custom" && !customLabel) {
      setError("Escreve o mercado.");
      return;
    }
    startTransition(async () => {
      try {
        await updateBet(bet.id, {
          marketKey: market,
          marketLabel: market === "custom" ? customLabel : (MARKET_OPTIONS.find((m) => m.key === market)?.label ?? ""),
          odd: form.get("odd"),
          league: form.get("league"),
          kickoff: form.get("kickoff"),
        });
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível guardar.");
      }
    });
  };
  const input =
    "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-amber-500";
  return (
    <form action={submit} className="mt-2 space-y-1.5 rounded-lg border border-neutral-800 bg-neutral-950 p-2">
      <div className="grid grid-cols-2 gap-1.5">
        <select name="market" value={MARKET_OPTIONS.some((m) => m.key === market) ? market : "custom"} onChange={(e) => setMarket(e.target.value)} className={input}>
          {MARKET_OPTIONS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <input name="odd" required inputMode="decimal" defaultValue={bet.odd ?? ""} placeholder="Odd" className={input} />
      </div>
      {market === "custom" && (
        <input name="custom_label" defaultValue={bet.market_key === "custom" ? bet.market_label : ""} maxLength={80} placeholder="Qual mercado?" className={input} />
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <input name="league" defaultValue={bet.league_label ?? ""} maxLength={80} placeholder="Liga" className={input} />
        <input
          name="kickoff"
          type="datetime-local"
          defaultValue={bet.kickoff ? bet.kickoff.slice(0, 16) : ""}
          className={input}
        />
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-60"
        >
          {pending ? "A guardar…" : "Guardar"}
        </button>
        <button type="button" onClick={onDone} className="rounded-lg px-3 py-1 text-xs text-neutral-400 hover:text-neutral-200">
          Cancelar
        </button>
      </div>
    </form>
  );
}

// One bet card: teams, market + odd, conditions, countdown, actions.
export function BetCard({ bet }: { bet: Bet }) {
  const [editing, setEditing] = useState(false);
  const target: string[] = [];
  if (bet.target_odd !== null) target.push(`a partir de ${oddText(bet.target_odd)}`);
  if (bet.target_minute !== null) target.push(`min ${bet.target_minute}`);
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium text-neutral-100">
          <span className="truncate">{bet.home_team}</span> <span className="text-neutral-500">vs</span>{" "}
          <span className="truncate">{bet.away_team}</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {bet.analysisHref && (
            <Link href={bet.analysisHref} title="Abrir a análise destas equipas" className="text-xs text-sky-400 hover:underline">
              Análise →
            </Link>
          )}
          {bet.sofascore_id && (
            <Link
              href={`/estatisticas/live?${new URLSearchParams({ sofascore: `id:${bet.sofascore_id}` })}`}
              title="Abrir na calculadora live"
              className="shrink-0 text-xs text-amber-400 hover:underline"
            >
              Live →
            </Link>
          )}
        </div>
      </div>
      {bet.league_label && <p className="mt-0.5 text-[11px] uppercase tracking-wide text-neutral-500">{bet.league_label}</p>}
      <p className="mt-1 text-xs text-neutral-300">
        {bet.market_label} <span className="ml-1 font-semibold text-neutral-100">{oddText(bet.odd)}</span>
        {bet.liveOdd !== undefined && bet.liveOdd !== null && bet.odd !== null && bet.status === "open" && (
          <span
            className={`ml-1.5 text-[11px] font-medium ${bet.liveOdd > bet.odd ? "text-emerald-400" : bet.liveOdd < bet.odd ? "text-red-400" : "text-neutral-500"}`}
            title="Odd agora na casa"
          >
            agora {oddText(bet.liveOdd)} {bet.liveOdd > bet.odd ? "↗" : bet.liveOdd < bet.odd ? "↘" : "="}
          </span>
        )}
        {bet.kind === "live" && <span className="ml-1.5 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-300">LIVE</span>}
        {bet.kind === "live" && bet.status === "open" && bet.sofascore_id && <LiveStatus eventId={bet.sofascore_id} />}
        {bet.status !== "open" && (
          <span
            className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${
              bet.status === "won"
                ? "bg-emerald-600/20 text-emerald-300"
                : bet.status === "lost"
                  ? "bg-red-600/20 text-red-300"
                  : "bg-neutral-800 text-neutral-400"
            }`}
          >
            {STATUS_LABEL[bet.status]}
            {bet.settled_auto ? " · auto" : ""}
          </span>
        )}
      </p>
      {target.length > 0 && <p className="mt-0.5 text-[11px] text-amber-400/90">Entrar {target.join(" · ")}</p>}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {bet.kickoff ? (
          <p className="text-[11px] text-neutral-500">
            {new Date(bet.kickoff).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{" "}
            · <Countdown kickoff={bet.kickoff} />
          </p>
        ) : (
          <span />
        )}
        <span className="text-[10px] text-neutral-600">{KIND_LABEL[bet.kind]} · {STATUS_LABEL[bet.status]}</span>
      </div>
      <div className="mt-2">
        <RowButtons bet={bet} watch={bet.kind === "watch" && bet.status === "open"} />
        {bet.status === "open" && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-1.5 rounded-lg px-2 py-1 text-[11px] text-neutral-500 hover:text-neutral-300 hover:underline"
          >
            Editar odd/mercado
          </button>
        )}
        {editing && <EditForm bet={bet} onDone={() => setEditing(false)} />}
      </div>
    </div>
  );
}
