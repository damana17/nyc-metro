/*  How much of the 4-player last-seat problem is the bots?  node sim/.build/robust.mjs [games]
 *  Same rules as the app; only the bots change. */
import fs from "node:fs";
import * as E from "./engine.mjs";
import { playGame } from "./bots.mjs";

const N = Number(process.argv[2] || 600);
const T = (v) => JSON.parse(fs.readFileSync(`sim/out/theta-${v}.json`)).theta;
const main = T("mergesSafe");
const pool = ["mergesSafe", "merges", "merges5", "merges6", "fixed", "merges3"].map(T);
const APP = { scoring: "acq", merges: true, mergeAt: 4, safeAt: 8, rotateStart: true, investPerTurn: 1,
              goals: true, goalsPublic: 3, goalBonus: 30, goalPrice: 5, secretRoutes: 2, secretValue: 30 };
const R = E.rng(4242);
const jitter = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.max(0, v * (0.6 + 0.8 * R()))]));
const tables = {
  "identical bots": () => [0, 1, 2, 3].map(() => ({ kind: "greedy", theta: main })),
  "mixed personalities": () => [0, 1, 2, 3].map(() => ({ kind: "greedy", theta: pool[Math.floor(R() * pool.length)] })),
  "jittered bots": () => [0, 1, 2, 3].map(() => ({ kind: "greedy", theta: jitter(main) })),
  "turn-ahead bot in seat 4": () => [0, 1, 2].map(() => ({ kind: "greedy", theta: main })).concat([{ kind: "lookahead", theta: main, oppTheta: main, K: 4 }]),
  "turn-ahead bot in seat 1": () => [{ kind: "lookahead", theta: main, oppTheta: main, K: 4 }].concat([1, 2, 3].map(() => ({ kind: "greedy", theta: main }))),
};
const out = {};
for (const [name, make] of Object.entries(tables)) {
  const w = [0, 0, 0, 0];
  const games = name.startsWith("turn-ahead") ? Math.round(N / 2) : N;
  for (let s = 1; s <= games; s++) {
    const g = playGame(APP, 1700000 + s, make());
    const sc = E.scores(g), top = Math.max(...sc), k = sc.filter((x) => x === top).length;
    sc.forEach((x, i) => { if (x === top) w[i] += 1 / k; });
  }
  out[name] = w.map((x) => x / games);
  console.log(`${name.padEnd(28)} ${out[name].map((x) => (x * 100).toFixed(0).padStart(3)).join(" ")}   (${games} games)`);
}
fs.writeFileSync("sim/out/robust.json", JSON.stringify(out, null, 1));
