import { describe, expect, it } from "vitest";
import { diaMes, extractDate, fair2, matchNav, normalizeQuery, parsePergunta, pct1 } from "../assistente";

describe("assistente", () => {
  it("normalizes diacritics and spaces", () => {
    expect(normalizeQuery("  Sp.  BRAGA ")).toBe("sp. braga");
    expect(normalizeQuery("Amanhã?")).toBe("amanha?");
  });

  it("detects live intent", () => {
    expect(parsePergunta("o que está em direto?", "2026-10-15")).toEqual({ kind: "live" });
    expect(parsePergunta("quem está a jogar agora", "2026-10-15")).toEqual({ kind: "live" });
    expect(parsePergunta("ao vivo agora?", "2026-10-15")).toEqual({ kind: "live" });
  });

  it("detects day intents", () => {
    expect(parsePergunta("jogos de hoje?", "2026-10-15")).toEqual({ kind: "hoje" });
    expect(parsePergunta("e amanhã?", "2026-10-15")).toEqual({ kind: "amanha" });
    expect(parsePergunta("jogos do dia 21/10", "2026-10-15")).toEqual({ kind: "data", date: "2026-10-21" });
    expect(parsePergunta("dia 21", "2026-10-15")).toEqual({ kind: "data", date: "2026-10-15".slice(0, 8) + "21" });
  });

  it("detects bots intent", () => {
    expect(parsePergunta("como estão os meus bots?", "2026-10-15")).toEqual({ kind: "bots" });
  });

  it("falls back to raw text for teams and pages", () => {
    expect(parsePergunta("Benfica vs Porto", "2026-10-15")).toEqual({ kind: "texto", texto: "Benfica vs Porto" });
    expect(parsePergunta("quando joga o Benfica?", "2026-10-15")).toEqual({
      kind: "texto",
      texto: "quando joga o Benfica?",
    });
  });

  it("extractDate rejects nonsense months", () => {
    expect(extractDate("dia 99/99", "2026-10-15")).toBeNull();
  });

  it("formats like the matrix", () => {
    expect(pct1(0.664)).toBe("66,4%");
    expect(fair2(0.664)).toBe("1,51");
    expect(diaMes("2026-10-21")).toBe("21/10");
  });

  it("matches navigation pages", () => {
    expect(matchNav("onde ficam as multiplas")).toEqual({ label: "Múltiplas", href: "/multiplas" });
    expect(matchNav("benfica vs porto")).toBeNull();
  });
});
