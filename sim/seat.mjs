/*  Why does the first seat win? Traces the opening and tests candidate causes. */
import fs from "node:fs";
import * as E from "./engine.mjs";
import { playTurn, playGame } from "./bots.mjs";

const TH = JSON.parse(fs.readFileSync("sim/out/theta.json"));
const bot = (sc) => ({ name: "tuned", kind: "greedy", theta: TH[sc].theta });
const scoring = process.argv[2] || "base";

// 1. the opening, move by move, for three games
for (let seed = 1; seed <= 3; seed++) {
  const g = E.newGame({ scoring }, seed);
  const lines = [];
  const orig = E.apply;
  for (let t = 0; t < 9; t++) {
    const who = g.turn.active, before = JSON.stringify(g.stats.actions);
    const pBefore = { cash: g.players[who].cash, shares: [...g.players[who].shares] };
    playTurn(g, bot(scoring));
    const p = g.players[who];
    lines.push(`r${Math.floor(t / 3) + 1} P${who + 1}: cash ${pBefore.cash}->${p.cash} shares ${pBefore.shares.join("")}->${p.shares.join("")}  divs called so far ${g.stats.divCalls}  sold ${g.sold.join(",")}`);
  }
  console.log(`--- seed ${seed}\n` + lines.join("\n"));
}

// 2. who calls dividends, and who gains from each call
const callers = [0, 0, 0], gainLeader = [];
for (let seed = 1; seed <= 300; seed++) {
  const g = E.newGame({ scoring }, 5000 + seed);
  while (!g.over) {
    const who = g.turn.active, calls = g.stats.divCalls;
    playTurn(g, bot(scoring));
    if (g.stats.divCalls > calls) callers[who]++;
  }
}
console.log("dividend calls by seat over 300 games:", callers);

// 3. candidate fixes, 600 games each
const variants = {
  "as is": {},
  "no step per share sold": { stepPerShare: 0 },
  "1 invest per turn": { investPerTurn: 1 },
  "start cash 30": { startCash: 30 },
  "no dividends in round 1 (first call from round 2)": { firstDivRound: 2 },
};
for (const [name, over] of Object.entries(variants)) {
  const w = [0, 0, 0];
  for (let seed = 1; seed <= 600; seed++) {
    const g = playGame({ scoring, ...over }, 9000 + seed, [bot(scoring), bot(scoring), bot(scoring)]);
    const sc = E.scores(g), top = Math.max(...sc), n = sc.filter((x) => x === top).length;
    sc.forEach((x, i) => { if (x === top) w[i] += 1 / n; });
  }
  console.log(name.padEnd(52), w.map((x) => (x / 600 * 100).toFixed(0) + "%").join("  "));
}
