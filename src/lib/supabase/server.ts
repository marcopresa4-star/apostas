// Local replacement for the Supabase SSR client: same createClient() call
// sites, now backed by the SQLite shim (dbShim) + cookie session (session.ts).
// No cloud dependency: queries run against data/app.db, auth is one admin
// password from .env.local.
import { createDbClient } from "@/lib/dbShim";

export async function createClient() {
  return createDbClient();
}
