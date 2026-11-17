/*  Which turn order and share limit is fairest once merges are in?
 *  node sim/.build/order.mjs [games]  ->  sim/out/order.json */
import fs from "node:fs";
import * as E from "./engine.mjs";
import { playGame } from "./bots.mjs";

const N = Number(process.argv[2] || 600);
const th = JSON.parse(fs.readFileSync("sim/out/theta-mergesSafe.json")).theta;
const bot = { kind: "greedy", theta: th };
const base = { scoring: "base", merges: true, mergeAt: 4, safeAt: 8 };
const variants = {
  "snake, 2 shares": { snake: true, investPerTurn: 2 },
  "snake, 1 share": { snake: true, investPerTurn: 1 },
  "rotate, 2 shares": { rotateStart: true, investPerTurn: 2 },
  "rotate, 1 share": { rotateStart: true, investPerTurn: 1 },
  "rotate, 2 shares, 1 in round 1": { rotateStart: true, investPerTurn: 2, firstRoundInvest: 1 },
  "fixed, 2 shares": { investPerTurn: 2 },
};
const out = {};
for (const [name, over] of Object.entries(variants)) {
  for (const np of [3, 4]) {
    const w = Array(np).fill(0);
    for (let s = 1; s <= N; s++) {
      const g = playGame({ ...base, ...over }, 800000 + s, Array.from({ length: np }, () => bot));
      const sc = E.scores(g), top = Math.max(...sc), k = sc.filter((x) => x === top).length;
      sc.forEach((x, i) => { if (x === top) w[i] += 1 / k; });
    }
    const r = w.map((x) => x / N);
    out[`${name} · ${np}p`] = { seats: r, spread: Math.max(...r) - Math.min(...r) };
    console.log(`${(name + " · " + np + "p").padEnd(40)} ${r.map((x) => (x * 100).toFixed(0).padStart(3)).join(" ")}  spread ${((Math.max(...r) - Math.min(...r)) * 100).toFixed(0)}`);
  }
}
fs.writeFileSync("sim/out/order.json", JSON.stringify(out, null, 1));
