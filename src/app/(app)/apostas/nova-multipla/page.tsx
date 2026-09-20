import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import MultipleFormLoader from "@/components/MultipleFormLoader";

export default async function NovaMultiplaPage() {
  await requireAdmin();

  return (
    <div>
      <Link
        href="/apostas"
        className="mb-2 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-300"
      >
        ← Voltar
      </Link>
      <h1 className="mb-1 text-xl font-semibold">Nova múltipla</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Uma só aposta com dois ou mais jogos. Indica a odd de cada um e a odd total é calculada.
      </p>
      <MultipleFormLoader betType="pre_jogo" />
    </div>
  );
}
