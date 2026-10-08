import { requireAdmin } from "@/lib/requireAdmin";
import { LEAGUES } from "@/lib/footballData";
import { createClient } from "@/lib/supabase/server";
import { loadMaps } from "@/lib/sofaHistory";
import MultiplasClient from "@/components/MultiplasClient";

export default async function MultiplasPage() {
  await requireAdmin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const maps = user ? await loadMaps(supabase, user.id, "tournament").catch(() => []) : [];
  const mapped = new Set(maps.map((m) => m.name_key));
  const leagues = LEAGUES.filter((l) => mapped.has(l.code) && !l.code.startsWith("int.")).map((l) => ({
    code: l.code,
    label: l.label,
  }));
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div data-wide>
      <h1 className="mb-1 text-xl font-semibold">🎲 Múltiplas</h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Gerador de acumuladas para as tuas ligas mapeadas: escolhe dias, ligas, tipos de aposta com intervalo de odd
        e quantidade de jogos. Só entram pernas com odd real da casa, escolhidas por valor (modelo vs casa), uma por
        jogo. A geração lê uma odd por jogo e pode demorar minutos à primeira.
      </p>
      <MultiplasClient leagues={leagues} today={today} />
    </div>
  );
}
