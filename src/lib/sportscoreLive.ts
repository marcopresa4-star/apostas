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
  if (Array.isArray(m.incidents)) {
    for (const item of m.incidents) {
      const i = obj(item);
      if (!i) continue;
      const type = String(i.type ?? "").toLowerCase();
      const side = i.side === "home" ? "home" : i.side === "away" ? "away" : null;
      if (!side) continue;
      if (type.includes("red")) reds[side]++;
      else if (type.includes("yellow")) yellows[side]++;
    }
  }

  return {
    phase,
    minute: phase === "halftime" ? 45 : minute,
    homeGoals: int(m.home_score),
    awayGoals: int(m.away_score),
    reds,
    yellows,
    homeName: String(m.home ?? ""),
    awayName: String(m.away ?? ""),
    raw: { status: String(m.status ?? ""), statusText: String(m.status_text ?? ""), liveMinute: m.live_minute === null || m.live_minute === undefined ? "" : String(m.live_minute) },
  };
}
