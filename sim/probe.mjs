/*  Small direct probes of the rules, independent of any bot. */
import * as E from "./engine.mjs";

// 1. The Tally's paper-money effect: buy shares in an untouched line with no dividends ever called.
for (const scoring of ["mtm", "base"]) {
  const g = E.newGame({ scoring }, 3);
  const p = g.players[0]; p.hand[0] = 10; p.cash = 1000;
  const before = E.scores(g)[0];
  const row = [];
  for (let k = 1; k <= 8; k++) {
    g.turn.invests = 0; g.turn.usedSlot = false; g.turn.ap = 5;
    E.apply(g, { t: "invest", l: 0, wild: false });
    row.push(Math.round(E.scores(g)[0] - before));
  }
  console.log(`${scoring}: score change after buying 1..8 shares of a line that has never paid a dividend:`, row.join(", "));
}

// 2. Station cost distribution: how far apart are stations when built, and what do they cost?
const costs = {};
for (let s = 1; s <= 300; s++) {
  const g = E.newGame({}, s);
  for (const h of E.HEXES) { const c = E.stationCost(g, h); costs[c] = (costs[c] || 0) + 1; }
}
const tot = Object.values(costs).reduce((a, b) => a + b, 0);
console.log("station cost on a random hex at game start (base 3):", Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, (v / tot * 100).toFixed(0) + "%"])));

// 3. Disc supply: discs per line vs what building it needs
console.log("discs per colour:", E.NL, "lines;", JSON.stringify(Array.from({ length: E.NL }, (_, l) => E.newGame({}, 1).bag[l] + E.newGame({}, 1).players.reduce((a, p) => a + p.hand[l], 0))));
