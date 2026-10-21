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

export async function getIsAdmin(): Promise<boolean> {
  return (await fetchIsAdmin()) ?? false;
}
