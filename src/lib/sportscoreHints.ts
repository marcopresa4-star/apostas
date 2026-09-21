import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "./slugify";

export interface Hints {
  home: string | null;
  away: string | null;
}

// What was taught about how Sportscore writes these clubs (the sportscore_teams
// table, by any of their names). If the table is not there yet (migration not
// run) or the lookup fails, nothing was taught.
export async function loadSportscoreHints(
  supabase: SupabaseClient,
  homeNames: string[],
  awayNames: string[]
): Promise<Hints> {
  const none: Hints = { home: null, away: null };
  try {
    const keys = [...new Set([...homeNames, ...awayNames].map(slugify).filter(Boolean))];
    const { data, error } = await supabase
      .from("sportscore_teams")
      .select("name_key, slug")
      .in("name_key", keys)
      .returns<{ name_key: string; slug: string }[]>();
    if (error || !data) return none;
    const bySlug = new Map(data.map((row) => [row.name_key, row.slug]));
    const pick = (names: string[]) => {
      for (const name of names) {
        const slug = bySlug.get(slugify(name));
        if (slug) return slug;
      }
      return null;
    };
    return { home: pick(homeNames), away: pick(awayNames) };
  } catch {
    return none;
  }
}
