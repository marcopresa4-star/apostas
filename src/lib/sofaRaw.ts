// Server-only reads of SofaScore's JSON API through the local CloakBrowser
// scraper (phase 1 of "SofaScore only": history for the model tabs). The app
// never calls SofaScore directly (Cloudflare 403s datacenter fetch); the
// scraper calls the same endpoints the SofaScore page calls, with clearance.
// Scraper offline -> throws ScraperOffline. Import from server code only:
// it uses a non-public env var and must never ship to the browser.
import "server-only";

const SCRAPER = process.env.SOFASCORE_SCRAPER_URL ?? "http://127.0.0.1:9323";

export class ScraperOffline extends Error {
  constructor() {
    super("Scraper SofaScore desligado (scraper/npm start).");
  }
}

function encodeQuery(params: Record<string, string>): string {
  const q = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return q ? `?${q}` : "";
}

// GET /api/v1{path} through the scraper's /raw passthrough (local dev only).
// Returns null on 404 (unknown id, round past the end...), throws
// ScraperOffline when the scraper cannot be reached.
export async function sofaRaw<T = unknown>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  let raw: Response;
  try {
    raw = await fetch(`${SCRAPER}/raw?path=${encodeURIComponent(path)}${encodeQuery(params).replace(/^\?/, "&")}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ScraperOffline();
  }
  if (raw.status === 404) return null;
  if (!raw.ok) throw new Error(`SofaScore raw ${path} falhou (${raw.status}).`);
  return (await raw.json()) as T;
}
