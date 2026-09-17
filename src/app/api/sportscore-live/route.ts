import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchSportscoreLiveData } from "@/lib/sportscore";
import { slugify } from "@/lib/slugify";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const home = request.nextUrl.searchParams.get("home");
  const away = request.nextUrl.searchParams.get("away");
  if (!home || !away) {
    return NextResponse.json({ error: "Faltam os parâmetros home/away." }, { status: 400 });
  }

  // Temporary diagnostic mode — remove once the production 403/blank-data
  // issue is understood. Not linked from anywhere in the UI.
  if (request.nextUrl.searchParams.get("debug") === "1") {
    const slug = `${slugify(home)}-vs-${slugify(away)}`;
    try {
      const upstream = await fetch(`https://sportscore.com/embed/match/football/${slug}/`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const html = await upstream.text();
      return NextResponse.json({
        slug,
        status: upstream.status,
        ok: upstream.ok,
        htmlLength: html.length,
        hasScoreDiv: html.includes('class="score"'),
        hasIsLive1: html.includes('data-is-live="1"'),
        snippet: html.slice(0, 800),
      });
    } catch (err) {
      return NextResponse.json({
        slug,
        fetchError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const data = await fetchSportscoreLiveData(home, away);
  return NextResponse.json({ data });
}
