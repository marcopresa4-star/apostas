import { createClient } from "@/lib/supabase/server";
import MultipleForm from "./MultipleForm";
import type { ComboCountry } from "./EntityCombobox";
import type { TagItem } from "./CategoryCombobox";
import { fetchUsedEntities } from "@/lib/entityOptions";
import type { BetType } from "@/lib/database.types";

// Loads what the multiple form's search boxes need, the same way the single
// bet pages do: teams and competitions are searched on the server as you type,
// so only the ones already used in your games are loaded as first suggestions.
export default async function MultipleFormLoader({ betType }: { betType: BetType }) {
  const supabase = await createClient();

  const [{ data: countries }, comboCompetitions, comboTeams, { data: categories }] =
    await Promise.all([
      supabase.from("countries").select("id, name").order("name").returns<ComboCountry[]>(),
      fetchUsedEntities(supabase, "competitions"),
      fetchUsedEntities(supabase, "teams"),
      supabase.from("bet_categories").select("id, name").order("name").returns<TagItem[]>(),
    ]);

  return (
    <MultipleForm
      betType={betType}
      initialCompetitions={comboCompetitions}
      initialTeams={comboTeams}
      countries={countries ?? []}
      initialCategories={categories ?? []}
    />
  );
}
