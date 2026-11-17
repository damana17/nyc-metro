/*  Compare real playtests with the bots.
 *  Download each game's record from the app (⋯ menu → Download game record) into one folder, then:
 *    node sim/.build/replay.mjs path/to/folder [botGames]
 *  It reads every .json record there, sums up how the people played, plays the same rules with the
 *  tuned bots, and prints the two side by side. Also writes sim/out/replay.json. */
import fs from "node:fs";
import path from "node:path";
import * as E from "./engine.mjs";
import { playGame } from "./bots.mjs";

const dir = process.argv[2], BOTS = Number(process.argv[3] || 300);
if (!dir) { console.log("usage: node sim/.build/replay.mjs <folder of game records> [bot games]"); process.exit(1); }
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
const recs = files.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f))); } catch (e) { return null; } }).filter((r) => r && r.app === "nyc-metro" && r.game === "influence");
if (!recs.length) { console.log(`no Influence game records in ${dir}`); process.exit(1); }

/* what kind of move a log line is */
const KIND = [["track", /^(laid|removed) .* track/], ["station", /station/], ["invest", /^bought a .* share/], ["div", /^called for dividends/],
              ["draw", /^drew influence/], ["merge", /^merged /], ["goal", /completed "/], ["end", /^ended turn/]];
const kindOf = (note) => (KIND.find(([, re]) => re.test(note)) || ["other"])[0];

const human = { games: recs.length, turns: 0, moves: {}, seatWins: {}, rounds: [], mergers: [], goals: [] };
for (const r of recs) {
  (r.moves || []).forEach((m) => { const k = kindOf(m.note); human.moves[k] = (human.moves[k] || 0) + 1; });
  human.turns += (r.moves || []).filter((m) => kindOf(m.note) === "end").length;
  const fin = r.final || [], top = Math.max(...fin.map((x) => x.total));
  fin.forEach((x, i) => { if (x.total === top) human.seatWins[i + 1] = (human.seatWins[i + 1] || 0) + 1; });
  human.rounds.push(r.round); human.mergers.push((r.mergers || []).length);
  human.goals.push(Object.keys(r.goals?.done || {}).length);
}

/* the same rules for the bots, from the first record's settings */
const S = recs[0].settings || {};
const settings = { scoring: S.endBonuses ? "acq" : "base", majBonus: S.majBonus, minBonus: S.minBonus, merges: true, mergeAt: S.mergeAt, safeAt: S.safeAt,
  investPerTurn: S.investPerTurn, snake: S.turnOrder === "snake", rotateStart: S.turnOrder === "rotate", goals: !!S.goals,
  goalsPublic: S.goalsPublic, goalBonus: S.goalBonus, goalPrice: S.goalPrice, secretRoutes: S.secretRoutes, secretValue: S.secretValue,
  apPerTurn: S.apPerTurn, roundLimit: S.roundLimit, stationBase: S.stationBase, stepPerShare: S.stepPerShare, startCash: S.startCash };
Object.keys(settings).forEach((k) => settings[k] === undefined && delete settings[k]);
const players = recs[0].players?.length || 3;
const th = JSON.parse(fs.readFileSync("sim/out/theta-mergesSafe.json")).theta;
const bot = { kind: "greedy", theta: th };
const botSide = { games: BOTS, turns: 0, moves: {}, seatWins: {}, mergers: [], goals: [] };
for (let s = 1; s <= BOTS; s++) {
  const g = playGame(settings, 1200000 + s, Array.from({ length: players }, () => bot));
  Object.entries(g.stats.actions).forEach(([k, v]) => { botSide.moves[k] = (botSide.moves[k] || 0) + v; });
  botSide.turns += g.turn.n;
  const sc = E.scores(g), top = Math.max(...sc);
  sc.forEach((x, i) => { if (x === top) botSide.seatWins[i + 1] = (botSide.seatWins[i + 1] || 0) + 1; });
  botSide.mergers.push(g.stats.mergers.length); botSide.goals.push(g.stats.goals ? g.stats.goals.length : 0);
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const per = (side, k) => (side.turns ? (side.moves[k] || 0) / side.turns : 0);
console.log(`\n${recs.length} recorded game${recs.length > 1 ? "s" : ""} vs ${BOTS} bot games, ${players} players, same rules\n`);
console.log("per turn             people   bots");
for (const k of ["track", "station", "invest", "div", "draw", "merge"]) console.log(`  ${k.padEnd(18)} ${per(human, k).toFixed(2).padStart(6)} ${per(botSide, k).toFixed(2).padStart(6)}`);
console.log(`merges per game      ${mean(human.mergers).toFixed(2).padStart(6)} ${mean(botSide.mergers).toFixed(2).padStart(6)}`);
console.log(`goals per game       ${mean(human.goals).toFixed(2).padStart(6)} ${mean(botSide.goals).toFixed(2).padStart(6)}`);
console.log("wins by seat         " + Array.from({ length: players }, (_, i) => `${i + 1}: ${human.seatWins[i + 1] || 0}/${recs.length}`).join("  ") +
            "   bots " + Array.from({ length: players }, (_, i) => `${(((botSide.seatWins[i + 1] || 0) / BOTS) * 100).toFixed(0)}%`).join(" "));
if (recs.length < 10) console.log("\nWith fewer than about 10 recorded games, treat the people's numbers as anecdotes.");
fs.mkdirSync("sim/out", { recursive: true });
fs.writeFileSync("sim/out/replay.json", JSON.stringify({ human, bots: botSide, settings }, null, 1));
