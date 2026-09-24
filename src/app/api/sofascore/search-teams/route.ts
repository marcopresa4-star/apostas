// Team search for the command palette (SofaScore index, most relevant first).
// The palette links each team to its next game.
import { createClient } from "@/lib/supabase/server";
import { searchTeams } from "@/lib/sofaHistory";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ teams: [] });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const teams = await searchTeams(q, 8).catch(() => []);
  return Response.json(
    {
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        national: t.national,
      })),
    },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
