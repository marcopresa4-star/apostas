import { describe, expect, it } from "vitest";
import {
  diaMes,
  diaMesAno,
  extractDate,
  fair2,
  hasSideMarker,
  matchLeague,
  matchNav,
  mightNameTeam,
  nextWeekday,
  normalizeQuery,
  parsePergunta,
  pct1,
  sameTeam,
  shiftDate,
  teamKey,
  teamMention,
  teamQueryWords,
} from "../assistente";

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
    expect(parsePergunta("resultados de ontem", "2026-10-15")).toEqual({ kind: "ontem" });
    expect(parsePergunta("jogos do dia 21/10", "2026-10-15")).toEqual({ kind: "data", date: "2026-10-21" });
    expect(parsePergunta("dia 21", "2026-10-15")).toEqual({ kind: "data", date: "2026-10-15".slice(0, 8) + "21" });
    expect(parsePergunta("depois de amanhã", "2026-10-15")).toEqual({ kind: "data", date: "2026-10-17" });
  });

  it("detects weekdays and the next seven days", () => {
    // 2026-11-14 is a Saturday.
    expect(parsePergunta("jogos de sábado", "2026-11-14")).toEqual({ kind: "data", date: "2026-11-14" });
    expect(parsePergunta("segunda-feira", "2026-11-14")).toEqual({ kind: "data", date: "2026-11-16" });
    expect(parsePergunta("esta semana", "2026-11-14")).toEqual({ kind: "semana" });
    expect(parsePergunta("próximos jogos", "2026-11-14")).toEqual({ kind: "semana" });
  });

  it("detects results, table, round and help intents", () => {
    expect(parsePergunta("resultados do Benfica", "2026-10-15")).toEqual({ kind: "resultados" });
    expect(parsePergunta("últimos jogos do Porto", "2026-10-15")).toEqual({ kind: "resultados" });
    expect(parsePergunta("classificação da Primeira Liga", "2026-10-15")).toEqual({ kind: "classificacao" });
    expect(parsePergunta("em que lugar está o Benfica?", "2026-10-15")).toEqual({ kind: "classificacao" });
    expect(parsePergunta("jornada da Primeira Liga", "2026-10-15")).toEqual({ kind: "jornada" });
    expect(parsePergunta("ajuda", "2026-10-15")).toEqual({ kind: "ajuda" });
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

  it("rolls dates forward instead of showing last spring", () => {
    expect(extractDate("21/01", "2026-11-14")).toBe("2027-01-21");
    expect(extractDate("21/12", "2026-11-14")).toBe("2026-12-21");
    expect(extractDate("dia 3", "2026-11-14")).toBe("2026-12-03");
    expect(extractDate("dia 3/2/2027", "2026-11-14")).toBe("2027-02-03");
  });

  it("shifts calendar days and finds weekdays", () => {
    expect(shiftDate("2026-11-14", 1)).toBe("2026-11-15");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(nextWeekday("quarta", "2026-11-14")).toBe("2026-11-18");
    expect(nextWeekday("sábado", "2026-11-14")).toBe("2026-11-14");
  });

  it("matches league names people type", () => {
    expect(matchLeague("liga portuguesa")).toBe("pt.1");
    expect(matchLeague("segunda liga")).toBe("pt.2");
    expect(matchLeague("champions league")).toBe("eu.1");
    expect(matchLeague("premier league")).toBe("en.1");
    expect(matchLeague("jogos de hoje")).toBeNull();
  });

  it("identifies clubs through their decorations", () => {
    expect(teamKey("SL Benfica")).toBe("benfica");
    expect(teamKey("FC Porto")).toBe("porto");
    expect(teamKey("Sp. Braga")).toBe("braga");
    expect(teamMention("quando joga o benfica", "SL Benfica")).toBe(true);
    expect(teamMention("jogos de hoje", "SL Benfica")).toBe(false);
    expect(sameTeam("Benfica", "SL Benfica")).toBe(true);
    expect(sameTeam("Benfica", "SL Benfica B")).toBe(false);
    expect(hasSideMarker("SL Benfica B")).toBe(true);
    expect(hasSideMarker("Benfica")).toBe(false);
    expect(sameTeam("Real Madrid", "Real Sociedad")).toBe(false);
  });

  it("only asks for the team index when a team may be named", () => {
    expect(teamQueryWords("jogos de hoje?")).toEqual([]);
    expect(teamQueryWords("o que está em direto?")).toEqual([]);
    expect(teamQueryWords("quando joga o benfica?")).toEqual(["benfica"]);
    expect(mightNameTeam("jogos de hoje?")).toBe(false);
    expect(mightNameTeam("quando joga o benfica?")).toBe(true);
  });

  it("formats like the matrix", () => {
    expect(pct1(0.664)).toBe("66,4%");
    expect(fair2(0.664)).toBe("1,51");
    expect(diaMes("2026-10-21")).toBe("21/10");
    expect(diaMesAno("2026-10-21")).toBe("21/10/2026");
  });

  it("matches navigation pages", () => {
    expect(matchNav("onde ficam as multiplas")).toEqual({ label: "Múltiplas", href: "/multiplas" });
    expect(matchNav("benfica vs porto")).toBeNull();
  });
});
