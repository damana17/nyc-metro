/*  Do landmark goals change how the board is played?  node sim/.build/goals.mjs [games]
 *  Merges on (4 stations, safe at 8), base-price scoring, rotate order, 2 shares a turn. Same tuned bots
 *  throughout; they take a goal when a move completes it and count secret routes already linked,
 *  but do not plan routes towards goals, so these numbers are a floor on how much goals get chased. */
import fs from "node:fs";
import * as E from "./engine.mjs";
import { playGame } from "./bots.mjs";

const N = Number(process.argv[2] || 600);
const th = JSON.parse(fs.readFileSync("sim/out/theta-mergesSafe.json")).theta;
const bot = { kind: "greedy", theta: th };
const base = { scoring: "base", merges: true, mergeAt: 4, safeAt: 8, rotateStart: true, investPerTurn: 2 };
const G = { goals: true, goalsPublic: 3, goalBonus: 30, goalPrice: 5, secretRoutes: 2, secretValue: 30 };
const variants = { "no goals": {}, "goals ($30 / $30)": G, "goals, big ($60 / $60)": { ...G, goalBonus: 60, secretValue: 60 } };
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const out = {};
for (const [name, over] of Object.entries(variants)) {
  const m = { wins: [0, 0, 0], goals: [], goalRound: [], routes: [], routeShare: [], crossings: [], lead: [], ahead10: [], stations: [], track: [], mergers: [] };
  for (let s = 1; s <= N; s++) {
    const g = playGame({ ...base, ...over }, 900000 + s, [bot, bot, bot]);
    const sc = E.scores(g), top = Math.max(...sc), k = sc.filter((x) => x === top).length;
    sc.forEach((x, i) => { if (x === top) m.wins[i] += 1 / k; });
    m.goals.push(g.stats.goals ? g.stats.goals.length : 0);
    (g.stats.goals || []).forEach((x) => m.goalRound.push(x.round));
    const rv = g.players.map((_, i) => E.routeValue(g, i));
    m.routes.push(mean(rv) / (over.secretValue || 1));
    m.routeShare.push(mean(rv) / Math.max(1, mean(sc)));
    let cross = 0; for (const h of E.HEXES) if (E.occupants(g, h).size > 1) cross++;
    m.crossings.push(cross);
    const H = g.stats.history.filter((_, i) => (i + 1) % 3 === 0), leaders = H.map((h) => h.scores.indexOf(Math.max(...h.scores)));
    let ch = 0; for (let i = 1; i < leaders.length; i++) if (leaders[i] !== leaders[i - 1]) ch++;
    m.lead.push(ch); m.ahead10.push(leaders[9] === sc.indexOf(top) ? 1 : 0);
    let st = 0, tr = 0; for (let l = 0; l < E.NL; l++) { st += E.line(g, l).stations; tr += E.line(g, l).edges.length; }
    m.stations.push(st); m.track.push(tr); m.mergers.push(g.stats.mergers.length);
  }
  out[name] = { seats: m.wins.map((w) => w / N), goals: mean(m.goals), goalRound: mean(m.goalRound), routesLinked: mean(m.routes), routeShare: mean(m.routeShare),
                crossings: mean(m.crossings), leadChanges: mean(m.lead), winnerAhead10: mean(m.ahead10), stations: mean(m.stations), track: mean(m.track), mergers: mean(m.mergers) };
  const o = out[name];
  console.log(`${name.padEnd(24)} seats ${o.seats.map((x) => (x * 100).toFixed(0)).join("/")} goals ${o.goals.toFixed(2)} (round ${o.goalRound.toFixed(1)}) routes/player ${o.routesLinked.toFixed(2)} routeShare ${(o.routeShare * 100).toFixed(0)}% crossings ${o.crossings.toFixed(1)} lead ${o.leadChanges.toFixed(2)} ahead10 ${(o.winnerAhead10 * 100).toFixed(0)}% st ${o.stations.toFixed(0)} tr ${o.track.toFixed(0)} merges ${o.mergers.toFixed(2)}`);
}
fs.writeFileSync("sim/out/goals.json", JSON.stringify(out, null, 1));
