/*  Why does the last seat lose at 4 players, and what fixes it?  node sim/.build/four.mjs [games]
 *  Rules as the app plays now: merges (4, safe 8), end-of-game holder bonuses, landmark goals,
 *  rotating start player, 1 share per turn. */
import fs from "node:fs";
import * as E from "./engine.mjs";
import { playGame } from "./bots.mjs";

const N = Number(process.argv[2] || 800);
const th = JSON.parse(fs.readFileSync("sim/out/theta-mergesSafe.json")).theta;
const bot = { kind: "greedy", theta: th };
const APP = { scoring: "acq", merges: true, mergeAt: 4, safeAt: 8, rotateStart: true, investPerTurn: 1,
              goals: true, goalsPublic: 3, goalBonus: 30, goalPrice: 5, secretRoutes: 2, secretValue: 30 };
const variants = {
  "app today (15 rounds)": {},
  "16 rounds": { roundLimit: 16 },
  "12 rounds": { roundLimit: 12 },
  "16 rounds + later seats +$10 each": { roundLimit: 16, seatCash: 10 },
  "later seats +$10 each": { seatCash: 10 },
  "later seats +$20 each": { seatCash: 20 },
  "snake, 16 rounds": { rotateStart: false, snake: true, roundLimit: 16 },
  "16 rounds, 2 shares, 1 in round 1": { roundLimit: 16, investPerTurn: 2, firstRoundInvest: 1 },
  "16 rounds, start cash 80": { roundLimit: 16, startCash: 80 },
};
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const out = {};
for (const [name, over] of Object.entries(variants)) {
  const n = 4, w = Array(n).fill(0), parts = Array.from({ length: n }, () => ({ cash: [], shares: [], div: [], bonus: [], score: [], starts: [] })), gapByRound = Array.from({ length: 16 }, () => []);
  for (let s = 1; s <= N; s++) {
    const g = playGame({ ...APP, ...over }, 1500000 + s, Array.from({ length: n }, () => bot));
    const sc = E.scores(g), top = Math.max(...sc), k = sc.filter((x) => x === top).length;
    sc.forEach((x, i) => { if (x === top) w[i] += 1 / k; });
    const b = E.bonuses(g);
    g.players.forEach((p, i) => {
      parts[i].cash.push(p.cash); parts[i].div.push(p.divIncome); parts[i].bonus.push(b[i]); parts[i].score.push(sc[i]);
      parts[i].shares.push(p.shares.reduce((a, q, l) => a + q * E.shareValue(g, l), 0));
    });
    // how far the last seat is behind the mean of the others, at the end of each round
    g.stats.history.filter((_, i) => (i + 1) % n === 0).forEach((h, r) => { const o = h.scores.slice(0, 3); gapByRound[r]?.push(h.scores[3] - mean(o)); });
  }
  const r = w.map((x) => x / N);
  out[name] = { seats: r, spread: Math.max(...r) - Math.min(...r),
                perSeat: parts.map((p) => ({ cash: mean(p.cash), shares: mean(p.shares), div: mean(p.div), bonus: mean(p.bonus), score: mean(p.score) })),
                lastSeatGap: gapByRound.map((a) => (a.length ? mean(a) : null)).filter((x) => x !== null) };
  console.log(`${name.padEnd(38)} ${r.map((x) => (x * 100).toFixed(0).padStart(3)).join(" ")}  spread ${(out[name].spread * 100).toFixed(0)}`);
  if (name === "app today (15 rounds)") {
    out[name].perSeat.forEach((p, i) => console.log(`   seat ${i + 1}: score ${p.score.toFixed(0)} cash ${p.cash.toFixed(0)} shares ${p.shares.toFixed(0)} dividends ${p.div.toFixed(0)} bonuses ${p.bonus.toFixed(0)}`));
    console.log("   seat 4 behind the others by round:", out[name].lastSeatGap.map((x) => x.toFixed(0)).join(" "));
  }
}
fs.writeFileSync("sim/out/four.json", JSON.stringify(out, null, 1));
