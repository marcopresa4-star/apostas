"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import OddChecker, { type OddMarket } from "./OddChecker";
import { predictLive } from "@/lib/liveModel";
import { liveSummary } from "@/lib/liveSummary";
import { LAST_MINUTES, liveCandidates, suggestLive } from "@/lib/liveBet";
import { clockMinute, rawSnapshot, saveGame, savedFrom, type SavedGame } from "@/lib/liveStore";
import { checkLive, parseLiveMatch, type LiveGameState } from "@/lib/sportscoreLive";
import { teamsMatch } from "@/lib/sportscoreSlug";
import { useNow } from "@/lib/useNow";
import { fairOdd } from "@/lib/footballModel";
import { formatOdd } from "@/lib/multiples";

const INPUT =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-amber-500";
const dot = (n: number) => n.toFixed(1).replace(".", ",");
const pct = (p: number) => (p > 0 && p < 0.1 ? `${(p * 100).toFixed(1).replace(".", ",")}%` : `${Math.round(p * 100)}%`);
const oddText = (p: number) => (p >= 0.005 ? formatOdd(fairOdd(p)) : "—");

// Read a whole number, kept in range; anything else counts as `fallback`.
function whole(text: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function decimal(text: string, min: number, max: number, fallback: number): number {
  const n = Number.parseFloat(text.replace(",", "."));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

interface Row {
  label: string;
  p: number;
  note?: string;
}

function Table({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">{title}</h3>
      <div className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-neutral-200">
              {row.label}
              {row.note && <span className="ml-1.5 text-[11px] text-neutral-500">{row.note}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="w-12 text-right font-medium text-amber-300">{pct(row.p)}</span>
              <span className="w-14 text-right text-xs text-neutral-500">@{oddText(row.p)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The odds of what is left of a game in progress, updated as the minute and the
// score are typed. `lambdaHome` / `lambdaAway` are the goals each side was
// expected to score in the whole game; they can be edited, so it also works for
// a game the data does not cover.
type Props = {
  home: string;
  away: string;
  lambdaHome: number;
  lambdaAway: number;
  firstHalfShare: number;
  // Whether the expected goals came from the two teams chosen (or are typical figures).
  fromModel: boolean;
  // Which game this is, and where to reopen it: with them it is remembered in
  // this browser (minute, score and expected goals) and picked up again on return.
  gameKey?: string;
  href?: string;
  // Where the expected goals come from, in short sentences.
  sourceLines?: string[];
  // How to read the game from SportScore: its slug when known, otherwise the
  // slugs to try (with what was taught about the clubs, and the names a page
  // must show to be the right game).
  sync?: {
    slug: string | null;
    pairs: { slug: string; home: string; away: string }[];
    hints: { home: string | null; away: string | null };
    homeVariants: string[];
    awayVariants: string[];
  };
};

const SPORTSCORE_MATCH = "https://sportscore.com/api/widget/match/?sport=football&slug=";

type SyncInfo =
  | { kind: "notfound" }
  | { kind: "error" }
  | { kind: "stale"; state: LiveGameState; ageMs: number; at: number }
  | { kind: "ok"; state: LiveGameState; at: number; notes: string[]; ageMs: number | null };

const STAT_NAMES: Record<string, string> = {
  "Ball Possession": "Posse de bola",
  "Shots on Target": "Remates à baliza",
  "Shots off Target": "Remates fora",
  "Corner Kicks": "Cantos",
  Corners: "Cantos",
  Attacks: "Ataques",
  "Dangerous Attacks": "Ataques perigosos",
  Fouls: "Faltas",
  Offsides: "Foras de jogo",
  Saves: "Defesas",
};

// Waits for the browser to say what was saved for this game (it cannot be known
// on the server), then starts the calculator from it.
export default function LiveCalculator(props: Props) {
  const raw = useSyncExternalStore(
    () => () => {},
    rawSnapshot,
    () => null
  );
  if (raw === null) return null;
  return <Calculator key={props.gameKey ?? ""} {...props} saved={savedFrom(raw, props.gameKey)} />;
}

function Calculator({
  home,
  away,
  lambdaHome,
  lambdaAway,
  firstHalfShare,
  fromModel,
  gameKey,
  href,
  sourceLines = [],
  sync,
  saved,
}: Props & { saved: (SavedGame & { minuteNow: number }) | null }) {
  const [minute, setMinute] = useState(String(saved ? saved.minuteNow : 60));
  // The minute can move on by itself, one every real minute. It is worked out
  // from when it was last set, so it stays right if the tab was in the background
  // (or the page was left and reopened).
  const [running, setRunning] = useState(saved?.running ?? false);
  const anchor = useRef({ minute: saved?.minute ?? 60, at: saved?.at ?? 0 });
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const now = clockMinute({ minute: anchor.current.minute, at: anchor.current.at, running: true }, Date.now());
      setMinute((current) => (String(now) === current ? current : String(now)));
    };
    tick();
    const id = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [running]);
  const setMinuteByHand = (value: string) => {
    setMinute(value);
    anchor.current = { minute: whole(value, 0, 120, 0), at: Date.now() };
  };

  const [homeGoals, setHomeGoals] = useState(String(saved?.homeGoals ?? 0));
  const [awayGoals, setAwayGoals] = useState(String(saved?.awayGoals ?? 0));
  const [lh, setLh] = useState(saved?.lh ?? dot(lambdaHome));
  const [la, setLa] = useState(saved?.la ?? dot(lambdaAway));

  // The game read from SportScore, once a minute: score, minute and cards. Every
  // reading overwrites what is typed, so the box below turns it off.
  const [syncOn, setSyncOn] = useState(true);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const slugRef = useRef<string | null>(sync?.slug ?? null);
  const now = useNow(5000);
  useEffect(() => {
    if (!sync || !syncOn) return;
    let stop = false;
    let probed = false;
    // Sportscore refreshes a game when it is asked for, so old data is often
    // followed by fresh data a moment later: a stale reading is retried a few times.
    let retries = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const read = async (slug: string): Promise<LiveGameState | null> => {
      const res = await fetch(SPORTSCORE_MATCH + encodeURIComponent(slug), { cache: "no-store" });
      return res.ok ? parseLiveMatch(await res.json()) : null;
    };
    // A game whose slug is not known: the likely ones are tried, and of those that
    // are the right game (the reserve side of a club has a slug too) the one with
    // the freshest data wins, since Sportscore can hold the same game twice and
    // one of them stop being updated.
    const find = async (): Promise<string | null> => {
      let best: { slug: string; at: number } | null = null;
      for (const pair of sync.pairs.slice(0, 12)) {
        if (stop) return null;
        const state = await read(pair.slug).catch(() => null);
        if (!state) continue;
        const homeVariants = pair.home === sync.hints.home ? null : sync.homeVariants;
        const awayVariants = pair.away === sync.hints.away ? null : sync.awayVariants;
        if (!teamsMatch([state.homeName, state.awayName], homeVariants, awayVariants)) continue;
        const at = state.updatedAt ?? 0;
        if (best === null || at > best.at) best = { slug: pair.slug, at };
      }
      return best?.slug ?? null;
    };
    const apply = (state: LiveGameState) => {
      if (state.homeGoals !== null) setHomeGoals(String(state.homeGoals));
      if (state.awayGoals !== null) setAwayGoals(String(state.awayGoals));
      if (state.phase === "live" && state.minute !== null) {
        anchor.current = { minute: state.minute, at: Date.now() };
        setMinute(String(state.minute));
        setRunning(true);
      } else if (state.phase === "halftime") {
        setMinute("45");
        setRunning(false);
      } else if (state.phase === "finished" || state.phase === "upcoming") {
        setRunning(false);
      }
    };
    const poll = async () => {
      try {
        if (!slugRef.current && !probed) {
          probed = true;
          slugRef.current = await find();
        }
        if (stop) return;
        if (!slugRef.current) {
          setSyncInfo({ kind: "notfound" });
          return;
        }
        const state = await read(slugRef.current);
        if (stop) return;
        if (!state) {
          setSyncInfo({ kind: "error" });
          return;
        }
        // Data that stopped being refreshed is not used: it would put the game at a
        // minute it left long ago.
        const checked = checkLive(state, Date.now());
        if (checked.stale) {
          setSyncInfo({ kind: "stale", state, ageMs: checked.ageMs ?? 0, at: Date.now() });
          if (retries < 3) {
            retries++;
            timers.push(setTimeout(() => void poll(), 6000));
          }
          return;
        }
        retries = 0;
        apply(checked.state);
        setSyncInfo({ kind: "ok", state: checked.state, at: Date.now(), notes: checked.notes, ageMs: checked.ageMs });
      } catch {
        if (!stop) setSyncInfo({ kind: "error" });
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      timers.forEach(clearTimeout);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync, syncOn]);
  // The lowest fair odd a suggested bet may have: a bet the model gives 90% is
  // "safe" but pays next to nothing, so it is left out.
  const [minOdd, setMinOdd] = useState("1.5");

  const m = whole(minute, 0, 120, 0);
  const h = whole(homeGoals, 0, 20, 0);
  const a = whole(awayGoals, 0, 20, 0);
  const expectedHome = decimal(lh, 0.05, 6, lambdaHome);
  const expectedAway = decimal(la, 0.05, 6, lambdaAway);

  const p = predictLive({
    lambdaHome: expectedHome,
    lambdaAway: expectedAway,
    firstHalfShare,
    minute: m,
    homeGoals: h,
    awayGoals: a,
  });

  // What is remembered: a running minute is kept as the minute it was at a given moment.
  useEffect(() => {
    if (!gameKey || !href) return;
    saveGame({
      key: gameKey,
      href,
      home,
      away,
      minute: running ? anchor.current.minute : m,
      at: running ? anchor.current.at : undefined,
      running,
      homeGoals: h,
      awayGoals: a,
      lh,
      la,
      firstHalfShare,
    });
  }, [gameKey, href, home, away, m, running, h, a, lh, la, firstHalfShare]);

  const total = h + a;
  const homeName = home || "Casa";
  const awayName = away || "Fora";

  // "More than X,5 goals" only for the lines still open, with how many are missing.
  const goalRows: Row[] = [];
  for (let k = 0; k < 4; k++) {
    const line = total + k + 0.5;
    const over = p.over[String(line)];
    goalRows.push(
      { label: `Mais de ${dot(line)} golos`, p: over, note: `faltam ${k + 1}` },
      { label: `Menos de ${dot(line)} golos`, p: 1 - over }
    );
  }
  const bothDone = h > 0 && a > 0;

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Resultado final",
      rows: [
        { label: `${homeName} vence`, p: p.fullTime.home },
        { label: "Empate", p: p.fullTime.draw },
        { label: `${awayName} vence`, p: p.fullTime.away },
        { label: `${homeName} ou empate (1X)`, p: p.fullTime.home + p.fullTime.draw },
        { label: `${awayName} ou empate (X2)`, p: p.fullTime.away + p.fullTime.draw },
        { label: "Sem empate (12)", p: p.fullTime.home + p.fullTime.away },
      ],
    },
    { title: "Golos até ao fim", rows: goalRows },
    {
      title: "Ambas marcam",
      rows: [
        { label: "Sim", p: p.bothScore, note: bothDone ? "já marcaram os dois" : undefined },
        { label: "Não", p: 1 - p.bothScore },
      ],
    },
    {
      title: "Próximo golo",
      rows: [
        { label: `${homeName}`, p: p.nextGoal.home },
        { label: `${awayName}`, p: p.nextGoal.away },
        { label: "Nenhum até ao fim", p: p.nextGoal.none },
      ],
    },
  ];
  // The suggested bet: in the last minutes there is nothing left to suggest.
  const suggestion =
    m >= LAST_MINUTES
      ? { main: null, others: [] }
      : suggestLive(liveCandidates(p, { home: homeName, away: awayName, homeGoals: h, awayGoals: a }), {
          minOdd: Number(minOdd),
        });
  // The suggestion first, so the odd comparer opens on it.
  const oddMarkets: OddMarket[] = [
    ...(suggestion.main ? [{ group: "Aposta sugerida", label: suggestion.main.label, p: suggestion.main.p }] : []),
    ...groups.flatMap((g) => g.rows.map((r) => ({ group: g.title, label: r.label, p: r.p }))),
  ];

  const step = (setter: (v: string) => void, current: number, by: number, min: number, max: number) =>
    setter(String(Math.min(max, Math.max(min, current + by))));
  const button =
    "rounded-lg bg-neutral-800 px-3 py-2 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-700";

  const seconds = syncInfo?.kind === "ok" && now ? Math.max(0, Math.round((now.getTime() - syncInfo.at) / 1000)) : null;
  const liveState = syncInfo?.kind === "ok" ? syncInfo.state : null;
  const staleInfo = syncInfo?.kind === "stale" ? syncInfo : null;
  const redCards = liveState ? liveState.reds.home + liveState.reds.away : 0;

  return (
    <div className="space-y-4">
      {sync && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs">
          <label className="flex cursor-pointer items-center gap-2 text-neutral-300">
            <input type="checkbox" checked={syncOn} onChange={(e) => setSyncOn(e.target.checked)} className="accent-amber-500" />
            Ler o resultado, o minuto e os cartões do Sportscore, sozinho (de minuto a minuto)
          </label>
          {syncOn && (
            <p className="mt-1.5 text-neutral-400">
              {syncInfo === null && "A ligar ao Sportscore…"}
              {syncInfo?.kind === "notfound" &&
                "Não encontrei este jogo no Sportscore: escreve o resultado e o minuto à mão (ou cola o link do jogo)."}
              {syncInfo?.kind === "error" &&
                "Não consegui ler o Sportscore agora: escreve à mão. Volto a tentar daqui a um minuto."}
              {liveState?.phase === "live" && (
                <span className="text-emerald-400">
                  Em direto · {liveState.homeGoals ?? "?"}–{liveState.awayGoals ?? "?"} · {liveState.minute ?? "?"}&apos;
                </span>
              )}
              {liveState?.phase === "halftime" && (
                <span className="text-amber-400">
                  Intervalo · {liveState.homeGoals ?? "?"}–{liveState.awayGoals ?? "?"}
                </span>
              )}
              {liveState?.phase === "finished" && (
                <span className="text-neutral-300">
                  Jogo terminado · {liveState.homeGoals ?? "?"}–{liveState.awayGoals ?? "?"}
                </span>
              )}
              {liveState?.phase === "upcoming" && <span className="text-neutral-300">O jogo ainda não começou.</span>}
              {liveState?.phase === "unknown" && (
                <span className="text-amber-400">
                  Estado que não conheço: &quot;{liveState.raw.statusText || liveState.raw.status}&quot;. Escreve à mão.
                </span>
              )}
              {seconds !== null && <span className="text-neutral-500"> · lido há {seconds}s</span>}
              {syncInfo?.kind === "ok" && syncInfo.ageMs !== null && syncInfo.ageMs > 90_000 && (
                <span className="text-neutral-500"> · dados do Sportscore de há {Math.round(syncInfo.ageMs / 60_000)} min</span>
              )}
            </p>
          )}
          {syncOn && staleInfo && (
            <p className="mt-1.5 rounded-lg bg-amber-950 px-3 py-2 text-amber-300">
              Os dados que o Sportscore tem deste jogo estão atrasados (de há {Math.round(staleInfo.ageMs / 60_000)} min) e
              dizem &quot;{staleInfo.state.raw.statusText || staleInfo.state.raw.status}&quot;. Ignoro-os: escreve o resultado
              e o minuto à mão, ou tenta de novo daqui a um minuto.
            </p>
          )}
          {syncOn && syncInfo?.kind === "ok" && syncInfo.notes.length > 0 && (
            <p className="mt-1.5 text-[11px] text-amber-400">{syncInfo.notes.join(" ")}</p>
          )}
          {syncOn && redCards > 0 && liveState && (
            <p className="mt-1.5 rounded-lg bg-amber-950 px-3 py-2 text-amber-300">
              Cartões vermelhos: {homeName} {liveState.reds.home}, {awayName} {liveState.reds.away}. O modelo não conta
              cartões vermelhos, por isso as probabilidades abaixo são menos fiáveis.
            </p>
          )}
          {syncOn && liveState && liveState.stats.length > 0 && (
            <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Estatísticas do jogo ({homeName} – {awayName})
              </p>
              <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-[11px]">
                {liveState.stats.map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="text-neutral-500">{STAT_NAMES[row.label] ?? row.label}</dt>
                    <dd className="text-right text-neutral-200">
                      {row.home}
                      {row.suffix} – {row.away}
                      {row.suffix}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-1 text-[10px] text-neutral-600">
                Só para ver: o modelo não usa estas estatísticas (não as consigo testar).
              </p>
            </div>
          )}
          {syncOn && liveState && (
            <p className="mt-1.5 text-[11px] text-neutral-500">
              Amarelos: {homeName} {liveState.yellows.home}, {awayName} {liveState.yellows.away}. Estado no Sportscore:{" "}
              {liveState.raw.statusText || liveState.raw.status || "—"}
              {liveState.raw.liveMinute ? ` · minuto ${liveState.raw.liveMinute}` : ""}.
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-neutral-500">
            Dados de{" "}
            <a href="https://sportscore.com" target="_blank" rel="noopener" className="text-amber-400 hover:underline">
              Powered by SportScore
            </a>
            .
          </p>
        </div>
      )}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr]">
          <div>
            <label className="mb-1 block text-sm text-neutral-300">Minuto</label>
            <div className="flex gap-2">
              <button type="button" className={button} onClick={() => step(setMinuteByHand, m, -1, 0, 120)} aria-label="Menos um minuto">
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="120"
                value={minute}
                onChange={(e) => setMinuteByHand(e.target.value)}
                className={`${INPUT} text-center`}
              />
              <button type="button" className={button} onClick={() => step(setMinuteByHand, m, 1, 0, 120)} aria-label="Mais um minuto">
                +
              </button>
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={running}
                onChange={(e) => {
                  anchor.current = { minute: m, at: Date.now() };
                  setRunning(e.target.checked);
                }}
                className="accent-amber-500"
              />
              Deixar o minuto andar sozinho
            </label>
            {running && (
              <p className="mt-1 text-[11px] leading-snug text-amber-400/90">
                Sobe um minuto por minuto real. Não sabe do intervalo: desliga aos 45&apos; e volta a ligar quando a
                2.ª parte começar (com o minuto 46).
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm text-neutral-300">Resultado</label>
            <div className="flex items-center gap-2">
              <span className="hidden min-w-0 flex-1 truncate text-right text-sm text-neutral-300 sm:block">{homeName}</span>
              <button type="button" className={button} onClick={() => step(setHomeGoals, h, -1, 0, 20)} aria-label={`Menos um golo ${homeName}`}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="20"
                value={homeGoals}
                onChange={(e) => setHomeGoals(e.target.value)}
                className={`${INPUT} w-16 text-center`}
              />
              <button type="button" className={button} onClick={() => step(setHomeGoals, h, 1, 0, 20)} aria-label={`Mais um golo ${homeName}`}>
                +
              </button>
              <span className="px-1 text-neutral-500">–</span>
              <button type="button" className={button} onClick={() => step(setAwayGoals, a, -1, 0, 20)} aria-label={`Menos um golo ${awayName}`}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="20"
                value={awayGoals}
                onChange={(e) => setAwayGoals(e.target.value)}
                className={`${INPUT} w-16 text-center`}
              />
              <button type="button" className={button} onClick={() => step(setAwayGoals, a, 1, 0, 20)} aria-label={`Mais um golo ${awayName}`}>
                +
              </button>
              <span className="hidden min-w-0 flex-1 truncate text-sm text-neutral-300 sm:block">{awayName}</span>
            </div>
            <p className="mt-1 text-center text-[11px] text-neutral-500 sm:hidden">
              {homeName} – {awayName}
            </p>
          </div>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-amber-400 hover:underline">
            Golos esperados antes do jogo: {dot(expectedHome)} – {dot(expectedAway)}
            {fromModel ? " (do modelo)" : " (valores típicos)"}
          </summary>
          <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-neutral-400">{homeName}</label>
              <input type="text" inputMode="decimal" value={lh} onChange={(e) => setLh(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-400">{awayName}</label>
              <input type="text" inputMode="decimal" value={la} onChange={(e) => setLa(e.target.value)} className={INPUT} />
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            {fromModel
              ? "Vêm da comparação das duas equipas, sem ajustes. Podes mudá-los se souberes mais (uma lesão, um jogo que se sabe aberto)."
              : "Sem equipas escolhidas, usam-se valores típicos de uma liga (1,4 e 1,1). Muda-os para o jogo que estás a ver: uma equipa muito superior tem mais golos esperados, e um jogo fechado menos."}
          </p>
        </details>

        {sourceLines.length > 0 && (
          <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              De onde vêm os golos esperados
            </p>
            {sourceLines.map((line) => (
              <p key={line} className="text-[11px] leading-relaxed text-neutral-400">
                {line}
              </p>
            ))}
          </div>
        )}

        <p className="mt-3 text-xs text-neutral-400">
          Ainda se esperam <span className="font-medium text-neutral-200">{dot(p.remainingHome + p.remainingAway)}</span>{" "}
          golos ({dot(p.remainingHome)} de {homeName}, {dot(p.remainingAway)} de {awayName}).
        </p>
      </div>

      <div className="rounded-2xl border border-amber-800/50 bg-amber-950/20 p-5">
        <h3 className="mb-2 text-sm font-semibold text-amber-300">O que ainda pode acontecer</h3>
        <ul className="list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-neutral-200 marker:text-neutral-600">
          {liveSummary(p, { home: homeName, away: awayName, minute: m, homeGoals: h, awayGoals: a }).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-emerald-300">Aposta sugerida em live</h3>
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            Odd justa mínima
            <select
              value={minOdd}
              onChange={(e) => setMinOdd(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100 outline-none focus:border-emerald-500"
            >
              {["1.3", "1.5", "1.8", "2"].map((v) => (
                <option key={v} value={v}>
                  {v.replace(".", ",")}
                </option>
              ))}
            </select>
          </label>
        </div>

        {m >= LAST_MINUTES ? (
          <p className="text-sm text-neutral-400">O jogo está nos descontos: já pouco pode acontecer, sem sugestão.</p>
        ) : !suggestion.main ? (
          <p className="text-sm text-neutral-400">
            Sem aposta clara: nenhum mercado tem uma odd justa de {minOdd.replace(".", ",")} ou mais sem estar já
            quase decidido. Baixa a odd mínima ou espera. Não apostar também é uma decisão.
          </p>
        ) : (
          <>
            <p className="text-base font-semibold text-neutral-100">{suggestion.main.label}</p>
            <p className="text-xs text-neutral-400">
              Chance estimada <span className="font-medium text-neutral-200">{pct(suggestion.main.p)}</span> · odd justa{" "}
              {formatOdd(suggestion.main.fairOdd)} ·{" "}
              <span className="font-medium text-emerald-400">compensa a partir de {formatOdd(suggestion.main.minOdd)}</span>
            </p>
            {suggestion.others.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-emerald-900/40 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Outras opções</p>
                {suggestion.others.map((pick) => (
                  <div key={pick.key}>
                    <p className="text-sm font-medium text-neutral-200">{pick.label}</p>
                    <p className="text-xs text-neutral-400">
                      Chance estimada <span className="font-medium text-neutral-200">{pct(pick.p)}</span> · odd justa{" "}
                      {formatOdd(pick.fairOdd)} ·{" "}
                      <span className="font-medium text-emerald-400">compensa a partir de {formatOdd(pick.minOdd)}</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
          É a aposta mais provável com pelo menos essa odd justa, e o número a verde é a odd que a casa teria de pagar para
          valer a pena (a odd justa com a chance cortada, mais 5%). Testei este critério <span className="text-neutral-400">ao intervalo</span>{" "}
          em 6.062 jogos de 2025/26: a aposta principal que o modelo dava 60,5% aconteceu em 59,4% (com odd justa mínima de
          1,5); nos golos o modelo é otimista (dizia 58,9% e aconteceu 55,5%), por isso a chance é cortada mais. Sem os
          dados das equipas (valores típicos) o resultado foi praticamente igual (60,1%), porque perto do intervalo quase
          tudo vem do resultado e do tempo que falta. <span className="text-amber-400">A outros minutos não consigo testar.</span>{" "}
          Acertar muitas vezes não é o mesmo que ganhar dinheiro: compara com a odd da casa aqui em baixo.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Table key={g.title} title={g.title} rows={g.rows} />
        ))}
      </div>

      <OddChecker markets={oddMarkets} />

      <p className="text-xs leading-relaxed text-neutral-500">
        Parte dos golos que cada equipa devia marcar no jogo todo e tira a parte que já passou, dando mais peso à 2.ª
        parte, onde há mais golos. Conta o resultado (quem está a ganhar marca menos, quem está a perder ou empatado
        marca mais) e que os golos são mais regulares do que o acaso puro. Foi medido em 4.431 jogos e testado ao{" "}
        <span className="text-neutral-400">intervalo</span> em 2.220 jogos de 2025/26 que não usei para o medir: a
        probabilidade de &quot;mais um golo até ao fim&quot; previu 86,2% e aconteceu 86,0%, e em quem ganha e em ambas
        marcam bateu a média histórica. <span className="text-amber-400">A outros minutos não consigo testar</span>, porque
        os dados não têm o minuto dos golos: aí é uma extrapolação razoável e mais nada. Não sabe de cartões vermelhos,
        lesões nem do ritmo do jogo.
      </p>
    </div>
  );
}
