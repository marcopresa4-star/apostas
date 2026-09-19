// A typical match (incl. stoppage/extra time) is considered "live" for
// roughly 2h15m after kickoff. There's no real live feed telling us when it
// actually ends, so this is a simple time-window heuristic.
const LIVE_WINDOW_MS = 2.25 * 60 * 60 * 1000;

export function isMatchLive(matchDate: string, matchTime: string, now: Date): boolean {
  const kickoff = new Date(`${matchDate}T${matchTime}`);
  if (Number.isNaN(kickoff.getTime())) return false;
  const diffMs = now.getTime() - kickoff.getTime();
  return diffMs >= 0 && diffMs <= LIVE_WINDOW_MS;
}

// A game is over once it was marked as ended by hand, or once the live window
// after kickoff has passed - the exact moment "Em direto" would switch off.
export function isMatchOver(
  matchDate: string,
  matchTime: string,
  liveEnded: boolean,
  now: Date
): boolean {
  if (liveEnded) return true;
  const kickoff = new Date(`${matchDate}T${matchTime}`);
  if (Number.isNaN(kickoff.getTime())) return false;
  return now.getTime() - kickoff.getTime() > LIVE_WINDOW_MS;
}

// The halftime break adds about this much wall-clock time to any match
// minute after 45, so "minute 60" is roughly 75 minutes after kickoff.
const HALFTIME_MIN = 15;

const pad2 = (n: number) => String(n).padStart(2, "0");

// Rough kickoff of a game you are watching right now at the given match
// minute, as a local date (YYYY-MM-DD) and time (HH:MM).
export function kickoffFromMinute(minute: number, now: Date): { date: string; time: string } {
  const elapsedMin = minute + (minute > 45 ? HALFTIME_MIN : 0);
  const kickoff = new Date(now.getTime() - elapsedMin * 60000);
  return {
    date: `${kickoff.getFullYear()}-${pad2(kickoff.getMonth() + 1)}-${pad2(kickoff.getDate())}`,
    time: `${pad2(kickoff.getHours())}:${pad2(kickoff.getMinutes())}`,
  };
}

// The match minute right now, estimated from the kickoff time (the inverse
// of kickoffFromMinute), or null if the game has not started yet.
export function estimateGameMinute(matchDate: string, matchTime: string, now: Date): number | null {
  const elapsed = getElapsedMinutes(matchDate, matchTime, now);
  if (elapsed === null) return null;
  if (elapsed <= 45) return Math.max(1, elapsed);
  if (elapsed <= 45 + HALFTIME_MIN) return 45;
  return Math.min(elapsed - HALFTIME_MIN, 130);
}

// Minutes elapsed since kickoff, or null if the match hasn't started yet.
export function getElapsedMinutes(matchDate: string, matchTime: string, now: Date): number | null {
  const kickoff = new Date(`${matchDate}T${matchTime}`);
  if (Number.isNaN(kickoff.getTime())) return null;
  const diffMs = now.getTime() - kickoff.getTime();
  if (diffMs < 0) return null;
  return Math.floor(diffMs / 60000);
}

// Digital-clock "time until kickoff" (HH:MM:SS, hours uncapped past 24 for
// matches more than a day out), or null once the match has started (or
// already passed).
export function getCountdownClock(matchDate: string, matchTime: string, now: Date): string | null {
  const kickoff = new Date(`${matchDate}T${matchTime}`);
  if (Number.isNaN(kickoff.getTime())) return null;
  const diffMs = kickoff.getTime() - now.getTime();
  if (diffMs <= 0) return null;

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
