import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// One admin behind a signed cookie (local SQLite replaced Supabase auth).
// Kept as requireAdmin()/getIsAdmin() so the call sites stay unchanged.

async function sessionOk(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}
// Guards every admin-only page (Dashboard, Apostas, Live, Analise and their
// sub-pages). Without a Comunidade there is nowhere else to send a regular
// (non-admin) user, so they land on the login page.
export async function requireAdmin() {
  if (!(await sessionOk())) redirect("/login");
}

export async function getIsAdmin(): Promise<boolean> {
  return sessionOk();
}
