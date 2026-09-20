import Link from "next/link";
import { requireAdmin } from "@/lib/requireAdmin";
import MultipleFormLoader from "@/components/MultipleFormLoader";

export default async function NovaMultiplaLivePage() {
  await requireAdmin();

  return (
    <div>
      <Link
        href="/live"
        className="mb-2 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-300"
      >
        ← Voltar
      </Link>
      <h1 className="mb-1 text-xl font-semibold">Nova múltipla live</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Regista uma múltipla em que já entraste: para cada jogo indica a odd e o minuto em que
        entraste. A odd total é calculada.
      </p>
      <MultipleFormLoader betType="live" />
    </div>
  );
}
