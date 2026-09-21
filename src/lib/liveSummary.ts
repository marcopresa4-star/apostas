import type { LivePrediction } from "./liveModel";

const pct = (p: number) => (p > 0 && p < 0.1 ? `${(p * 100).toFixed(1).replace(".", ",")}%` : `${Math.round(p * 100)}%`);
const dot = (n: number) => n.toFixed(1).replace(".", ",");

// What can still happen in a game in progress, as sentences: how much is left,
// the goals to come, who scores next, how the game can end and how it can turn.
export function liveSummary(
  p: LivePrediction,
  ctx: { home: string; away: string; minute: number; homeGoals: number; awayGoals: number }
): string[] {
  const { home, away, minute, homeGoals, awayGoals } = ctx;
  const total = homeGoals + awayGoals;
  const lines: string[] = [];

  if (minute >= 90) lines.push("O jogo está nos descontos: já pouco pode acontecer.");
  else lines.push(`Faltam cerca de ${90 - minute} minutos, mais os descontos.`);

  const more = p.over[String(total + 0.5)];
  const two = p.over[String(total + 1.5)];
  const three = p.over[String(total + 2.5)];
  lines.push(
    `Ainda se esperam ${dot(p.remainingHome + p.remainingAway)} golos (${home} ${dot(p.remainingHome)}, ${away} ${dot(p.remainingAway)}). ` +
      `Há ${pct(more)} de chance de haver pelo menos mais 1 golo, ${pct(two)} de pelo menos 2 e ${pct(three)} de pelo menos 3.`
  );

  lines.push(
    `O próximo golo é de ${home} com ${pct(p.nextGoal.home)}, de ${away} com ${pct(p.nextGoal.away)}, e ${pct(p.nextGoal.none)} de não haver mais nenhum.`
  );

  lines.push(
    `Resultado final: ${home} ${pct(p.fullTime.home)}, empate ${pct(p.fullTime.draw)}, ${away} ${pct(p.fullTime.away)}.`
  );

  // How it can turn: the side behind winning it, or drawing.
  if (homeGoals !== awayGoals) {
    const behind = homeGoals < awayGoals ? home : away;
    const win = homeGoals < awayGoals ? p.fullTime.home : p.fullTime.away;
    const draw = p.fullTime.draw;
    lines.push(`${behind} está a perder: pode virar o jogo com ${pct(win)} ou empatar com ${pct(draw)}.`);
  } else if (total > 0) {
    lines.push("Está empatado, com golos de ambos os lados: qualquer um pode desempatar.");
  } else {
    lines.push("Ainda está 0–0: quem marcar primeiro muda a pressão do jogo.");
  }

  if (homeGoals === 0 || awayGoals === 0) {
    lines.push(`Ambas marcam: ${pct(p.bothScore)}${homeGoals > 0 || awayGoals > 0 ? " (falta marcar quem ainda não marcou)" : ""}.`);
  }

  const scores = p.finalScores.slice(0, 4).map((f) => `${f.home}–${f.away} (${pct(f.p)})`);
  lines.push(`Resultados finais mais prováveis: ${scores.join(", ")}.`);
  return lines;
}
