/* Quick check that each new mechanic actually fires. */
import fs from "node:fs";
import * as E from "./engine.mjs";
import { playGame } from "./bots.mjs";
import { VARIANTS } from "./variants.mjs";

const th = JSON.parse(fs.readFileSync("sim/out/theta-mergesSafe.json")).theta, bot = { kind: "greedy", theta: th };
for (const v of ["directors", "selling", "sellingMarket", "all3"]) {
  const t0 = Date.now(), agg = { takeovers: 0, blocks: 0, sells: 0, div: 0, merges: 0, events: 0, stations: 0 };
  const N = 40;
  for (let s = 1; s <= N; s++) {
    const g = playGame(VARIANTS[v].settings, 300 + s, [bot, bot, bot]);
    agg.takeovers += g.stats.takeovers; agg.blocks += g.stats.blocks; agg.sells += g.stats.sells; agg.div += g.stats.divCalls;
    agg.merges += g.stats.mergers.length; agg.events += g.stats.events.length;
    for (let l = 0; l < E.NL; l++) agg.stations += E.line(g, l).stations;
  }
  console.log(v.padEnd(10), Object.entries(agg).map(([k, x]) => `${k} ${(x / N).toFixed(1)}`).join("  "), `${((Date.now() - t0) / N).toFixed(0)}ms/game`);
}
