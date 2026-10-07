// What the free SportScore API says about a game (sportscore.com/api/widget/match/):
// the score, the minute of a game in progress, and its incidents (goals, cards,
// substitutions) with their minute. Read with care: what a live game looks like
// was not seen when this was written (only finished games were), so unknown
// values are reported as they came instead of being guessed.

export type LivePhase = "upcoming" | "live" | "halftime" | "finished" | "unknown";

export interface LiveGameState {
  phase: LivePhase;
  minute: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  reds: { home: number; away: number };
  yellows: { home: number; away: number };
  homeName: string;
  awayName: string;
  // When the data of this game was last refreshed (ms), if the API says.
  updatedAt: number | null;
  // The minute of the latest incident (goal, card, substitution): the game is at
  // least that far on.
  lastIncident: number | null;
  // Statistics of a game in progress (possession, shots...), as the API sends them.
  stats: { label: string; home: number; away: number; suffix: string }[];
  // As the API sent them, to show when something looks wrong.
  raw: { status: string; statusText: string; liveMinute: string };
}

const int = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\s*\d+\s*$/.test(value)) return Number.parseInt(value, 10);
  return null;
};

// 67, "67", "67'", "45+2" (stoppage adds up), or nothing.
export function parseMinute(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.min(130, Math.trunc(value))) : null;
  if (typeof value !== "string") return null;
  const m = /(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/.exec(value);
  if (!m) return null;
  return Math.min(130, Number(m[1]) + (m[2] ? Number(m[2]) : 0));
}

const obj = (x: unknown): Record<string, unknown> | null => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

export function parseLiveMatch(json: unknown): LiveGameState | null {
  const m = obj(obj(json)?.match);
  if (!m) return null;
  const status = String(m.status ?? "").toLowerCase();
  const text = String(m.status_text ?? "").toLowerCase();
  const minute = parseMinute(m.live_minute);

  let phase: LivePhase = "unknown";
  if (status === "finished" || /\b(finished|ended|full.?time|after (extra|penalt))/.test(text)) phase = "finished";
  else if (/half.?time|\bht\b|\bbreak\b/.test(text) && !/1st|2nd|first|second/.test(text)) phase = "halftime";
  else if (minute !== null || /^(live|inplay|in_play|playing|inprogress|in_progress|started)$/.test(status) || /1st|2nd|first half|second half|extra|penalt/.test(text)) phase = "live";
  else if (status === "upcoming" || status === "scheduled" || status === "notstarted") phase = /interrupt|suspend|abandon/.test(text) ? "unknown" : "upcoming";

  const reds = { home: 0, away: 0 };
  const yellows = { home: 0, away: 0 };
  let lastIncident: number | null = null;
  if (Array.isArray(m.incidents)) {
    for (const item of m.incidents) {
      const i = obj(item);
      if (!i) continue;
      const at = int(i.time);
      if (at !== null && (lastIncident === null || at > lastIncident)) lastIncident = at;
      const type = String(i.type ?? "").toLowerCase();
      const side = i.side === "home" ? "home" : i.side === "away" ? "away" : null;
      if (!side) continue;
      if (type.includes("red")) reds[side]++;
      else if (type.includes("yellow")) yellows[side]++;
    }
  }

  const stats: LiveGameState["stats"] = [];
  if (Array.isArray(m.stats)) {
    for (const item of m.stats) {
      const s = obj(item);
      const home = typeof s?.home === "number" ? s.home : null;
      const away = typeof s?.away === "number" ? s.away : null;
      if (s && typeof s.label === "string" && home !== null && away !== null) {
        stats.push({ label: s.label, home, away, suffix: typeof s.suffix === "string" ? s.suffix : "" });
      }
    }
  }
  const stamp = typeof obj(json)?.updated === "string" ? Date.parse(String(obj(json)?.updated)) : NaN;
  const recorded = typeof m.updated === "string" ? Date.parse(m.updated) : NaN;
  const updatedAt = Number.isFinite(stamp) ? stamp : Number.isFinite(recorded) ? recorded : null;

  return {
    phase,
    minute: phase === "halftime" ? 45 : minute,
    updatedAt,
    lastIncident,
    stats,
    homeGoals: int(m.home_score),
    awayGoals: int(m.away_score),
    reds,
    yellows,
    homeName: String(m.home ?? ""),
    awayName: String(m.away ?? ""),
    raw: { status: String(m.status ?? ""), statusText: String(m.status_text ?? ""), liveMinute: m.live_minute === null || m.live_minute === undefined ? "" : String(m.live_minute) },
  };
}

// Data refreshed longer ago than this is not trusted for a game in progress.
export const STALE_MS = 4 * 60_000;

export interface Checked {
  state: LiveGameState;
  // Too old to use: a game in progress does not go four minutes without news.
  stale: boolean;
  // How old the data is (ms), if known.
  ageMs: number | null;
  // What was corrected, in words.
  notes: string[];
}

// Reads the state against itself: a game said to be at half time with a
// substitution at 61' is not at half time, and a minute behind the latest
// incident is a minute behind. Only says what it changed.
export function checkLive(state: LiveGameState, now: number): Checked {
  const notes: string[] = [];
  let next = state;
  const ageMs = state.updatedAt === null ? null : Math.max(0, now - state.updatedAt);
  const inPlay = state.phase === "live" || state.phase === "halftime";
  const stale = inPlay && ageMs !== null && ageMs > STALE_MS;

  if (state.phase === "halftime" && state.lastIncident !== null && state.lastIncident > 46) {
    next = { ...next, phase: "live", minute: state.lastIncident };
    notes.push(`Diz intervalo, mas há um incidente ao minuto ${state.lastIncident}: o jogo já vai pelo menos aí.`);
  } else if (state.phase === "live" && state.minute !== null && state.lastIncident !== null && state.lastIncident > state.minute + 1) {
    next = { ...next, minute: state.lastIncident };
    notes.push(`O minuto estava atrás do último incidente (${state.lastIncident}'): usei o do incidente.`);
  }
  return { state: next, stale, ageMs, notes };
}
