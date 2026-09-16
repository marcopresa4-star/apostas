// Next.js redacts messages thrown from Server Actions in production, so
// actions that need to surface a specific error return this instead of
// throwing.
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Erro desconhecido.";
}
