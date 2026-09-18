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

// Compact "time until kickoff" label (e.g. "2d 3h", "3h 4m", "45m 12s"), or
// null once the match has started (or already passed).
export function getCountdownLabel(matchDate: string, matchTime: string, now: Date): string | null {
  const kickoff = new Date(`${matchDate}T${matchTime}`);
  if (Number.isNaN(kickoff.getTime())) return null;
  const diffMs = kickoff.getTime() - now.getTime();
  if (diffMs <= 0) return null;

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
