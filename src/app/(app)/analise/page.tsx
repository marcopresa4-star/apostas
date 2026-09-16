import AnaliseForm from "@/components/AnaliseForm";

export default function AnalisePage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Análise de jogo</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Procura a competição e as duas equipas para veres forma recente, confronto direto e
        classificação, com dados da{" "}
        <a
          href="https://www.api-football.com/"
          target="_blank"
          rel="noreferrer"
          className="text-emerald-400 hover:underline"
        >
          API-Football
        </a>
        .
      </p>
      <AnaliseForm />
    </div>
  );
}
