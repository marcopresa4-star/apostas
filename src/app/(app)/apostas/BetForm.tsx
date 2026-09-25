"use client";

import { useRef, useState, useTransition } from "react";
import { addBet } from "@/app/(app)/actions";
import { MARKET_OPTIONS, splitLineKey, validAsianLine, type BetKind } from "@/lib/bets";
import { parseSofascoreId } from "@/lib/sofascore";
import { lisbonISOFromInput, lisbonWallInput } from "@/lib/lisbonTime";

const INPUT =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-amber-500";
const LABEL = "mb-1 block text-xs text-neutral-400";

interface EventMeta {
  home: string;
  away: string;
  tournament: string;
  kickoff: string | null;
}

// Add form for one kind of bet. Paste the SofaScore link first and the game
// fills itself in (teams, competition, kickoff); everything stays editable.
// Market, odd and entry conditions are always by hand.
export default function BetForm({ kind }: { kind: BetKind }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [lookingUp, setLookingUp] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [market, setMarket] = useState<string>(MARKET_OPTIONS[0].key);
  const homeRef = useRef<HTMLInputElement>(null);
  const awayRef = useRef<HTMLInputElement>(null);
  const leagueRef = useRef<HTMLInputElement>(null);
  const kickoffRef = useRef<HTMLInputElement>(null);



  const lookup = (link: string) => {
    const id = parseSofascoreId(link);
    if (id === null) {
      setPreview(null);
      return;
    }
    setLookingUp(true);
    fetch(`/api/sofascore/event?id=${id}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { meta?: EventMeta } | null) => {
        const meta = body?.meta;
        if (!meta || (!meta.home && !meta.away)) {
          setPreview("Não consegui ler o jogo (scraper desligado?). Preenche à mão.");
          return;
        }
        if (homeRef.current) homeRef.current.value = meta.home;
        if (awayRef.current) awayRef.current.value = meta.away;
        if (leagueRef.current && !leagueRef.current.value) leagueRef.current.value = meta.tournament;
        if (kickoffRef.current && meta.kickoff) kickoffRef.current.value = lisbonWallInput(meta.kickoff);
        const when = meta.kickoff
          ? new Date(meta.kickoff).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
          : "";
        setPreview(`${meta.home} vs ${meta.away}${meta.tournament ? ` · ${meta.tournament}` : ""}${when ? ` · ${when}` : ""}`);
      })
      .catch(() => setPreview("Não consegui ler o jogo. Preenche à mão."))
      .finally(() => setLookingUp(false));
  };

  // datetime-local carries no zone: the form holds Lisbon wall time, and the
  // server runs in UTC, so the instant is fixed here, explicitly.
  const kickoffISO = (form: FormData): string => {
    const raw = String(form.get("kickoff") ?? "");
    return lisbonISOFromInput(raw) ?? raw;
  };

  const submit = (form: FormData) => {
    setError(null);
    const customLabel = String(form.get("custom_label") ?? "").trim().slice(0, 80);
    if (market === "custom" && !customLabel) {
      setError("Escreve o mercado (ex: cantos, cartões).");
      return;
    }
    let marketKey = market;
    let marketLabel =
      market === "custom" ? customLabel : (MARKET_OPTIONS.find((m) => m.key === market)?.label ?? "");
    // Handicap asiático e totais por equipa trazem a linha à parte
    // (ex: casa -1,5). Só .0 (devolve no certo) e .5; .25/.75 é manual.
    const split = splitLineKey(market);
    if (split) {
      const line = String(form.get("line") ?? "").trim();
      if (!validAsianLine(line)) {
        setError("Linha inválida: usa .0 ou .5 (ex: -1,5 ou 2). Linhas .25/.75 ficam no manual (Outro).");
        return;
      }
      const norm = line.replace(",", ".");
      marketKey = `${split[0]}:${split[1]}:${norm}`;
      const base = MARKET_OPTIONS.find((m) => m.key === market)?.label.replace("…", "").trim() ?? "";
      marketLabel = `${base} ${norm.replace(".", ",")}`;
    }
    const link = String(form.get("sofascore") ?? "").trim();
    const id = link ? parseSofascoreId(link) : null;
    if (link && id === null) {
      setError("Esse link do SofaScore não tem id (id:12345678).");
      return;
    }
    startTransition(async () => {
      try {
        await addBet({
          kind,
          home: form.get("home"),
          away: form.get("away"),
          league: form.get("league"),
          marketKey,
          marketLabel,
          odd: form.get("odd"),
          sofascoreId: id ?? undefined,
          kickoff: kickoffISO(form) || undefined,
          targetOdd: form.get("target_odd") ?? undefined,
          targetMinute: form.get("target_minute") ?? undefined,
        });
        (document.getElementById(`betform-${kind}`) as HTMLFormElement | null)?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível guardar.");
      }
    });
  };

  return (
    <form id={`betform-${kind}`} action={submit} className="space-y-2">
      <div>
        <label className={LABEL}>Link do jogo no SofaScore</label>
        <input
          name="sofascore"
          placeholder=".../id:12345678"
          className={INPUT}
          onBlur={(e) => lookup(e.target.value.trim())}
        />
        {lookingUp && <p className="mt-1 text-[11px] text-neutral-500">A ler o jogo…</p>}
        {preview && <p className="mt-1 text-[11px] text-emerald-400">{preview}</p>}
        <p className="mt-1 text-[11px] text-neutral-600">
          {kind === "live"
            ? "Preenche as equipas sozinho; com ele, o resultado confere-se sozinho."
            : "Preenche equipas, competição e hora sozinho; com ele, conta tudo sozinho."}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL}>Casa</label>
          <input ref={homeRef} name="home" required maxLength={80} placeholder="Benfica" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Fora</label>
          <input ref={awayRef} name="away" required maxLength={80} placeholder="Porto" className={INPUT} />
        </div>
      </div>
      <div>
        <label className={LABEL}>Liga (opcional)</label>
        <input ref={leagueRef} name="league" maxLength={80} placeholder="Portugal · Primeira Liga" className={INPUT} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL}>Mercado</label>
          <select name="market" className={INPUT} value={market} onChange={(e) => setMarket(e.target.value)}>
            {MARKET_OPTIONS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL}>Odd atual (só referência)</label>
          <input name="odd" required inputMode="decimal" placeholder="1,85" className={INPUT} />
        </div>
      </div>
      {market === "custom" && (
        <div>
          <label className={LABEL}>Qual mercado? (fecho manual)</label>
          <input name="custom_label" maxLength={80} placeholder="Ex: mais de 9,5 cantos" className={INPUT} />
        </div>
      )}
      {splitLineKey(market) && (
        <div>
          <label className={LABEL}>Linha (ex: -1,5 ou 2 — só .0 e .5)</label>
          <input name="line" inputMode="decimal" required placeholder="-1,5" className={INPUT} />
        </div>
      )}
      {kind !== "live" && (
        <div>
          <label className={LABEL}>Início do jogo</label>
          <input ref={kickoffRef} name="kickoff" type="datetime-local" className={INPUT} />
        </div>
      )}
      {kind === "watch" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL}>Entrar a partir de (gatilho)</label>
            <input name="target_odd" inputMode="decimal" placeholder="1,65" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Minuto mínimo</label>
            <input name="target_minute" inputMode="numeric" placeholder="15" className={INPUT} />
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-500 disabled:opacity-60"
      >
        {pending ? "A guardar…" : "Adicionar"}
      </button>
    </form>
  );
}
