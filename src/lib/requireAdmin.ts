import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// PostgREST's "no rows found" code from .single() - means the profiles
// table exists and this user genuinely has no row (i.e. not an admin).
// Any OTHER error (e.g. the profiles table/migration not applied yet)
// must not lock everyone - including the real admin - out of the app.
const NO_ROWS_CODE = "PGRST116";

async function fetchIsAdmin(): Promise<boolean | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error && error.code !== NO_ROWS_CODE) return true; // fail open on infra errors
  return profile?.role === "admin";
}

// Guards every admin-only page (Dashboard, Apostas, Live, Analise and their
// sub-pages). Without a Comunidade there is nowhere else to send a regular
// (non-admin) user, so they land on the login page.
export async function requireAdmin() {
  const isAdmin = await fetchIsAdmin();
  if (isAdmin === null) redirect("/login");
  if (!isAdmin) redirect("/login");
}

// Same guard, but returns the user so the page doesn't call
// supabase.auth.getUser() a second time on an already-guarded render.
export async function requireAdminWithUser(): Promise<{ id: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  // Same fail-open rule as fetchIsAdmin: infra errors must never lock the
  // admin out (only a real "not admin" row does).
  const isAdmin = (error && error.code !== NO_ROWS_CODE) || profile?.role === "admin";
  if (!isAdmin) redirect("/login");
  return { id: user.id };
}

export async function getIsAdmin(): Promise<boolean> {
  return (await fetchIsAdmin()) ?? false;
}
