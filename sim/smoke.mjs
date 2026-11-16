import * as E from "./engine.mjs";
import { playGame, DEFAULT_THETA } from "./bots.mjs";

const bot = { name: "greedy", kind: "greedy", theta: DEFAULT_THETA };
const rnd = { name: "random", kind: "random" };
const t0 = Date.now();
let wins = [0, 0, 0];
const N = Number(process.argv[2] || 50);
for (let s = 1; s <= N; s++) {
  const g = playGame({}, s, [bot, bot, rnd]);
  const sc = E.scores(g); wins[sc.indexOf(Math.max(...sc))]++;
  if (s === 1) {
    console.log("scores", sc.map(Math.round), "actions", g.stats.actions, "divCalls", g.stats.divCalls);
    for (let l = 0; l < E.NL; l++) console.log(" line", l, "stations", E.line(g, l).stations, "track", E.line(g, l).edges.length, "zones", E.line(g, l).zones.size, "per", E.perShare(g, l), "sold", g.sold[l], "price", E.priceOf(g, l));
    g.players.forEach((p) => console.log(" player", p.id, "cash", p.cash, "shares", p.shares.join(","), "hand", p.hand.join(","), "div", p.divIncome));
    console.log(" bag", g.bag.reduce((a, b) => a + b, 0), "burned", g.burned, "onboard", g.onboard.reduce((a, b) => a + b, 0));
  }
}
console.log("wins by seat (greedy, greedy, random):", wins, "ms/game", ((Date.now() - t0) / N).toFixed(1));
