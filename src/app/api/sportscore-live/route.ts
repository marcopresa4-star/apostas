import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchSportscoreLiveData } from "@/lib/sportscore";

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

  const data = await fetchSportscoreLiveData(home, away);
  return NextResponse.json({ data });
}
