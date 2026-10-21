// Instant shell while the Bots page renders (first dev compile or slow reads).
export default function Loading() {
  return (
    <div data-wide>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">🤖 <span className="title-glow">Bots</span></h1>
      <p className="mb-4 max-w-4xl animate-pulse text-sm text-neutral-500">A carregar os bots…</p>
      <div className="animate-pulse space-y-4">
        <div className="h-12 glass" />
        <div className="h-48 glass" />
        <div className="h-32 glass" />
      </div>
    </div>
  );
}
