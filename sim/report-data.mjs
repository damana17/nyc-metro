/*  Turns sim/out/*.json into the small row files the report page draws.
 *  node sim/report-data.mjs  ->  sim/report/*.json, each {rows, meta}. */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const self = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
const J = (f) => JSON.parse(fs.readFileSync(`sim/out/${f}.json`));
const REPO = "https://github.com/damana17/nyc-metro/tree/main/sim";
const meta = (made, extra = []) => [
  { label: "Made by", value: made }, ...extra,
  { label: "Simulator", value: REPO },
  { label: "report-data.mjs", value: self, type: "code", lang: "javascript" },
];
const out = {};
const r3 = (x) => Math.round(x * 1000) / 1000;
const RULE = { mtm: "Tally (price ladder)", base: "Base price", cash: "Cash only", acq: "Majority bonuses" };

const B = J("baseline");
const n = (k) => B[k].games;
out.seats = { rows: Object.keys(RULE).flatMap((k) => B[k].winBySeat.map((w, i) => ({ rule: RULE[k], ruleKey: k, seat: `Seat ${i + 1}`, seatNo: i + 1, win: r3(w), games: n(k) }))),
  meta: meta("node sim/.build/experiments.mjs baseline 1000", [{ label: "Games", value: "1,000 per scoring rule, 3 players, tuned bots in every seat" }]) };

out.shape = { rows: Object.keys(RULE).map((k) => ({ rule: RULE[k], ruleKey: k, leadChanges: r3(B[k].leadChanges), lockRound: r3(B[k].lockRound), margin: r3(B[k].margin.p50),
  divCalls: r3(B[k].divCalls), stations: r3(B[k].stations), track: r3(B[k].track), shares: r3(B[k].wealth.shares), firstSeat: r3(B[k].winBySeat[0]),
  ladderShare: r3(B[k].wealth.ladder / Math.max(1, B[k].wealth.cash + B[k].wealth.shareVal)), divShare: r3(B[k].wealth.div / Math.max(1, B[k].score.mean)) })),
  meta: meta("node sim/.build/experiments.mjs baseline 1000") };

out.leading = { rows: Object.keys(RULE).flatMap((k) => B[k].winnerLeading.map((v, r) => ({ rule: RULE[k], ruleKey: k, round: r + 1, leading: r3(v) }))),
  meta: meta("node sim/.build/experiments.mjs baseline 1000", [{ label: "Measure", value: "Share of games in which the eventual winner was leading at the end of each round, by that rule's own score" }]) };

const A = J("archetypes");
const ARCH = { investor: "Never builds", noDividends: "Never calls dividends", selfish: "Ignores rivals", builder: "Never buys shares", tuned: "Tuned bot (reference)" };
out.archetypes = { rows: Object.keys(RULE).flatMap((k) => Object.keys(ARCH).map((a) => ({ rule: RULE[k], ruleKey: k, archetype: ARCH[a], key: a, win: r3(A[k][a].rate), se: r3(A[k][a].se) }))),
  meta: meta("node sim/.build/experiments.mjs archetypes 600", [{ label: "Games", value: "600 per cell: one archetype against two tuned bots, seats rotated. A fair share is 33%." }]) };

const F1 = J("seatfix"), F2 = fs.existsSync("sim/out/seatfix2.json") ? J("seatfix2") : null;
const fixRows = [];
for (const [rule, rows] of Object.entries(F1)) rows.filter((r) => !(F2 && r.label.startsWith("As designed"))).forEach((r) => fixRows.push({ rule: RULE[rule], ruleKey: rule, fix: r.label, seat1: r3(r.seats[0]), seat2: r3(r.seats[1]), seat3: r3(r.seats[2]), spread: r3(r.spread), games: 600, batch: 1 }));
if (F2) for (const [rule, rows] of Object.entries(F2)) rows.forEach((r) => {
  const i = fixRows.findIndex((x) => x.ruleKey === rule && x.fix === r.label);
  const row = { rule: RULE[rule], ruleKey: rule, fix: r.label, seat1: r3(r.seats[0]), seat2: r3(r.seats[1]), seat3: r3(r.seats[2]), spread: r3(r.spread), games: 1000, batch: 2,
                spread4: r3(r.spread4), p4seat1: r3(r.seats4[0]), p4seat4: r3(r.seats4[3]) };
  if (i >= 0) fixRows[i] = row; else fixRows.push(row);
});
out.fixes = { rows: fixRows, meta: meta("node sim/.build/experiments.mjs seatfix 600; node sim/.build/experiments.mjs seatfix2 1000", [{ label: "Spread", value: "Best seat's win rate minus worst seat's. 0 is perfectly fair." }]) };

const knobRows = [];
for (const rule of ["base", "cash"]) {
  const S = J(`sweep-${rule}`);
  for (const [knob, vals] of Object.entries(S.knobs)) vals.forEach((v) => knobRows.push({
    rule: RULE[rule], ruleKey: rule, knob, value: String(v.value), firstSeat: r3(v.firstSeat), lastSeat: r3(v.lastSeat), fair: r3(v.fair),
    stations: r3(v.stations), track: r3(v.track), zones: r3(v.zonesCovered), divCalls: r3(v.divCalls), leadChanges: r3(v.leadChanges),
    lockRound: r3(v.lockRound), margin: r3(v.margin), deadLines: r3(v.deadLines), similarity: r3(v.cos), shares: r3(v.shares), bagEnd: r3(v.bagEnd), neverBuilds: r3(v.investorRate),
  }));
}
out.knobs = { rows: knobRows, meta: meta("node sim/.build/experiments.mjs sweep 300 base; ... sweep 300 cash", [{ label: "Games", value: "300 per setting with tuned bots, plus 150 with a never-builds bot. One setting changed at a time from the app's defaults." }]) };

// the Tally probe, recomputed here from the rules so it needs no run
const probe = [];
for (let k = 1; k <= 8; k++) {
  // buying share k costs 10 + 15(k-1); under the ladder every held share is then valued at 10 + 15k
  const paid = Array.from({ length: k }, (_, i) => 10 + 15 * i).reduce((a, b) => a + b, 0);
  probe.push({ shares: k, rule: "Tally (price ladder)", change: k * (10 + 15 * k) - paid }, { shares: k, rule: "Base price", change: k * 10 - paid });
}
out.tally = { rows: probe, meta: meta("Arithmetic from the app's priceOf(): price = base + sold × $15; checked against sim/probe.mjs", [{ label: "Setup", value: "One player buys 1 to 8 shares of a line that has never paid a dividend, nobody else buys" }]) };

fs.mkdirSync("sim/report", { recursive: true });
for (const [k, v] of Object.entries(out)) fs.writeFileSync(`sim/report/${k}.json`, JSON.stringify(v));
console.log(Object.keys(out).map((k) => `${k}: ${out[k].rows.length} rows`).join("\n"));
