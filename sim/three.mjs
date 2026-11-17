/* Does +$X per later seat help or hurt at 3 players under the app's current rules? */
import fs from "node:fs";
import * as E from "./engine.mjs";
import { playGame } from "./bots.mjs";

const th = JSON.parse(fs.readFileSync("sim/out/theta-mergesSafe.json")).theta, bot = { kind: "greedy", theta: th };
const APP = { scoring: "acq", merges: true, mergeAt: 4, safeAt: 8, rotateStart: true, investPerTurn: 1,
              goals: true, goalsPublic: 3, goalBonus: 30, goalPrice: 5, secretRoutes: 2, secretValue: 30 };
for (const sc of [0, 5, 10]) {
  const w = [0, 0, 0], N = 600;
  for (let s = 1; s <= N; s++) {
    const g = playGame({ ...APP, seatCash: sc }, 1900000 + s, [bot, bot, bot]);
    const x = E.scores(g), t = Math.max(...x), k = x.filter((v) => v === t).length;
    x.forEach((v, i) => { if (v === t) w[i] += 1 / k; });
  }
  console.log(`3 players, later seats +$${sc}: ${w.map((v) => (v / N * 100).toFixed(0)).join(" / ")}`);
}
