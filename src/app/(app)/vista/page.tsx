import { requireAdmin } from "@/lib/requireAdmin";
import VistaClient from "@/components/VistaClient";

export default async function VistaPage() {
  await requireAdmin();
  return (
    <div data-wide>
      <h1 className="hero-title mb-3">◧ <span className="title-glow">Vista Dinâmica</span><span className="hero-underline" /></h1>
      <p className="mb-4 max-w-4xl text-sm text-neutral-500">
        Ecrã dividido em duas partes: escolhe o que vai em cada lado. Os painéis são as próprias páginas, em direto;
        a vigilância (bots e direto) corre só no separador de cima para não duplicar leituras.
      </p>
      <VistaClient />
    </div>
  );
}
