// SofaScore as the live-status source (replaces SportScore).
//
// SofaScore identifies a match by a numeric event id, not by slugs:
//   https://www.sofascore.com/football/match/arsenal-chelsea/abc/id:12345678
//   https://www.sofascore.com/football/match/#id:12345678
// A bare "12345678" is also accepted wherever an id is asked for.
//
// Why a local scraper service? SofaScore sits behind Cloudflare and answers
// 403 to plain server-side fetch (Vercel or datacenter included — verified
// 2026-09-22 for both api.sofascore.com and www.sofascore.com). The JSON API
// itself is public once the browser has clearance, so a small local service
// built on CloakBrowser (stealth Chromium, Playwright drop-in) opens the page
// once, keeps the clearance in a persistent profile, and calls the same
// endpoints the page calls:
//
//   GET /api/v1/sport/football/event/{id}            -> { event: {...} }
//   GET /api/v1/sport/football/event/{id}/incidents  -> { incidents: [...] }
//   GET /api/v1/sport/football/events/live           -> { events: [...] }
//
// The Next.js app never talks to SofaScore directly: it calls
// /api/sofascore/event?id= and /api/sofascore/live, which proxy to the local
// scraper at SOFASCORE_SCRAPER_URL (default http://127.0.0.1:9323). When the
// scraper is offline the API answers 503 and the UI falls back to manual
// minute/score entry — nothing crashes.
//
// The normalized shape is the same LiveGameState the live calculator already
// uses (see sportscoreLive.ts), so the calculator, the "Ao vivo agora" board
// and the staleness checks keep working unchanged.

import { parseMinute, type LiveGameState, type LivePhase } from "./sportscoreLive";

// Extracts the numeric SofaScore event id from a pasted link or a bare id.
export function parseSofascoreId(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  // Explicit "...id:12345678" (URL path or hash) wins — it is unambiguous.
  const explicit = /(?:^|[^0-9])id:(\d{5,})/i.exec(text);
  if (explicit) return Number.parseInt(explicit[1], 10);
  // Bare id ("12345678").
  if (/^\d{5,}$/.test(text)) return Number.parseInt(text, 10);
  // Last resort: trailing run of digits in a URL path (".../12345678").
  try {
    const path = new URL(text).pathname;
    const tail = /(\d{5,})(?:\/)?$/.exec(path);
    if (tail) return Number.parseInt(tail[1], 10);
  } catch {
    // Not a URL: nothing else to try.
  }
  return null;
}

// Canonical event page for an id (the slug part is optional for SofaScore).
export function sofascoreEventUrl(id: number): string {
  return `https://www.sofascore.com/football/match/#/id:${id}`;
}

type Json = Record<string, unknown>;

const obj = (x: unknown): Json | null =>
  typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Json) : null;

const num = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  return null;
};

const str = (value: unknown): string =>
  typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);

// SofaScore status.type values seen in the wild: notstarted, inprogress,
// finished, canceled, postponed, interrupted. The human description carries
// the half-time detail ("Halftime", "Half time", "Intervalo").
function phaseOf(type: string, description: string): LivePhase {
  const t = type.toLowerCase();
  const d = description.toLowerCase();
  if (/half.?time|intervalo|pausa|break/.test(d) && !/1st|2nd|first|second|1\.|2\./.test(d)) return "halftime";
  if (t === "finished" || /\b(ended|full.?time|after (extra|penalt)|apito final)/.test(d)) return "finished";
  if (t === "inprogress" || /1st|2nd|first half|second half|extra|penalt/.test(d)) return "live";
  if (t === "notstarted" || /not started|ainda n|por come/.test(d)) return "upcoming";
  return "unknown";
}

// Boundary markers ("HT" at 45', "Second half" at 90'...) are not game
// progress: they must not move the minute nor count as the latest incident.
const PROGRESS_TYPES = new Set(["goal", "card", "substitution", "inGamePenalty", "penalty", "var"]);

function progressMinute(item: Json): number | null {
  if (!PROGRESS_TYPES.has(str(item.incidentType).toLowerCase())) return null;
  return num(item.time);
}

// The live minute, best-effort. Three signals, newest wins:
// 1. status.description when it IS a minute ("62'", "45+2'") — never an
//    ordinal ("1st half" is not minute 1, "2nd half" is not minute 2);
// 2. the period clock: now minus currentPeriodStartTimestamp (seconds!),
//    plus the period base from time/statusTime.initial (0, 2700, 5400...);
// 3. the latest real incident (a lower bound — the game cannot be behind its
//    own latest goal). The clock can stall (VAR, injury), so the incident
//    floor matters more than it looks.
function minuteOf(event: Json, incidents: Json[], now: number): number | null {
  const candidates: number[] = [];
  const status = obj(event.status);
  const desc = str(status?.description);
  // Only a tick mark counts: "62'", "45+2'". "1st half"/"2nd half"/"Halftime"
  // carry no minute (parseMinute would read the ordinal: 1st -> 1).
  if (desc.includes("'")) {
    const fromDesc = parseMinute(desc);
    if (fromDesc !== null) candidates.push(fromDesc);
  }

  const time = obj(event.time) ?? obj(event.statusTime);
  const statusTime = obj(event.statusTime);
  const periodStart = num(time?.currentPeriodStartTimestamp) ?? num(statusTime?.timestamp);
  // Period base in seconds: 0 (1st half), 2700 (2nd), 5400 (extra time).
  const initial = num(time?.initial) ?? num(statusTime?.initial);
  if (periodStart !== null && periodStart > 0) {
    const elapsedMin = Math.floor((now / 1000 - periodStart) / 60);
    if (elapsedMin >= 0 && elapsedMin <= 60) {
      const base = initial !== null && initial >= 0 ? Math.floor(initial / 60) : /2nd|second|2\./i.test(desc) ? 45 : 0;
      candidates.push(Math.min(130, base + elapsedMin));
    }
  }

  let latest: number | null = null;
  for (const item of incidents) {
    const at = progressMinute(item);
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  if (latest !== null) candidates.push(latest);

  // Just kicked off ("Started", no period clock yet): the kickoff time is the
  // only signal, and only while it is fresh — a "Started" game whose kickoff
  // was an hour ago has thin data, not minute 60.
  if (candidates.length === 0) {
    const start = num(event.startTimestamp);
    if (start !== null && start > 0 && /started|1st/i.test(desc)) {
      const sinceKickoff = Math.floor((now / 1000 - start) / 60);
      if (sinceKickoff >= 0 && sinceKickoff <= 10) candidates.push(Math.max(1, sinceKickoff));
    }
  }
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function cardsOf(incidents: Json[]): { reds: { home: number; away: number }; yellows: { home: number; away: number }; lastIncident: number | null } {
  const reds = { home: 0, away: 0 };
  const yellows = { home: 0, away: 0 };
  let lastIncident: number | null = null;
  for (const item of incidents) {
    const at = progressMinute(item);
    if (at !== null && (lastIncident === null || at > lastIncident)) lastIncident = at;
    const type = str(item.incidentType).toLowerCase();
    const cls = str(item.incidentClass).toLowerCase();
    if (!/card/.test(type)) continue;
    const side = item.isHome === true ? "home" : item.isHome === false ? "away" : null;
    if (!side) continue;
    if (/red/.test(cls)) {
      // A second yellow shows up as its own class; the sending-off counts as red.
      if (/yellowred|secondyellow|2nd/.test(cls.replace(/\s+/g, ""))) yellows[side]++;
      reds[side]++;
    } else if (/yellow/.test(cls)) {
      yellows[side]++;
    }
  }
  return { reds, yellows, lastIncident };
}

// Normalizes one SofaScore event (+ its incidents) to the shared live state.
// `payload` is the parsed body of GET /event/{id} (either the whole body or
// its inner `event`), `incidentsBody` the parsed body of /incidents.
// `fetchedAt` is when the body was read: that is what updatedAt carries, so
// the staleness check judges the age of the reading, not of the last goal —
// quiet 10-minute spells without goals or cards are normal and must not read
// as "stale". A frozen event (status stuck after the whistle) is flagged
// separately by the caller via lastSofascoreChange below.
export function parseSofascoreEvent(
  payload: unknown,
  incidentsBody: unknown,
  now = Date.now(),
  fetchedAt = now
): LiveGameState | null {
  const root = obj(payload);
  const event = obj(root?.event) ?? root;
  if (!event) return null;
  const status = obj(event.status);
  if (!status) return null;
  const type = str(status.type);
  const description = str(status.description);
  const code = str(status.code ?? "");
  if (!type && !description) return null;

  const phase = phaseOf(type, description);
  const incidents = Array.isArray(obj(incidentsBody)?.incidents)
    ? (obj(incidentsBody)!.incidents as unknown[]).map(obj).filter((i): i is Json => i !== null)
    : [];
  const minute = phase === "halftime" ? 45 : minuteOf(event, incidents, now);
  const { reds, yellows, lastIncident } = cardsOf(incidents);

  const homeScore = obj(event.homeScore);
  const awayScore = obj(event.awayScore);
  const homeGoals = num(homeScore?.current) ?? num(homeScore?.display);
  const awayGoals = num(awayScore?.current) ?? num(awayScore?.display);

  // Some finished events carry the sending-offs as fields instead of incidents.
  const fieldReds = {
    home: num(event.homeRedCards) ?? 0,
    away: num(event.awayRedCards) ?? 0,
  };
  const mergedReds = {
    home: Math.max(reds.home, fieldReds.home),
    away: Math.max(reds.away, fieldReds.away),
  };

  // The reading's own age is what staleness judges (see parseSofascoreEvent):
  // the caller flags frozen events separately via lastSofascoreChange.
  const updatedAt = fetchedAt;

  return {
    phase,
    minute,
    homeGoals,
    awayGoals,
    reds: mergedReds,
    yellows,
    homeName: str(obj(event.homeTeam)?.name),
    awayName: str(obj(event.awayTeam)?.name),
    updatedAt,
    lastIncident,
    // Match statistics live in a separate endpoint (/statistics) and are not
    // needed for the status — the calculator ignores them anyway.
    stats: [],
    raw: { status: code || type, statusText: description, liveMinute: description },
  };
}

// When SofaScore itself last recorded anything for this event (ms), or null.
// The caller uses it to flag a frozen event (status stuck on "2nd half" long
// after the whistle) without crying "stale" during normal quiet spells, where
// ten goalless minutes are business as usual.
export function lastSofascoreChange(payload: unknown): number | null {
  const root = obj(payload);
  const event = obj(root?.event) ?? root;
  const stamp = num(obj(event?.changes)?.changeTimestamp);
  return stamp !== null && stamp > 0 ? stamp * 1000 : null;
}

export interface SofaLiveEntry {  id: number;
  competition: string;
  home: string;
  away: string;
  kickoff: string; // ISO
  statusType: string;
  statusDescription: string;
  phase: LivePhase;
  minute: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
}

// One row of GET /sport/football/events/live ({ events: [...] }). The list rows
// already carry the current score; the minute is best-effort (description,
// then latest goal minute). Rows that are not genuinely in progress are kept
// with their phase so the caller can filter.
export function parseSofascoreLiveList(payload: unknown, now = Date.now()): SofaLiveEntry[] {
  const events = obj(payload)?.events;
  if (!Array.isArray(events)) return [];
  const out: SofaLiveEntry[] = [];
  for (const item of events) {
    const e = obj(item);
    if (!e) continue;
    const id = num(e.id);
    const home = str(obj(e.homeTeam)?.name);
    const away = str(obj(e.awayTeam)?.name);
    const start = num(e.startTimestamp);
    if (id === null || !home || !away || start === null) continue;
    const statusType = str(obj(e.status)?.type);
    const statusDescription = str(obj(e.status)?.description);
    const phase = phaseOf(statusType, statusDescription);
    const tournament = obj(e.tournament);
    const category = obj(tournament?.category);
    const competition = str(tournament?.name) || str(category?.name);
    const homeGoals = num(obj(e.homeScore)?.current) ?? num(obj(e.homeScore)?.display);
    const awayGoals = num(obj(e.awayScore)?.current) ?? num(obj(e.awayScore)?.display);
    const minute =
      phase === "halftime" ? 45 : minuteOf(e, [], now) ?? null;
    out.push({
      id,
      competition,
      home,
      away,
      kickoff: new Date(start * 1000).toISOString(),
      statusType,
      statusDescription,
      phase,
      minute,
      homeGoals,
      awayGoals,
    });
  }
  return out;
}
