export type BetStatus = "pending" | "green" | "red" | "void";
export type BetType = "pre_jogo" | "live";
// Live pick lifecycle: watching (idea) -> active (entered) | skipped (never
// entered). Pre-game picks are always "active".
export type PickStage = "watching" | "active" | "skipped";
