/*  Self-play tuning of the greedy bot's five weights, one population per scoring rule.
 *  Fitness = share of wins (ties split) in 3-player games against other members, seats shuffled.
 *  Writes sim/out/theta.json: the champion weights per scoring rule. */
import fs from "node:fs";
import * as E from "./engine.mjs";
import { playGame, DEFAULT_THETA } from "./bots.mjs";

const RANGE = { phi: [0, 1.2], wDisc: [0, 20], wPot: [0, 20], lambda: [0, 1], noise: [0, 3] };
const rules = (process.argv[2] || "mtm,base,cash,acq").split(",");
const GENS = Number(process.argv[3] || 24), POP = 14, GAMES_EACH = 36;
const R = E.rng(20261116);
const clamp = (k, v) => Math.min(RANGE[k][1], Math.max(RANGE[k][0], v));
const rand = () => Object.fromEntries(Object.entries(RANGE).map(([k, [a, b]]) => [k, a + R() * (b - a)]));
const mutate = (t, s) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, clamp(k, v + (R() - 0.5) * 2 * s * (RANGE[k][1] - RANGE[k][0]))]));

const out = fs.existsSync("sim/out/theta.json") ? JSON.parse(fs.readFileSync("sim/out/theta.json")) : {};
let seed = 1;
for (const scoring of rules) {
  let pop = [{ ...DEFAULT_THETA }, ...Array.from({ length: POP - 1 }, rand)];
  const trace = [];
  for (let gen = 0; gen < GENS; gen++) {
    const fit = pop.map(() => ({ w: 0, n: 0 }));
    const games = Math.ceil((POP * GAMES_EACH) / 3);
    for (let i = 0; i < games; i++) {
      const idx = [0, 1, 2].map(() => Math.floor(R() * POP));
      const g = playGame({ scoring }, seed++, idx.map((k) => ({ kind: "greedy", theta: pop[k] })));
      const sc = E.scores(g), top = Math.max(...sc), winners = sc.filter((x) => x === top).length;
      idx.forEach((k, s) => { fit[k].n++; if (sc[s] === top) fit[k].w += 1 / winners; });
    }
    const ranked = pop.map((t, i) => ({ t, f: fit[i].n ? fit[i].w / fit[i].n : 0 })).sort((a, b) => b.f - a.f);
    trace.push({ gen, best: ranked[0].f, theta: ranked[0].t });
    const step = 0.15 * (1 - gen / GENS) + 0.03;
    const elite = ranked.slice(0, 4).map((x) => x.t);
    pop = [...elite, ...Array.from({ length: POP - 4 - 2 }, (_, i) => mutate(elite[i % 4], step)), rand(), rand()];
    process.stdout.write(`${scoring} gen ${gen} best ${ranked[0].f.toFixed(3)} ${JSON.stringify(Object.fromEntries(Object.entries(ranked[0].t).map(([k, v]) => [k, +v.toFixed(2)])))}\n`);
  }
  // champion = elite member with best record over a fresh, larger tournament
  const elite = pop.slice(0, 4);
  const rec = elite.map(() => ({ w: 0, n: 0 }));
  for (let i = 0; i < 600; i++) {
    const idx = [0, 1, 2].map(() => Math.floor(R() * 4));
    const g = playGame({ scoring }, seed++, idx.map((k) => ({ kind: "greedy", theta: elite[k] })));
    const sc = E.scores(g), top = Math.max(...sc), n = sc.filter((x) => x === top).length;
    idx.forEach((k, s) => { rec[k].n++; if (sc[s] === top) rec[k].w += 1 / n; });
  }
  const champ = elite[rec.map((r) => r.w / r.n).reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0)];
  out[scoring] = { theta: champ, trace };
  fs.mkdirSync("sim/out", { recursive: true });
  fs.writeFileSync("sim/out/theta.json", JSON.stringify(out, null, 1));
}
console.log("done");
