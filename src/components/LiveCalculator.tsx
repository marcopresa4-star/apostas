"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import OddChecker, { type OddMarket } from "./OddChecker";
import type { StandingsLine } from "./StandingsTable";
import VenueStandings from "./VenueStandings";
import { predictLive } from "@/lib/liveModel";
import { oddsKeyFor, type ParsedOdds } from "@/lib/oddsParse";
import { liveSummary } from "@/lib/liveSummary";
import { htLiveProbs, LAST_MINUTES, liveCandidates, livePickWhy, liveTotalLine, suggestLive } from "@/lib/liveBet";
import { clockMinute, rawSnapshot, saveGame, savedFrom, type SavedGame } from "@/lib/liveStore";
import { checkLive, type LiveGameState } from "@/lib/sportscoreLive";
import { useNow } from "@/lib/useNow";
import { fairOdd, type PlayedMatch } from "@/lib/footballModel";
import { formatOdd } from "@/lib/multiples";
import LiveEvolutionChart, { type EvoSnap } from "./LiveEvolutionChart";

const INPUT =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none transition-colors focus:border-emerald-500";
const dot = (n: number) => n.toFixed(1).replace(".", ",");
// Quarter lines need both decimals ("1,75", not "1,8").
const qdot = (n: number) => n.toFixed(2).replace(".", ",");
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
  // The model's market key ("home", "over:1.5", "btts:yes"...): links the row
  // to the bookmaker's real odd.
  key?: string;
  // Chance the stake comes back (draws on DNB).
  push?: number;
}

// Fair odd of a row, paying the refund out when pushes exist.
function rowFair(row: Row): number {
  if (!(row.p > 0)) return Infinity;
  const push = row.push ?? 0;
  return push > 0 ? (1 - push) / row.p : 1 / row.p;
}

// Past meetings between the two sides: who won what, scoring pace, and the
// most recent games. Small on purpose: the live model itself ignores H2H
// (strength comes from all games), this is context for the eye.
function H2HCard({ meetings, home, away }: { meetings: PlayedMatch[]; home: string; away: string }) {
  const forHome = (m: PlayedMatch): [number, number] => (m.team1 === home ? m.ft : [m.ft[1], m.ft[0]]);
  const w = meetings.filter((m) => {
    const [gf, ga] = forHome(m);
    return gf > ga;
  }).length;
  const d = meetings.filter((m) => m.ft[0] === m.ft[1]).length;
  const l = meetings.length - w - d;
  const avg = (meetings.reduce((s, m) => s + m.ft[0] + m.ft[1], 0) / meetings.length).toFixed(1).replace(".", ",");
  const over25 = Math.round((meetings.filter((m) => m.ft[0] + m.ft[1] > 2.5).length / meetings.length) * 100);
  const btts = Math.round((meetings.filter((m) => m.ft[0] > 0 && m.ft[1] > 0).length / meetings.length) * 100);
  const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-1 text-sm font-semibold text-neutral-300">
        Confrontos diretos · {meetings.length} {meetings.length === 1 ? "jogo" : "jogos"}
      </h3>
      <p className="text-xs text-neutral-400">
        {home}: {w} vitórias · {d} empates · {away}: {l} vitórias
      </p>
      <p className="mt-1 text-xs text-neutral-400">
        Média de {avg} golos por jogo · mais de 2,5 em {over25}% · ambas marcam em {btts}%
      </p>
      <ul className="mt-2 space-y-1">
        {meetings.slice(0, 5).map((m) => (
          <li key={`${m.date}-${m.team1}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="shrink-0 text-neutral-500">{dayMonth(m.date)}</span>
            <span className="min-w-0 flex-1 truncate text-right text-neutral-300">
              {m.team1} <span className="font-semibold text-neutral-100">{m.ft[0]}–{m.ft[1]}</span> {m.team2}
            </span>
          </li>
        ))}
      </ul>
      {meetings.length > 5 && <p className="pt-1 text-[11px] text-neutral-500">e mais {meetings.length - 5} anteriores</p>}
    </div>
  );
}

interface ScorerRow {
  name: string;
  home: boolean;
  p: number;
  fair: number;
}

// Most likely final scores, as bars: instant read next to the suggestion.
function FinalScoresChart({ scores }: { scores: { home: number; away: number; p: number }[] }) {
  if (scores.length === 0) return null;
  const max = Math.max(...scores.map((s) => s.p), 0.01);
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="mb-2 text-sm font-semibold text-neutral-300">Finais mais prováveis</h3>
      <div className="space-y-1.5 text-sm">
        {scores.map((s) => (
          <div key={`${s.home}-${s.away}`} className="flex items-center gap-2">
            <span className="w-12 shrink-0 tabular-nums text-neutral-200">
              {s.home}–{s.away}
            </span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-800">
              <div className="h-full rounded-full bg-emerald-500/80" style={{ width: `${(s.p / max) * 100}%` }} />
            </div>
            <span className="w-12 shrink-0 text-right font-medium text-emerald-300">{pct(s.p)}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
              {row.push !== undefined && row.push >= 0.005 && (
                <span className="ml-1.5 text-[10px] text-neutral-500">devolve {Math.round(row.push * 100)}%</span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="w-12 text-right font-medium text-emerald-300">{pct(row.p)}</span>
              <span className="w-14 text-right text-xs text-neutral-500">
                @{Number.isFinite(rowFair(row)) ? formatOdd(rowFair(row)) : "—"}
              </span>
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
  // How to read the game from SofaScore: the numeric event id from the pasted
  // SofaScore link (see parseSofascoreId). Read through /api/sofascore/event,
  // which proxies the local CloakBrowser scraper.
  sofaEventId?: number | null;
  // League table with both sides highlighted (clubs only, like Comparar's
  // "Classificação e força"): official points with our attack/defence.
  // standingsHome/Away carry the league's own spelling when the game does
  // not ("Charlotte FC" vs "Charlotte").
  standings?: StandingsLine[];
  standingsLabel?: string;
  standingsSeason?: string;
  standingsHome?: string;
  standingsAway?: string;
  // Casa/Fora views for the toggle (counted from the season's games).
  venueStandings?: { home: StandingsLine[]; away: StandingsLine[] };
  // Past meetings between the two sides, most recent first (clubs: this
  // league; national sides: last 8 years). Empty when unknown.
  h2h?: PlayedMatch[];
};

const SOFASCORE_EVENT = "/api/sofascore/event?id=";

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
  sofaEventId,
  standings,
  standingsLabel = "",
  standingsSeason = "",
  standingsHome,
  standingsAway,
  venueStandings,
  h2h,
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
  const [redsHome, setRedsHome] = useState(String(saved?.redsHome ?? 0));
  const [redsAway, setRedsAway] = useState(String(saved?.redsAway ?? 0));
  const [lh, setLh] = useState(saved?.lh ?? dot(lambdaHome));
  const [la, setLa] = useState(saved?.la ?? dot(lambdaAway));

  // The game read from SofaScore, once a minute: score, minute and cards. Every
  // reading overwrites what is typed, so the box below turns it off.
  const [syncOn, setSyncOn] = useState(true);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  // The bookmaker's real odds for this event, refreshed with the minute poll.
  const [realOdds, setRealOdds] = useState<ParsedOdds | null>(null);
  // Live shotmap (minute, side, xG) for the live-form nudge: only when the
  // game is synced; manual mode keeps minute and score only. Refreshed every
  // other poll — xG pace needs no minute freshness, and the serial scraper
  // stays responsive.
  const [shotmap, setShotmap] = useState<{ minute: number; home: boolean; xg: number | null }[] | null>(null);
  const lastShotmapAt = useRef(0);
  // Evolution snapshots: one per successful minute poll (score, cards,
  // cumulative stats, accumulated xG). The chart draws history from these.
  const [snaps, setSnaps] = useState<EvoSnap[]>([]);
  const [filled, setFilled] = useState(false);
  const shotmapRef = useRef<typeof shotmap>(null);
  useEffect(() => {
    shotmapRef.current = shotmap;
  }, [shotmap]);
  // Backfill when joining late: rebuild minutes 1..M from the shotmap
  // (every shot carries its minute) and the goal incidents, so the chart is
  // born full. Cumulative stats have no history: they start at our arrival
  // (gaps before, never zeros). Runs once per game; live polls keep appending.
  useEffect(() => {
    if (!sofaEventId || !syncOn || filled) return;
    if (syncInfo?.kind !== "ok") return;
    const st = syncInfo.state;
    if (st.phase !== "live" && st.phase !== "halftime" && st.phase !== "finished") return;
    if ((st.minute ?? 0) < 1) return;
    let stop = false;
    const fill = async (): Promise<void> => {
      try {
        let sm = shotmapRef.current;
        if (!sm) {
          const res = await fetch(`/api/sofascore/shotmap?id=${encodeURIComponent(String(sofaEventId))}`, { cache: "no-store" });
          if (!stop && res.ok) {
            const body = (await res.json()) as { shots?: { minute?: unknown; home?: unknown; xg?: unknown }[] };
            if (body && Array.isArray(body.shots)) {
              sm = body.shots.flatMap((s) =>
                typeof s.minute === "number" && typeof s.home === "boolean"
                  ? [{ minute: s.minute, home: s.home, xg: typeof s.xg === "number" ? s.xg : null }]
                  : []
              );
              setShotmap(sm);
            }
          }
        }
        const res = await fetch(SOFASCORE_EVENT + encodeURIComponent(String(sofaEventId)), { cache: "no-store" });
        if (stop || !res.ok) return;
        const body = (await res.json()) as { goals?: { minute?: unknown; home?: unknown }[] };
        const goals = Array.isArray(body?.goals)
          ? body.goals.flatMap((gl) =>
              typeof gl.minute === "number" && typeof gl.home === "boolean" ? [{ minute: gl.minute, home: gl.home }] : []
            )
          : [];
        const M = Math.min(130, st.minute ?? 0);
        const shots = sm ?? [];
        const built: EvoSnap[] = [];
        for (let minute = 1; minute <= M; minute++) {
          const hg = goals.filter((gl) => gl.home && gl.minute <= minute).length;
          const ag = goals.filter((gl) => !gl.home && gl.minute <= minute).length;
          const xgList = (isHome: boolean): number | null => {
            const list = shots.filter((s) => s.home === isHome && s.xg !== null && s.minute <= minute);
            return list.length > 0 ? list.reduce((n, s) => n + (s.xg ?? 0), 0) : null;
          };
          built.push({
            minute,
            hg,
            ag,
            rh: st.reds.home,
            ra: st.reds.away,
            stats: {},
            xgH: xgList(true),
            xgA: xgList(false),
          });
        }
        if (!stop && built.length > 0) {
          setSnaps((prev) => {
            const byMin = new Map(prev.map((s) => [s.minute, s]));
            for (const s of built) if (!byMin.has(s.minute)) byMin.set(s.minute, s);
            return [...byMin.values()].sort((a, b) => a.minute - b.minute).slice(-150);
          });
          setFilled(true);
        }
      } catch {
        // Next poll retries via the normal snapshot flow.
      }
    };
    void fill();
    return () => {
      stop = true;
    };
  }, [sofaEventId, syncOn, syncInfo, filled]);
  // Anytime-scorer prices for the probable starters (needs lineups): fetched
  // rarely, the XI barely moves. Hidden without coverage.
  const [scorers, setScorers] = useState<{ home: ScorerRow[]; away: ScorerRow[] } | null>(null);
  const now = useNow(5000);
  // The game read from SofaScore, once a minute via the local scraper: score,
  // minute and cards. Every reading overwrites what is typed, so the box
  // below turns it off.
  useEffect(() => {
    if (!sofaEventId || !syncOn) return;
    let stop = false;
    const apply = (state: LiveGameState) => {
      if (state.homeGoals !== null) setHomeGoals(String(state.homeGoals));
      if (state.awayGoals !== null) setAwayGoals(String(state.awayGoals));
      setRedsHome(String(state.reds.home));
      setRedsAway(String(state.reds.away));
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
        const res = await fetch(SOFASCORE_EVENT + encodeURIComponent(String(sofaEventId)), { cache: "no-store" });
        if (stop) return;
        if (res.status === 404) {
          setSyncInfo({ kind: "notfound" });
          return;
        }
        if (res.status === 503) {
          // Scraper offline: say so once, keep manual entry. The route's hint
          // explains how to start it; no point retrying every render.
          setSyncInfo({ kind: "error" });
          return;
        }
        if (!res.ok) {
          setSyncInfo({ kind: "error" });
          return;
        }
        const body = (await res.json()) as {
          state: LiveGameState;
          stale?: boolean;
          ageMs?: number | null;
          notes?: string[];
        };
        if (!body?.state) {
          setSyncInfo({ kind: "error" });
          return;
        }
        const checked = checkLive(body.state, Date.now());
        if (checked.stale) {
          setSyncInfo({ kind: "stale", state: body.state, ageMs: checked.ageMs ?? 0, at: Date.now() });
          return;
        }
        apply(checked.state);
        setSyncInfo({ kind: "ok", state: checked.state, at: Date.now(), notes: checked.notes, ageMs: checked.ageMs });
        // Evolution snapshot for the chart: cumulative stats ride along (one
        // more read per minute, like the widget does), xG comes from the
        // shotmap already held. Missing readings stay missing (gaps, not zeros).
        if (!stop && (checked.state.phase === "live" || checked.state.phase === "halftime")) {
          try {
            const st = await fetch(`/api/sofascore/statistics?id=${encodeURIComponent(String(sofaEventId))}`, {
              cache: "no-store",
            });
            const stats: EvoSnap["stats"] = {};
            if (!stop && st.ok) {
              const sb = (await st.json()) as { stats?: { name?: unknown; home?: unknown; away?: unknown }[] };
              if (sb && Array.isArray(sb.stats)) {
                for (const row of sb.stats) {
                  if (typeof row?.name !== "string") continue;
                  const num = (v: unknown): number | null => {
                    const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v.replace("%", "")) : NaN;
                    return Number.isFinite(n) ? n : null;
                  };
                  stats[row.name] = { home: num(row.home), away: num(row.away) };
                }
              }
            }
            if (!stop) {
              const sm = shotmapRef.current ?? [];
              const xgUpTo = (isHome: boolean): number | null => {
                const list = sm.filter((s) => s.home === isHome && s.xg !== null && s.minute <= (checked.state.minute ?? 0));
                return list.length > 0 ? list.reduce((n, s) => n + (s.xg ?? 0), 0) : null;
              };
              const snap: EvoSnap = {
                minute: checked.state.minute ?? 0,
                hg: checked.state.homeGoals ?? 0,
                ag: checked.state.awayGoals ?? 0,
                rh: checked.state.reds.home,
                ra: checked.state.reds.away,
                stats,
                xgH: xgUpTo(true),
                xgA: xgUpTo(false),
              };
              setSnaps((prev) => {
                const next = prev.some((s) => s.minute === snap.minute) ? prev.map((s) => (s.minute === snap.minute ? snap : s)) : [...prev, snap];
                return next.slice(-150);
              });
            }
          } catch {
            // No snapshot this minute: the chart keeps what it has.
          }
        }
      } catch {
        if (!stop) setSyncInfo({ kind: "error" });
      }
      // Real odds ride along (no page navigation involved, so this is fast);
      // a game the bookmakers skip just keeps manual entry.
      try {
        const odds = await fetch(`/api/sofascore/odds?id=${encodeURIComponent(String(sofaEventId))}`, {
          cache: "no-store",
        });
        if (!stop && odds.ok) {
          const parsed = (await odds.json()) as ParsedOdds;
          if (parsed && Array.isArray(parsed.markets)) setRealOdds(parsed);
        }
      } catch {
        // Odds unavailable: manual entry stays.
      }
      // Shotmap rides along too, every other poll: accumulated xG feeds the
      // live-form nudge in the suggestion below (without xG values there is
      // no nudge). Spaced out on purpose — one more read per minute per game
      // is what turns a slow scraper into a stalled one.
      if (!stop && Date.now() - lastShotmapAt.current > 120_000) {
        lastShotmapAt.current = Date.now();
        try {
          const sm = await fetch(`/api/sofascore/shotmap?id=${encodeURIComponent(String(sofaEventId))}`, {
            cache: "no-store",
          });
          if (!stop && sm.ok) {
            const body = (await sm.json()) as { shots?: { minute?: unknown; home?: unknown; xg?: unknown }[] };
            if (body && Array.isArray(body.shots)) {
              setShotmap(
                body.shots.flatMap((s) =>
                  typeof s.minute === "number" && typeof s.home === "boolean"
                    ? [{ minute: s.minute, home: s.home, xg: typeof s.xg === "number" ? s.xg : null }]
                    : []
                )
              );
            }
          }
        } catch {
          // No shotmap: minute and score alone decide.
        }
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
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sofaEventId, syncOn]);
  // Anytime scorers ride along rarely: the XI barely moves once known.
  useEffect(() => {
    if (!sofaEventId) return;
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/sofascore/scorers?id=${encodeURIComponent(String(sofaEventId))}`, {
          cache: "no-store",
        });
        if (stop || !res.ok) return;
        const body = (await res.json()) as { home?: ScorerRow[]; away?: ScorerRow[] };
        if (body && Array.isArray(body.home) && Array.isArray(body.away)) {
          const clean = (rows: ScorerRow[]): ScorerRow[] =>
            rows.flatMap((r) =>
              typeof r.name === "string" && r.name && r.p > 0 && r.p < 1 && Number.isFinite(r.fair)
                ? [{ name: r.name, home: r.home === true, p: r.p, fair: r.fair }]
                : []
            );
          const home = clean(body.home);
          const away = clean(body.away);
          if (!stop && (home.length > 0 || away.length > 0)) setScorers({ home, away });
        }
      } catch {
        // No lineups, no scorers: the section stays hidden.
      }
    };
    void load();
    const id = setInterval(() => void load(), 600_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [sofaEventId]);
  // The lowest fair odd a suggested bet may have: a bet the model gives 90% is
  // "safe" but pays next to nothing, so it is left out.
  const [minOdd, setMinOdd] = useState("1.5");

  const m = whole(minute, 0, 120, 0);
  const h = whole(homeGoals, 0, 20, 0);
  const a = whole(awayGoals, 0, 20, 0);
  const expectedHome = decimal(lh, 0.05, 6, lambdaHome);
  const expectedAway = decimal(la, 0.05, 6, lambdaAway);
  // Sending-offs: the synced count wins when the SofaScore reading is on,
  // otherwise what was typed. They scale what each side still scores.
  const liveStateForReds = syncOn && syncInfo?.kind === "ok" ? syncInfo.state : null;
  const rH = liveStateForReds ? liveStateForReds.reds.home : whole(redsHome, 0, 5, 0);
  const rA = liveStateForReds ? liveStateForReds.reds.away : whole(redsAway, 0, 5, 0);

  // Accumulated live xG up to the current minute (synced games only): feeds
  // the live-form nudge below. Without xG values the suggestion stays on
  // minute and score alone.
  const hasLiveXg = shotmap !== null && shotmap.some((s) => s.xg !== null);
  const xgAt = (isHome: boolean): number =>
    (shotmap ?? [])
      .filter((s) => s.home === isHome && s.xg !== null && s.minute <= m)
      .reduce((n, s) => n + (s.xg ?? 0), 0);
  const liveXg = hasLiveXg ? { home: xgAt(true), away: xgAt(false) } : null;

  const p = predictLive({
    lambdaHome: expectedHome,
    lambdaAway: expectedAway,
    firstHalfShare,
    minute: m,
    homeGoals: h,
    awayGoals: a,
    redsHome: rH,
    redsAway: rA,
    ...(liveXg ? { homeXg: liveXg.home, awayXg: liveXg.away } : {}),
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
      redsHome: whole(redsHome, 0, 5, 0),
      redsAway: whole(redsAway, 0, 5, 0),
      lh,
      la,
      firstHalfShare,
    });
  }, [gameKey, href, home, away, m, running, h, a, redsHome, redsAway, lh, la, firstHalfShare]);

  const total = h + a;
  const homeName = home || "Casa";
  const awayName = away || "Fora";

  // "More than X,5 goals" only for the lines still open, with how many are missing.
  // Whole-number lines sit right after their .5 neighbour, so the table reads
  // in line order (2,5 · 3,0 · 3,5 …), not .5s first and wholes after.
  const goalRows: Row[] = [];
  for (let k = 0; k < 4; k++) {
    const half = total + k + 0.5;
    const over = p.over[String(half)];
    goalRows.push(
      { label: `Mais de ${dot(half)} golos`, p: over, note: `faltam ${k + 1}`, key: `over:${half}` },
      { label: `Menos de ${dot(half)} golos`, p: 1 - over, key: `under:${half}` }
    );
    if (k < 3) {
      const whole = total + k + 1;
      const t = liveTotalLine(p, h, a, whole);
      goalRows.push(
        { label: `Mais de ${dot(whole)} golos`, p: t.over, note: `faltam ${k + 2}`, key: `over:${whole}`, push: t.push },
        { label: `Menos de ${dot(whole)} golos`, p: t.under, key: `under:${whole}`, push: t.push }
      );
    }
  }
  const bothDone = h > 0 && a > 0;

  // Team totals over the game (absolute lines): tail of each side's own
  // remaining-goals distribution. Lines stay .5, so nothing pushes.
  const teamTail = (side: "home" | "away", line: number, dir: "over" | "under"): number => {
    const scored = side === "home" ? h : a;
    const pmf = side === "home" ? p.homePmf : p.awayPmf;
    let over = 0;
    for (let i = 0; i < pmf.length; i++) if (scored + i > line) over += pmf[i];
    const push = Number.isInteger(line) ? (pmf[line - scored] ?? 0) : 0;
    return dir === "over" ? over : Math.max(0, 1 - over - push);
  };
  const teamPush = (side: "home" | "away", line: number): number | undefined => {
    if (!Number.isInteger(line)) return undefined;
    const scored = side === "home" ? h : a;
    const pmf = side === "home" ? p.homePmf : p.awayPmf;
    const push = pmf[line - scored] ?? 0;
    return push >= 0.005 ? push : undefined;
  };
  const teamRows: Row[] = [0.5, 1, 1.5, 2, 2.5].flatMap((line) =>
    (["home", "away"] as const).flatMap((side) => {
      const team = side === "home" ? homeName : awayName;
      const push = teamPush(side, line);
      return [
        { label: `${team} mais de ${dot(line)}`, p: teamTail(side, line, "over"), key: `to:${side}:${line}`, ...(push !== undefined ? { push } : {}) },
        { label: `${team} menos de ${dot(line)}`, p: teamTail(side, line, "under"), key: `tu:${side}:${line}`, ...(push !== undefined ? { push } : {}) },
      ];
    })
  );
  const dnbDenom = p.fullTime.home + p.fullTime.away;
  // All live candidates once: the suggestion and the handicap table share
  // them, so the two can never disagree.
  const cands = liveCandidates(p, { home: homeName, away: awayName, homeGoals: h, awayGoals: a, minute: m });
  // Handicap rows come straight from the candidates above.
  const ahRows: Row[] = cands
    .filter((c) => c.key.startsWith("ah:"))
    .map((c) => ({ label: c.label, p: c.p, key: c.key, ...(c.push !== undefined ? { push: c.push } : {}) }));
  // Asian quarter rows the same way: the table can never disagree with the
  // suggestion, and the keys match the pre-match ones (final total).
  const quarterKey = /^(over|under):\d+\.(25|75)$/;
  const asianRows: Row[] = cands
    .filter((c) => quarterKey.test(c.key))
    .map((c) => ({ label: c.label, p: c.p, key: c.key, ...(c.push !== undefined ? { push: c.push } : {}) }));
  const quarterTeamKey = /^(to|tu):(home|away):\d+\.(25|75)$/;
  const asianTeamRows: Row[] = cands
    .filter((c) => quarterTeamKey.test(c.key))
    .map((c) => ({ label: c.label, p: c.p, key: c.key, ...(c.push !== undefined ? { push: c.push } : {}) }));
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Resultado final",
      rows: [
        { label: `${homeName} vence`, p: p.fullTime.home, key: "home" },
        { label: "Empate", p: p.fullTime.draw, key: "draw" },
        { label: `${awayName} vence`, p: p.fullTime.away, key: "away" },
        { label: `${homeName} ou empate (1X)`, p: p.fullTime.home + p.fullTime.draw, key: "1x" },
        { label: `${awayName} ou empate (X2)`, p: p.fullTime.away + p.fullTime.draw, key: "x2" },
        { label: "Sem empate (12)", p: p.fullTime.home + p.fullTime.away, key: "12" },
        {
          label: `Empate anula: ${homeName}`,
          p: dnbDenom > 0 ? p.fullTime.home / dnbDenom : 0,
          key: "dnb:home",
          push: p.fullTime.draw,
        },
        {
          label: `Empate anula: ${awayName}`,
          p: dnbDenom > 0 ? p.fullTime.away / dnbDenom : 0,
          key: "dnb:away",
          push: p.fullTime.draw,
        },
      ],
    },
    { title: "Golos até ao fim", rows: goalRows },
    { title: "Total asiático", rows: asianRows },
    { title: "Handicap asiático", rows: ahRows },
    ...(m < 45
      ? (() => {
          // Totals include the goals already scored (all first-half goals so
          // far): a covered line reads 100%, a dead one 0%.
          const ht = htLiveProbs(p, h, a);
          const htLabel = (line: number): string =>
            line === 1 ? "1 golo" : Math.abs(line % 1) === 0.25 || Math.abs(line % 1) === 0.75 ? `${qdot(line)} golos` : `${dot(line)} golos`;
          const rows: Row[] = [];
          for (const line of [0.5, 0.75, 1, 1.25, 1.5]) {
            const t = ht.total[String(line)];
            const push = t.push >= 0.005 ? t.push : undefined;
            rows.push(
              {
                label: `Mais de ${htLabel(line)} (1.ª parte)`,
                p: t.over,
                key: `htover:${line}`,
                ...(push !== undefined ? { push } : {}),
              },
              {
                label: `Menos de ${htLabel(line)} (1.ª parte)`,
                p: t.under,
                key: `htunder:${line}`,
                ...(push !== undefined ? { push } : {}),
              }
            );
            for (const side of ["home", "away"] as const) {
              const team = side === "home" ? homeName : awayName;
              const s = (side === "home" ? ht.home : ht.away)[String(line)];
              const spush = s.push >= 0.005 ? s.push : undefined;
              rows.push(
                {
                  label: `${team} mais de ${htLabel(line)} (1.ª parte)`,
                  p: s.over,
                  key: `htto:${side}:${line}`,
                  ...(spush !== undefined ? { push: spush } : {}),
                },
                {
                  label: `${team} menos de ${htLabel(line)} (1.ª parte)`,
                  p: s.under,
                  key: `httu:${side}:${line}`,
                  ...(spush !== undefined ? { push: spush } : {}),
                }
              );
            }
          }
          return [{ title: "Primeira parte (a decorrer)", rows }];
        })()
      : []),
    ...(m >= 45
      ? [
          {
            title: "Segunda parte",
            rows: ([0.5, 1.5] as const).flatMap((line) => {
        const k = String(line);
        const over = k === "0.5" ? p.secondHalf.over05 : p.secondHalf.over15;
        const homeOver = k === "0.5" ? p.secondHalf.homeOver05 : p.secondHalf.homeOver15;
        const awayOver = k === "0.5" ? p.secondHalf.awayOver05 : p.secondHalf.awayOver15;
        return [
          { label: `Mais de ${dot(line)} golos (2.ª parte)`, p: over, key: `shover:${line}` },
          { label: `Menos de ${dot(line)} golos (2.ª parte)`, p: 1 - over, key: `shunder:${line}` },
          { label: `${homeName} mais de ${dot(line)} (2.ª parte)`, p: homeOver, key: `shto:home:${line}` },
          { label: `${homeName} menos de ${dot(line)} (2.ª parte)`, p: 1 - homeOver, key: `shtu:home:${line}` },
          { label: `${awayName} mais de ${dot(line)} (2.ª parte)`, p: awayOver, key: `shto:away:${line}` },
          { label: `${awayName} menos de ${dot(line)} (2.ª parte)`, p: 1 - awayOver, key: `shtu:away:${line}` },
        ];
      }),
      },
    ] : []),
    { title: "Totais por equipa", rows: teamRows },
    { title: "Total asiático por equipa", rows: asianTeamRows },
    {
      title: "Ambas marcam",
      rows: [
        { label: "Sim", p: p.bothScore, note: bothDone ? "já marcaram os dois" : undefined, key: "btts:yes" },
        { label: "Não", p: 1 - p.bothScore, key: "btts:no" },
      ],
    },
    {
      title: "Próximo golo",
      rows: [
        { label: `${homeName}`, p: p.nextGoal.home, key: "next:home" },
        { label: `${awayName}`, p: p.nextGoal.away, key: "next:away" },
        { label: "Nenhum até ao fim", p: p.nextGoal.none, key: "next:none" },
      ],
    },
  ];
  // The suggested bet: in the last minutes there is nothing left to suggest.
  const suggestion =
    m >= LAST_MINUTES ? { main: null, others: [] } : suggestLive(cands, { minOdd: Number(minOdd) });
  // The suggestion first, so the odd comparer opens on it.
  const oddMarkets: OddMarket[] = [
    ...(suggestion.main
      ? [{ group: "Aposta sugerida", label: suggestion.main.label, p: suggestion.main.p, key: suggestion.main.key }]
      : []),
    ...groups.flatMap((g) => g.rows.map((r) => ({ group: g.title, label: r.label, p: r.p, key: r.key, push: r.push }))),
  ];
  // The bookmaker's real + opening odds by model key, for the automatic comparison.
  const realByKey: Record<string, number> = {};
  const realOpenByKey: Record<string, number> = {};
  if (realOdds) {
    const byOddsKey: Record<string, number> = {};
    const openByOddsKey: Record<string, number> = {};
    for (const m of realOdds.markets) {
      for (const c of m.choices) {
        byOddsKey[c.key] = c.odd;
        if (c.open !== null && c.open !== undefined) openByOddsKey[c.key] = c.open;
      }
    }
    for (const m of oddMarkets) {
      if (!m.key) continue;
      const oddsKey = oddsKeyFor(m.key, homeName, awayName);
      if (!oddsKey) continue;
      const odd = byOddsKey[oddsKey];
      if (odd !== undefined) realByKey[m.key] = odd;
      const open = openByOddsKey[oddsKey];
      if (open !== undefined) realOpenByKey[m.key] = open;
    }
  }

  const step = (setter: (v: string) => void, current: number, by: number, min: number, max: number) =>
    setter(String(Math.min(max, Math.max(min, current + by))));
  const button =
    "rounded-lg bg-neutral-800 px-3 py-2 text-sm font-semibold text-neutral-200 transition hover:bg-neutral-700";

  const seconds = syncInfo?.kind === "ok" && now ? Math.max(0, Math.round((now.getTime() - syncInfo.at) / 1000)) : null;
  const liveState = syncInfo?.kind === "ok" ? syncInfo.state : null;
  const staleInfo = syncInfo?.kind === "stale" ? syncInfo : null;
  const redCards = liveState ? liveState.reds.home + liveState.reds.away : 0;
  const sourceName = "SofaScore";
  const hasSync = Boolean(sofaEventId);

  return (
    <div className="space-y-4">
      {hasSync && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs">
          <label className="flex cursor-pointer items-center gap-2 text-neutral-300">
            <input type="checkbox" checked={syncOn} onChange={(e) => setSyncOn(e.target.checked)} className="accent-emerald-500" />
            Ler o resultado, o minuto e os cartões do {sourceName}, sozinho (de minuto a minuto)
          </label>
          {syncOn && (
            <p className="mt-1.5 text-neutral-400">
              {syncInfo === null && `A ligar ao ${sourceName}…`}
              {syncInfo?.kind === "notfound" &&
                `Não encontrei este jogo no ${sourceName}: escreve o resultado e o minuto à mão (ou cola o link do jogo).`}
              {syncInfo?.kind === "error" &&
                "Não consegui ler o SofaScore agora (o scraper local pode estar desligado: scraper/npm start): escreve à mão. Volto a tentar daqui a um minuto."}
              {liveState?.phase === "live" && (
                <span className="text-emerald-400">
                  Em direto · {liveState.homeGoals ?? "?"}–{liveState.awayGoals ?? "?"} · {liveState.minute ?? "?"}&apos;
                </span>
              )}
              {liveState?.phase === "halftime" && (
                <span className="text-emerald-400">
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
                <span className="text-emerald-400">
                  Estado que não conheço: &quot;{liveState.raw.statusText || liveState.raw.status}&quot;. Escreve à mão.
                </span>
              )}
              {seconds !== null && <span className="text-neutral-500"> · lido há {seconds}s</span>}
              {syncInfo?.kind === "ok" && syncInfo.ageMs !== null && syncInfo.ageMs > 90_000 && (
                <span className="text-neutral-500"> · dados do {sourceName} de há {Math.round(syncInfo.ageMs / 60_000)} min</span>
              )}
            </p>
          )}
          {syncOn && staleInfo && (
            <p className="mt-1.5 rounded-lg bg-emerald-950 px-3 py-2 text-emerald-300">
              Os dados que o {sourceName} tem deste jogo estão atrasados (de há {Math.round(staleInfo.ageMs / 60_000)} min) e
              dizem &quot;{staleInfo.state.raw.statusText || staleInfo.state.raw.status}&quot;. Ignoro-os: escreve o resultado
              e o minuto à mão, ou tenta de novo daqui a um minuto.
            </p>
          )}
          {syncOn && syncInfo?.kind === "ok" && syncInfo.notes.length > 0 && (
            <p className="mt-1.5 text-[11px] text-emerald-400">{syncInfo.notes.join(" ")}</p>
          )}
          {syncOn && redCards > 0 && liveState && (
            <p className="mt-1.5 rounded-lg bg-emerald-950 px-3 py-2 text-emerald-300">
              Cartões vermelhos: {homeName} {liveState.reds.home}, {awayName} {liveState.reds.away}. O modelo
              conta-os como estimativa (com menos um em campo, a equipa marca ~25% menos do que ainda faltava e
              sofre ~20% mais) — valores por testar, não medidos.
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
              Amarelos: {homeName} {liveState.yellows.home}, {awayName} {liveState.yellows.away}. Estado no {sourceName}:{" "}
              {liveState.raw.statusText || liveState.raw.status || "—"}
              {liveState.raw.liveMinute ? ` · minuto ${liveState.raw.liveMinute}` : ""}.
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-neutral-500">
            Dados de{" "}
            <a href="https://www.sofascore.com" target="_blank" rel="noopener" className="text-emerald-400 hover:underline">
              SofaScore
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
                className="accent-emerald-500"
              />
              Deixar o minuto andar sozinho
            </label>
            {running && (
              <p className="mt-1 text-[11px] leading-snug text-emerald-400/90">
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
            <div className="mt-2 flex items-center justify-center gap-2 text-xs text-neutral-400">
              <span aria-hidden>🟥</span>
              <button type="button" className={button} onClick={() => step(setRedsHome, rH, -1, 0, 5)} aria-label={`Menos um vermelho ${homeName}`}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="5"
                value={syncOn && liveState ? liveState.reds.home : redsHome}
                onChange={(e) => setRedsHome(e.target.value)}
                className={`${INPUT} w-14 text-center`}
                aria-label={`Vermelhos ${homeName}`}
              />
              <button type="button" className={button} onClick={() => step(setRedsHome, rH, 1, 0, 5)} aria-label={`Mais um vermelho ${homeName}`}>
                +
              </button>
              <span className="px-1 text-neutral-500">–</span>
              <button type="button" className={button} onClick={() => step(setRedsAway, rA, -1, 0, 5)} aria-label={`Menos um vermelho ${awayName}`}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="5"
                value={syncOn && liveState ? liveState.reds.away : redsAway}
                onChange={(e) => setRedsAway(e.target.value)}
                className={`${INPUT} w-14 text-center`}
                aria-label={`Vermelhos ${awayName}`}
              />
              <button type="button" className={button} onClick={() => step(setRedsAway, rA, 1, 0, 5)} aria-label={`Mais um vermelho ${awayName}`}>
                +
              </button>
              <span className="text-[11px] text-neutral-500">
                {syncOn && liveState ? "do SofaScore" : "à mão"}
              </span>
            </div>
          </div>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-emerald-400 hover:underline">
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

      <div className="rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-5">
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">O que ainda pode acontecer</h3>
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
            <p className="mt-1 text-xs leading-relaxed">
              <span className="font-bold text-neutral-100">
                Porquê:{" "}
                {livePickWhy(suggestion.main.key, p, {
                  home: homeName,
                  away: awayName,
                  minute: m,
                  homeGoals: h,
                  awayGoals: a,
                  redsHome: rH,
                  redsAway: rA,
                  xg: liveXg ?? undefined,
                  expectedHome,
                  expectedAway,
                })}
              </span>
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
                    <p className="mt-0.5 text-xs leading-relaxed">
                      <span className="font-bold text-neutral-100">
                        Porquê:{" "}
                        {livePickWhy(pick.key, p, {
                          home: homeName,
                          away: awayName,
                          minute: m,
                          homeGoals: h,
                          awayGoals: a,
                          redsHome: rH,
                          redsAway: rA,
                          xg: liveXg ?? undefined,
                          expectedHome,
                          expectedAway,
                        })}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
          É a aposta mais provável com pelo menos essa odd justa, e o número a verde é a odd que a casa teria de pagar para
          valer a pena (a odd justa com a chance cortada, mais margem: 3% no resultado e em ambas marcam, 8% nos golos). Testei este critério <span className="text-neutral-400">ao intervalo</span>{" "}
          em 6.062 jogos de 2025/26: a aposta principal que o modelo dava 60,5% aconteceu em 59,4% (com odd justa mínima de
          1,5); nos golos o modelo é otimista (dizia 58,9% e aconteceu 55,5%), por isso a chance é cortada mais. Sem os
          dados das equipas (valores típicos) o resultado foi praticamente igual (60,1%), porque perto do intervalo quase
          tudo vem do resultado e do tempo que falta. <span className="text-emerald-400">A outros minutos não consigo testar.</span>{" "}
          Acertar muitas vezes não é o mesmo que ganhar dinheiro: compara com a odd da casa aqui em baixo. Na 1.ª
          parte, a fasquia é 1,8 em vez da escolhida em cima, porque essas chances são aproximação por testar.
        </p>
      </div>

      <FinalScoresChart scores={p.finalScores} />

      {sofaEventId && syncOn && snaps.length > 0 && (
        <LiveEvolutionChart
          snaps={snaps}
          homeName={homeName}
          awayName={awayName}
          modelAt={(s) => {
            const q = predictLive({
              lambdaHome: expectedHome,
              lambdaAway: expectedAway,
              firstHalfShare,
              minute: s.minute,
              homeGoals: s.hg,
              awayGoals: s.ag,
              redsHome: s.rh,
              redsAway: s.ra,
              ...(s.xgH !== null && s.xgA !== null ? { homeXg: s.xgH, awayXg: s.xgA } : {}),
            });
            return { mais1: 1 - q.nextGoal.none, over25: q.over["2.5"] ?? null, btts: q.bothScore ?? null };
          }}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Table key={g.title} title={g.title} rows={g.rows} />
        ))}
      </div>

      {scorers && (scorers.home.length > 0 || scorers.away.length > 0) && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="mb-1 text-sm font-semibold text-neutral-300">Marca a qualquer altura</h3>
          <p className="mb-2 text-[11px] text-neutral-500">
            Titulares prováveis (85'), pelo ritmo de golos/xG da época. Sem penáltis designados.
          </p>
          <div className="space-y-1.5 text-sm">
            {[...scorers.home, ...scorers.away]
              .sort((a, b) => b.p - a.p)
              .slice(0, 8)
              .map((s) => (
                <div key={`${s.home ? "h" : "a"}:${s.name}`} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-neutral-200">
                    {s.name}
                    <span className={`ml-1.5 text-[10px] ${s.home ? "text-sky-400" : "text-red-400"}`}>
                      {s.home ? homeName : awayName}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="w-12 text-right font-medium text-emerald-300">{pct(s.p)}</span>
                    <span className="w-14 text-right text-xs text-neutral-500">@{formatOdd(s.fair)}</span>
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {standings && standings.length > 0 && home !== "" && away !== "" && (
        <div>
          <h2 className="mb-1 text-sm font-semibold text-neutral-300">
            Classificação e força{standingsLabel ? ` · ${standingsLabel}` : ""}
          </h2>
          <p className="mb-3 text-xs text-neutral-500">
            Pontos oficiais{standingsSeason ? ` · época ${standingsSeason}` : ""} com ataque e defesa do modelo
            (1,00 = média da liga).
          </p>
          <VenueStandings
            global={standings}
            home={venueStandings?.home ?? []}
            away={venueStandings?.away ?? []}
            highlight={{ home: standingsHome ?? homeName, away: standingsAway ?? awayName }}
          />
        </div>
      )}

      {h2h && h2h.length > 0 && home !== "" && away !== "" && (
        <H2HCard meetings={h2h} home={homeName} away={awayName} />
      )}

      <OddChecker markets={oddMarkets} realByKey={realByKey} realOpenByKey={realOpenByKey} />

      <p className="text-xs leading-relaxed text-neutral-500">
        Parte dos golos que cada equipa devia marcar no jogo todo e tira a parte que já passou, dando mais peso à 2.ª
        parte, onde há mais golos. Conta o resultado (quem está a ganhar marca menos, quem está a perder ou empatado
        marca mais) e que os golos são mais regulares do que o acaso puro. Foi medido em 4.431 jogos e testado ao{" "}
        <span className="text-neutral-400">intervalo</span> em 2.220 jogos de 2025/26 que não usei para o medir: a
        probabilidade de &quot;mais um golo até ao fim&quot; previu 86,2% e aconteceu 86,0%, e em quem ganha e em ambas
        marcam bateu a média histórica. <span className="text-emerald-400">A outros minutos não consigo testar</span>, porque
        os dados não têm o minuto dos golos: aí é uma extrapolação razoável e mais nada. Conta os vermelhos como
        estimativa (menos um em campo ≈ −25% do que ainda marcava, +20% para o outro lado), mas isso é palpite
        meu, não medido. Não sabe de lesões. Quando o jogo está sincronizado, o xG ao vivo ajusta o que falta
        marcar (está no Porquê de cada aposta, heurística por testar); sem ele, é só minuto e resultado.
      </p>
    </div>
  );
}
