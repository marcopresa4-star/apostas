import type { ComboItem } from "@/components/EntityCombobox";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;
export type EntityTable = "teams" | "competitions";

interface EntityRow {
  id: string;
  name: string;
  aliases?: string | null;
  country: { name: string } | null;
}

function toItem(row: EntityRow): ComboItem {
  return {
    id: row.id,
    name: row.name,
    countryName: row.country?.name ?? "",
    aliases: row.aliases ?? null,
  };
}

// Only teams have other names; competitions have no aliases column.
const columnsFor = (table: EntityTable) =>
  table === "teams" ? "id, name, aliases, country:countries(name)" : "id, name, country:countries(name)";

// The teams / competitions already used in your games, most recent first.
// This is what a search box offers before you type anything: the base holds
// thousands of teams, so listing them all (Supabase returns at most 1000
// rows anyway) is neither useful nor complete.
export async function fetchUsedEntities(client: Client, table: EntityTable): Promise<ComboItem[]> {
  const { data: tickets } = await client
    .from("tickets")
    .select("competition_id, home_team_id, away_team_id")
    .order("match_date", { ascending: false })
    .limit(300);

  const ids: string[] = [];
  for (const ticket of tickets ?? []) {
    const wanted = table === "teams" ? [ticket.home_team_id, ticket.away_team_id] : [ticket.competition_id];
    for (const id of wanted) if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= 100) break;
  }
  if (ids.length === 0) return [];

  const { data } = await client
    .from(table)
    .select(columnsFor(table))
    .in("id", ids)
    .order("name")
    .returns<EntityRow[]>();
  return (data ?? []).map(toItem);
}

// Search by name, every word has to be in it ("brighton hove" finds
// "Brighton & Hove Albion"); names that START with the first word come first.
// Teams are also found by their other names ("HJK Helsinki", "Man United"),
// kept in teams.aliases.
export async function searchEntityRows(
  client: Client,
  table: EntityTable,
  query: string
): Promise<ComboItem[]> {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[%_\\,()*"]/g, ""))
    .filter(Boolean)
    .slice(0, 4);
  if (terms.length === 0) return [];

  const build = (mode: "starts" | "contains") => {
    let q = client.from(table).select(columnsFor(table));
    terms.forEach((term, i) => {
      const pattern = i === 0 && mode === "starts" ? `${term}%` : `%${term}%`;
      q =
        table === "teams"
          ? q.or(`name.ilike.${pattern},aliases.ilike.${pattern}`)
          : q.ilike("name", pattern);
    });
    return q.order("name").limit(30).returns<EntityRow[]>();
  };

  const [starts, contains] = await Promise.all([build("starts"), build("contains")]);

  const seen = new Set<string>();
  const out: ComboItem[] = [];
  for (const row of [...(starts.data ?? []), ...(contains.data ?? [])]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(toItem(row));
    if (out.length >= 30) break;
  }
  return out;
}
