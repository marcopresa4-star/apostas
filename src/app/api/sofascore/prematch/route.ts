// Pre-match expectation for one event (each side's expected goals), used by
// the dashboard widgets. Thin wrapper over the shared helper.
import { createClient } from "@/lib/supabase/server";
import { prematchFor } from "@/lib/sofaPrematch";

export async function GET(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const pre = await prematchFor(supabase, user.id, id);
    return Response.json(pre, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    if (err instanceof Error && err.message === "scraper-offline") {
      return Response.json({ error: "scraper-offline" }, { status: 503 });
    }
    return Response.json({ error: "unparseable" }, { status: 502 });
  }
}
