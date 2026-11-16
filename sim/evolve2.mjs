/*  Self-play tuning for one rule variant: node sim/.build/evolve2.mjs <variant> [gens]
 *  Writes sim/out/theta-<variant>.json. Same method as evolve.mjs. */
import fs from "node:fs";
import * as E from "./engine.mjs";
import { playGame } from "./bots.mjs";
import { VARIANTS } from "./variants.mjs";

const name = process.argv[2], GENS = Number(process.argv[3] || 16), POP = 12, GAMES_EACH = 30;
const settings = VARIANTS[name].settings;
const RANGE = { phi: [0, 1.2], wDisc: [0, 20], wPot: [0, 20], lambda: [0, 1], noise: [0, 3] };
const R = E.rng(777 + name.length * 31);
const clamp = (k, v) => Math.min(RANGE[k][1], Math.max(RANGE[k][0], v));
const rand = () => Object.fromEntries(Object.entries(RANGE).map(([k, [a, b]]) => [k, a + R() * (b - a)]));
const mutate = (t, s) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, clamp(k, v + (R() - 0.5) * 2 * s * (RANGE[k][1] - RANGE[k][0]))]));
const prior = JSON.parse(fs.readFileSync("sim/out/theta.json")).base.theta;

let pop = [{ ...prior }, ...Array.from({ length: POP - 1 }, rand)], seed = 1;
const tournament = (members, games) => {
  const fit = members.map(() => ({ w: 0, n: 0 }));
  for (let i = 0; i < games; i++) {
    const idx = [0, 1, 2].map(() => Math.floor(R() * members.length));
    const g = playGame(settings, seed++, idx.map((k) => ({ kind: "greedy", theta: members[k] })));
    const sc = E.scores(g), top = Math.max(...sc), n = sc.filter((x) => x === top).length;
    idx.forEach((k, s) => { fit[k].n++; if (sc[s] === top) fit[k].w += 1 / n; });
  }
  return fit.map((f) => (f.n ? f.w / f.n : 0));
};
for (let gen = 0; gen < GENS; gen++) {
  const f = tournament(pop, Math.ceil((POP * GAMES_EACH) / 3));
  const ranked = pop.map((t, i) => ({ t, f: f[i] })).sort((a, b) => b.f - a.f);
  const elite = ranked.slice(0, 4).map((x) => x.t), step = 0.15 * (1 - gen / GENS) + 0.03;
  pop = [...elite, ...Array.from({ length: POP - 6 }, (_, i) => mutate(elite[i % 4], step)), rand(), rand()];
  process.stdout.write(`${name} gen ${gen} best ${ranked[0].f.toFixed(3)}\n`);
}
const elite = pop.slice(0, 4), f = tournament(elite, 400);
const champ = elite[f.indexOf(Math.max(...f))];
fs.writeFileSync(`sim/out/theta-${name}.json`, JSON.stringify({ theta: champ }, null, 1));
console.log(`${name} done`, JSON.stringify(champ));
