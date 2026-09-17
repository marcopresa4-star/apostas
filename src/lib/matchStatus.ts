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

// Minutes elapsed since kickoff, or null if the match hasn't started yet.
export function getElapsedMinutes(matchDate: string, matchTime: string, now: Date): number | null {
  const kickoff = new Date(`${matchDate}T${matchTime}`);
  if (Number.isNaN(kickoff.getTime())) return null;
  const diffMs = now.getTime() - kickoff.getTime();
  if (diffMs < 0) return null;
  return Math.floor(diffMs / 60000);
}
