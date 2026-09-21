import type { PlayedMatch } from "./footballModel";

// What the meetings between two teams say, split by who was at home: the game
// coming up is `home` at home, so the meetings played that way are the closest
// to it, and the ones with the sides swapped say something too.

export interface VenueSplit {
  games: number;
  hostWins: number; // the team that was at home in those games
  draws: number;
  guestWins: number;
  hostGoals: number; // averages per game
  guestGoals: number;
  over25: number; // shares, 0 to 1
  btts: number;
}

export interface H2HPattern {
  total: number;
  // Games with `home` at home (the same way round as the game coming up), and
  // games with `away` at home.
  homeAtHome: VenueSplit | null;
  awayAtHome: VenueSplit | null;
  goalsPerGame: number;
  over25: number;
  btts: number;
  draws: number; // share
  // The last meetings, as results for `home` ("V" won, "E" drew, "D" lost, score
  // with its goals first), most recent first.
  recent: { date: string; homeWasHost: boolean; result: "V" | "E" | "D"; score: string }[];
  // Sentences about what stands out, only for what has enough games behind it.
  notes: string[];
}

const RECENT = 6;
// Fewer games than this and a "pattern" is just chance.
const MIN_FOR_NOTE = 3;

function split(meetings: PlayedMatch[], host: string, guest: string): VenueSplit | null {
  const games = meetings.filter((m) => m.team1 === host && m.team2 === guest);
  const n = games.length;
  if (n === 0) return null;
  const count = (test: (m: PlayedMatch) => boolean) => games.filter(test).length;
  return {
    games: n,
    hostWins: count((m) => m.ft[0] > m.ft[1]),
    draws: count((m) => m.ft[0] === m.ft[1]),
    guestWins: count((m) => m.ft[0] < m.ft[1]),
    hostGoals: games.reduce((s, m) => s + m.ft[0], 0) / n,
    guestGoals: games.reduce((s, m) => s + m.ft[1], 0) / n,
    over25: count((m) => m.ft[0] + m.ft[1] > 2) / n,
    btts: count((m) => m.ft[0] > 0 && m.ft[1] > 0) / n,
  };
}

const one = (x: number) => x.toFixed(1).replace(".", ",");
const times = (n: number) => (n === 1 ? "1 vez" : `${n} vezes`);

// `meetings` most recent first.
export function h2hPattern(meetings: PlayedMatch[], home: string, away: string): H2HPattern {
  const total = meetings.length;
  const homeAtHome = split(meetings, home, away);
  const awayAtHome = split(meetings, away, home);

  const resultFor = (m: PlayedMatch, team: string): "V" | "E" | "D" => {
    const mine = m.team1 === team ? m.ft[0] : m.ft[1];
    const theirs = m.team1 === team ? m.ft[1] : m.ft[0];
    return mine > theirs ? "V" : mine === theirs ? "E" : "D";
  };
  const recent = meetings.slice(0, RECENT).map((m) => ({
    date: m.date,
    homeWasHost: m.team1 === home,
    result: resultFor(m, home),
    // Goals of `home` first, wherever it played.
    score: m.team1 === home ? `${m.ft[0]}–${m.ft[1]}` : `${m.ft[1]}–${m.ft[0]}`,
  }));

  const count = (test: (m: PlayedMatch) => boolean) => meetings.filter(test).length;
  const over25 = total ? count((m) => m.ft[0] + m.ft[1] > 2) / total : 0;
  const btts = total ? count((m) => m.ft[0] > 0 && m.ft[1] > 0) / total : 0;
  const draws = total ? count((m) => m.ft[0] === m.ft[1]) / total : 0;
  const goalsPerGame = total ? meetings.reduce((s, m) => s + m.ft[0] + m.ft[1], 0) / total : 0;

  const notes: string[] = [];

  // The same way round as the coming game, then the other way.
  const venueNote = (s: VenueSplit | null, host: string, guest: string) => {
    if (!s || s.games < MIN_FOR_NOTE) return;
    if (s.hostWins === s.games) notes.push(`${host} ganhou os ${s.games} jogos que fez em casa frente a ${guest}.`);
    else if (s.guestWins === s.games) notes.push(`${guest} ganhou os ${s.games} jogos que fez fora frente a ${host}.`);
    else if (s.guestWins === 0)
      notes.push(`${host} não perde em casa frente a ${guest} em ${s.games} jogos (${times(s.hostWins)} ganhou e ${times(s.draws)} empatou).`);
    else if (s.hostWins === 0)
      notes.push(`${host} não ganha em casa frente a ${guest} em ${s.games} jogos (${times(s.draws)} empatou e ${times(s.guestWins)} perdeu).`);
  };
  venueNote(homeAtHome, home, away);
  venueNote(awayAtHome, away, home);
  // Goals in the games played the same way round as the coming one.
  if (homeAtHome && homeAtHome.games >= 5) {
    const n = homeAtHome.games;
    const over = Math.round(homeAtHome.over25 * n);
    if (homeAtHome.over25 >= 0.8) notes.push(`Nos ${n} jogos com ${home} em casa houve mais de 2,5 golos ${over} vezes.`);
    else if (homeAtHome.over25 <= 0.2)
      notes.push(`Nos ${n} jogos com ${home} em casa só ${over === 1 ? "1 teve" : `${over} tiveram`} mais de 2,5 golos.`);
  }

  // Current run of a team over all the meetings, wherever they were played.
  const run = (team: string, ok: (r: "V" | "E" | "D") => boolean) => {
    let n = 0;
    for (const m of meetings) {
      if (!ok(resultFor(m, team))) break;
      n++;
    }
    return n;
  };
  for (const team of [home, away]) {
    const wins = run(team, (r) => r === "V");
    const unbeaten = run(team, (r) => r !== "D");
    if (wins >= 3) notes.push(`${team} ganhou os últimos ${wins} confrontos.`);
    else if (unbeaten >= 4) notes.push(`${team} não perde há ${unbeaten} confrontos.`);
  }

  if (total >= 4) {
    if (draws >= 0.4) notes.push(`Há muitos empates entre as duas: ${count((m) => m.ft[0] === m.ft[1])} em ${total}.`);
    if (over25 >= 0.75)
      notes.push(`Mais de 2,5 golos em ${count((m) => m.ft[0] + m.ft[1] > 2)} dos ${total} jogos (média de ${one(goalsPerGame)} golos).`);
    else if (over25 <= 0.25)
      notes.push(`Só ${count((m) => m.ft[0] + m.ft[1] > 2)} dos ${total} jogos tiveram mais de 2,5 golos (média de ${one(goalsPerGame)}): costumam ser jogos fechados.`);
    if (btts >= 0.75) notes.push(`As duas equipas marcaram em ${count((m) => m.ft[0] > 0 && m.ft[1] > 0)} dos ${total} jogos.`);
    else if (btts <= 0.25)
      notes.push(`As duas equipas só marcaram em ${count((m) => m.ft[0] > 0 && m.ft[1] > 0)} dos ${total} jogos: costuma haver uma que fica em branco.`);
  }

  return { total, homeAtHome, awayAtHome, goalsPerGame, over25, btts, draws, recent, notes: notes.slice(0, 6) };
}
