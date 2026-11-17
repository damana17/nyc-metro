/*  Control: every rule variant played by the SAME bots (tuned for today's app rules), so differences
 *  come from the rules, not from each variant's own tuning.  node sim/.build/control.mjs [games] */
import fs from "node:fs";
import * as E from "./engine.mjs";
import { playGame } from "./bots.mjs";
import { VARIANTS } from "./variants.mjs";

const N = Number(process.argv[2] || 800);
const th = JSON.parse(fs.readFileSync("sim/out/theta-app.json")).theta;
const bot = { kind: "greedy", theta: th };
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const out = {};
for (const v of ["app", "directors", "selling", "sellingMarket", "events", "all3"]) {
  const w = [0, 0, 0], m = { lead: [], ahead5: [], ahead10: [], st: [], merges: [], takeovers: [], sells: [], margin: [], swing: [] };
  for (let s = 1; s <= N; s++) {
    const g = playGame(VARIANTS[v].settings, 2100000 + s, [bot, bot, bot]);
    const sc = E.scores(g), top = Math.max(...sc), k = sc.filter((x) => x === top).length, win = sc.indexOf(top);
    sc.forEach((x, i) => { if (x === top) w[i] += 1 / k; });
    const H = g.stats.history.filter((_, i) => (i + 1) % 3 === 0), L = H.map((h) => h.scores.indexOf(Math.max(...h.scores)));
    let ch = 0; for (let i = 1; i < L.length; i++) if (L[i] !== L[i - 1]) ch++;
    m.lead.push(ch); m.ahead5.push(L[4] === win ? 1 : 0); m.ahead10.push(L[9] === win ? 1 : 0);
    let st = 0; for (let l = 0; l < E.NL; l++) st += E.line(g, l).stations;
    m.st.push(st); m.merges.push(g.stats.mergers.length); m.takeovers.push(g.stats.takeovers); m.sells.push(g.stats.sells);
    const o = [...sc].sort((a, b) => b - a); m.margin.push((o[0] - o[1]) / o[0]);
  }
  out[v] = { label: VARIANTS[v].label, seats: w.map((x) => x / N), leadChanges: mean(m.lead), winnerAheadR5: mean(m.ahead5), winnerAheadR10: mean(m.ahead10),
             stations: mean(m.st), mergers: mean(m.merges), takeovers: mean(m.takeovers), sells: mean(m.sells), margin: mean(m.margin) };
  const d = out[v];
  console.log(`${d.label.slice(0, 44).padEnd(44)} seats ${d.seats.map((x) => (x * 100).toFixed(0)).join("/")}  lead ${d.leadChanges.toFixed(2)} aheadR5 ${(d.winnerAheadR5 * 100).toFixed(0)}% aheadR10 ${(d.winnerAheadR10 * 100).toFixed(0)}% st ${d.stations.toFixed(0)} merges ${d.mergers.toFixed(2)} takeovers ${d.takeovers.toFixed(1)} sells ${d.sells.toFixed(1)} margin ${d.margin.toFixed(2)}`);
}
fs.writeFileSync("sim/out/control.json", JSON.stringify(out, null, 1));
