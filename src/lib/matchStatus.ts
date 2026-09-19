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
