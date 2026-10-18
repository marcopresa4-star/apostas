// Session for the local (SQLite) auth: one admin, one password from
// .env.local, a signed cookie. No third-party auth service — the token is
// the expiry timestamp + "." + HMAC_SHA256(payload, AUTH_SECRET), verified
// with Web Crypto subtle so the proxy (edge runtime) verifies it too.
export const SESSION_COOKIE = "ap_sess";
export const SESSION_TTL_MS = 30 * 24 * 3_600_000; // 30 days

const enc = new TextEncoder();

function hex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return [...view].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET não está definido (ou é curto demais) — adiciona-o ao .env.local");
  return secret;
}

export async function makeSessionToken(now = Date.now()): Promise<string> {
  const payload = String(now + SESSION_TTL_MS);
  return `${payload}.${await hmacHex(authSecret(), payload)}`;
}

// False when the token is missing, malformed, or past its expiry — the caller
// treats that exactly like the old "no Supabase user".
export async function verifySessionToken(token: string | undefined | null, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  if (!/^\d+$/.test(payload)) return false;
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp <= now) return false;
  const mac = await hmacHex(authSecret(), payload);
  return mac === token.slice(dot + 1);
}
