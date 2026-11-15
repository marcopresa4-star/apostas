import { describe, expect, it } from "vitest";
import { pickTournament } from "../tournamentPick";

const c = (name: string, userCount: number) => ({ name, userCount });

describe("pickTournament", () => {
  it("does not let a shared word pick the wrong division", () => {
    // Real case: "Brasil · Série B" was saved on the Série A id because both
    // names contain "série" and the first division is far more followed.
    const pick = pickTournament("Série B", [
      c("Campeonato Brasileiro Série A", 322_108),
      c("Brasileirão Série B", 72_612),
    ]);
    expect(pick?.name).toBe("Brasileirão Série B");
  });

  it("matches numbers and single letters as whole words", () => {
    expect(
      pickTournament("2. Bundesliga", [c("Bundesliga", 500_000), c("2. Bundesliga", 90_000)])?.name
    ).toBe("2. Bundesliga");
    expect(
      pickTournament("League One", [c("USL League One", 2_295), c("League One", 25_613)])?.name
    ).toBe("League One");
  });

  it("falls back to the most followed when no word matches", () => {
    expect(pickTournament("Primeira Liga", [c("Liga Portugal Betclic", 200_000), c("Liga Portugal 2", 20_000)])?.name).toBe(
      "Liga Portugal Betclic"
    );
  });

  it("refuses a competition nobody follows", () => {
    expect(pickTournament("Série B", [c("Brasileirão Série B", 129)])).toBeNull();
    expect(pickTournament("Série B", [])).toBeNull();
  });

  it("prefers the longer name match when the query names it", () => {
    expect(
      pickTournament("Liga Portugal 2", [
        c("Liga Portugal Betclic", 400_000),
        c("Liga Portugal 2", 20_000),
      ])?.name
    ).toBe("Liga Portugal 2");
  });
});
