/*  Experiments. Usage: node sim/.build/experiments.mjs <name> [games]
 *  Reads tuned weights from sim/out/theta.json, writes sim/out/<name>.json. */
import fs from "node:fs";
import * as E from "./engine.mjs";
import { playGame } from "./bots.mjs";
import { VARIANTS } from "./variants.mjs";

const TH = JSON.parse(fs.readFileSync("sim/out/theta.json"));
const theta = (scoring) => (TH[scoring] || TH.mtm).theta;
const tuned = (scoring, extra = {}) => ({ name: "tuned", kind: "greedy", theta: { ...theta(scoring), ...extra } });
const ARCH = {
  tuned: (sc) => tuned(sc),
  investor: (sc) => ({ ...tuned(sc), name: "investor", allow: ["draw", "invest", "div"] }),
  builder: (sc) => ({ ...tuned(sc), name: "builder", allow: ["draw", "track", "station", "div"] }),
  noDividends: (sc) => ({ ...tuned(sc), name: "noDividends", allow: ["draw", "track", "station", "invest"] }),
  selfish: (sc) => ({ ...tuned(sc), name: "selfish", theta: { ...theta(sc), lambda: 0 } }),
  random: () => ({ name: "random", kind: "random" }),
};

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const se = (p, n) => Math.sqrt(Math.max(p * (1 - p), 1e-9) / n);

/* everything we measure about one finished game */
function measure(g) {
  const S = g.S, n = g.players.length, sc = E.scores(g);
  const top = Math.max(...sc), winners = sc.map((x, i) => (x === top ? i : -1)).filter((i) => i >= 0);
  const sorted = [...sc].sort((a, b) => b - a);
  // where the wealth came from
  const parts = g.players.map((p) => {
    const ladder = S.scoring === "mtm" ? p.shares.reduce((a, k, l) => a + k * g.sold[l] * S.stepPerShare, 0) : 0;
    const shareVal = p.shares.reduce((a, k, l) => a + k * E.shareValue(g, l), 0);
    return { cash: p.cash, shareVal, ladder, div: p.divIncome, spent: p.spent, shares: p.shares.reduce((a, b) => a + b, 0) };
  });
  // leader by round (end of each full round)
  const H = g.stats.history.filter((h, i) => (i + 1) % n === 0);
  const leaders = H.map((h) => h.scores.indexOf(Math.max(...h.scores)));
  let changes = 0; for (let i = 1; i < leaders.length; i++) if (leaders[i] !== leaders[i - 1]) changes++;
  let lockRound = leaders.length; for (let i = leaders.length - 1; i >= 0; i--) { if (leaders[i] === winners[0]) lockRound = i + 1; else break; }
  // portfolios: how alike are players' holdings (mean pairwise cosine)
  let cos = [], k = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = g.players[i].shares, b = g.players[j].shares;
    const dot = a.reduce((x, v, l) => x + v * b[l], 0), na = Math.hypot(...a), nb = Math.hypot(...b);
    if (na && nb) cos.push(dot / (na * nb));
  }
  const lines = Array.from({ length: E.NL }, (_, l) => ({ st: E.line(g, l).stations, tr: E.line(g, l).edges.length, zn: E.line(g, l).zones.size, per: E.perShare(g, l), sold: g.sold[l], owners: g.players.filter((p) => p.shares[l] > 0).length }));
  return {
    scores: sc, winners, margin: (sorted[0] - sorted[1]) / Math.max(1, Math.abs(sorted[0])), parts,
    divCalls: g.stats.divCalls, actions: g.stats.actions, changes, lockRound, cos: mean(cos), lines,
    deadLines: lines.filter((x) => x.st <= 1 && x.tr === 0).length, unownedLines: lines.filter((x) => x.owners === 0).length,
    stations: lines.reduce((a, x) => a + x.st, 0), track: lines.reduce((a, x) => a + x.tr, 0), zonesCovered: new Set(lines.flatMap((x, l) => [...E.line(g, l).zones])).size,
    bagEnd: g.bag.reduce((a, b) => a + b, 0), burned: g.burned, handCapped: g.stats.handCapped, drawShort: g.stats.drawShort,
    traj: H.map((h) => h.scores),
    mergers: g.stats.mergers.length, mergeRounds: g.stats.mergers.map((m) => m.round), mergeBonus: g.stats.mergeBonus,
    contested: lines.filter((x) => x.owners >= 2).length,
    takeovers: g.stats.takeovers || 0, blocks: g.stats.blocks || 0, sells: g.stats.sells || 0,
  };
}

function summarize(ms, botNames) {
  const n = ms[0].scores.length, N = ms.length;
  const winBySeat = Array(n).fill(0), winByBot = {}, seatsByBot = {};
  ms.forEach((m) => { m.winners.forEach((w) => { winBySeat[w] += 1 / m.winners.length; }); });
  if (botNames) ms.forEach((m, gi) => botNames[gi].forEach((b, s) => {
    seatsByBot[b] = (seatsByBot[b] || 0) + 1;
    if (m.winners.includes(s)) winByBot[b] = (winByBot[b] || 0) + 1 / m.winners.length;
  }));
  const allParts = ms.flatMap((m) => m.parts);
  const winParts = ms.map((m) => m.parts[m.winners[0]]);
  const sumAct = {}; ms.forEach((m) => Object.entries(m.actions).forEach(([k, v]) => { sumAct[k] = (sumAct[k] || 0) + v; }));
  return {
    games: N,
    winBySeat: winBySeat.map((w) => w / N), winBySeatSE: se(1 / n, N),
    winRate: botNames ? Object.fromEntries(Object.keys(seatsByBot).map((b) => [b, { rate: (winByBot[b] || 0) / seatsByBot[b], seats: seatsByBot[b], se: se((winByBot[b] || 0) / seatsByBot[b], seatsByBot[b]) }])) : undefined,
    margin: { mean: mean(ms.map((m) => m.margin)), p10: pct(ms.map((m) => m.margin), 0.1), p50: pct(ms.map((m) => m.margin), 0.5), p90: pct(ms.map((m) => m.margin), 0.9) },
    score: { mean: mean(ms.flatMap((m) => m.scores)), winner: mean(winParts.map((p) => p.cash + p.shareVal)) },
    wealth: {
      cash: mean(allParts.map((p) => p.cash)), shareVal: mean(allParts.map((p) => p.shareVal)), ladder: mean(allParts.map((p) => p.ladder)),
      div: mean(allParts.map((p) => p.div)), spent: mean(allParts.map((p) => p.spent)), shares: mean(allParts.map((p) => p.shares)),
      winnerDiv: mean(winParts.map((p) => p.div)), winnerShares: mean(winParts.map((p) => p.shares)), winnerLadder: mean(winParts.map((p) => p.ladder)),
    },
    divCalls: mean(ms.map((m) => m.divCalls)),
    actionsPerGame: Object.fromEntries(Object.entries(sumAct).map(([k, v]) => [k, v / N])),
    leadChanges: mean(ms.map((m) => m.changes)), lockRound: mean(ms.map((m) => m.lockRound)),
    lockRoundDist: Array.from({ length: 21 }, (_, r) => ms.filter((m) => m.lockRound === r).length / N),
    portfolioCos: mean(ms.map((m) => m.cos)),
    stations: mean(ms.map((m) => m.stations)), track: mean(ms.map((m) => m.track)), zonesCovered: mean(ms.map((m) => m.zonesCovered)),
    deadLines: mean(ms.map((m) => m.deadLines)), unownedLines: mean(ms.map((m) => m.unownedLines)),
    perShareTop: mean(ms.map((m) => Math.max(...m.lines.map((x) => x.per)))), perShareMedian: mean(ms.map((m) => pct(m.lines.map((x) => x.per), 0.5))),
    lineSpread: mean(ms.map((m) => { const s = m.lines.map((x) => x.st).sort((a, b) => b - a); return s[0] - s[s.length - 1]; })),
    bagEnd: mean(ms.map((m) => m.bagEnd)), burned: mean(ms.map((m) => m.burned)), handCapped: mean(ms.map((m) => m.handCapped)), drawShort: mean(ms.map((m) => m.drawShort)),
  };
}

function run(settings, makeTable, N, seed0 = 1) {
  const ms = [], names = [];
  for (let i = 0; i < N; i++) {
    const bots = makeTable(i);
    const g = playGame(settings, seed0 + i, bots);
    ms.push(measure(g)); names.push(bots.map((b) => b.name));
  }
  return { ms, names };
}

const exps = {
  /* the game as it stands, every rule for the final score, tuned bots in every seat */
  baseline(N) {
    const out = {};
    for (const scoring of ["mtm", "base", "cash", "acq"]) {
      const { ms, names } = run({ scoring }, () => [0, 1, 2].map(() => tuned(scoring)), N, 1000);
      out[scoring] = summarize(ms, names);
      out[scoring].theta = theta(scoring);
      out[scoring].trajSample = ms.slice(0, 40).map((m) => ({ traj: m.traj, winners: m.winners }));
      out[scoring].perRoundMeanGap = Array.from({ length: 15 }, (_, r) => mean(ms.map((m) => { const s = m.traj[r]; if (!s) return 0; const o = [...s].sort((a, b) => b - a); return o[0] - o[1]; })));
      out[scoring].lineDist = { stations: Array.from({ length: 12 }, (_, k) => mean(ms.map((m) => m.lines.filter((x) => x.st === k).length))) };
      // how often the final winner was leading at the end of each round
      out[scoring].winnerLeading = Array.from({ length: 15 }, (_, r) => mean(ms.map((m) => { const s = m.traj[r]; return s && s.indexOf(Math.max(...s)) === m.winners[0] ? 1 : 0; })));
    }
    // competence check: tuned vs random
    const { ms, names } = run({ scoring: "base" }, (i) => { const t = [tuned("base"), tuned("base"), ARCH.random()]; const k = i % 3; return [t[k], t[(k + 1) % 3], t[(k + 2) % 3]]; }, N, 50000);
    out.vsRandom = summarize(ms, names).winRate;
    return out;
  },

  /* one archetype against two tuned bots, seats rotated */
  archetypes(N) {
    const out = {};
    for (const scoring of ["mtm", "base", "cash", "acq"]) {
      out[scoring] = {};
      for (const a of ["investor", "builder", "noDividends", "selfish", "tuned"]) {
        const { ms, names } = run({ scoring }, (i) => { const t = [ARCH[a](scoring), tuned(scoring), tuned(scoring)]; const k = i % 3; return [t[k], t[(k + 1) % 3], t[(k + 2) % 3]]; }, N, 7000);
        const s = summarize(ms, names);
        out[scoring][a] = { rate: s.winRate[a === "tuned" ? "tuned" : a]?.rate ?? 0, se: s.winRate[a]?.se ?? s.winBySeatSE, stations: s.stations, divCalls: s.divCalls };
      }
    }
    return out;
  },

  /* remedies for the first-seat advantage */
  seatfix(N) {
    const variants = [
      ["As designed (step $15)", {}],
      ["Step $10", { stepPerShare: 10 }], ["Step $5", { stepPerShare: 5 }], ["No step", { stepPerShare: 0 }],
      ["Later seats +$10 each", { seatCash: 10 }], ["Later seats +$20 each", { seatCash: 20 }], ["Later seats +$30 each", { seatCash: 30 }],
      ["Start player rotates", { rotateStart: true }],
      ["1 share in round 1", { firstRoundInvest: 1 }],
      ["2 shares per turn", { investPerTurn: 2 }], ["1 share per turn", { investPerTurn: 1 }],
      ["Rotate + step $10", { rotateStart: true, stepPerShare: 10 }],
      ["Rotate + 2 shares per turn", { rotateStart: true, investPerTurn: 2 }],
      ["1 share in round 1 + later seats +$10", { firstRoundInvest: 1, seatCash: 10 }],
    ];
    const out = {};
    for (const scoring of ["base", "cash"]) {
      out[scoring] = variants.map(([label, over]) => {
        const { ms, names } = run({ scoring, ...over }, () => [0, 1, 2].map(() => tuned(scoring)), N, 300000);
        const s = summarize(ms, names);
        return { label, over, seats: s.winBySeat, spread: Math.max(...s.winBySeat) - Math.min(...s.winBySeat), se: s.winBySeatSE,
                 leadChanges: s.leadChanges, lockRound: s.lockRound, margin: s.margin.p50, divShare: s.wealth.div / Math.max(1, s.score.mean), stations: s.stations };
      });
      process.stdout.write(`seatfix ${scoring} done\n`);
    }
    return out;
  },

  /* second round: combinations, larger samples */
  seatfix2(N) {
    const variants = [
      ["As designed", {}],
      ["Snake order", { snake: true }],
      ["Flat price in round 1", { flatRound1: true }],
      ["Snake + flat round 1", { snake: true, flatRound1: true }],
      ["1 share per turn + rotate", { investPerTurn: 1, rotateStart: true }],
      ["1 share per turn + snake", { investPerTurn: 1, snake: true }],
      ["2 shares per turn + snake", { investPerTurn: 2, snake: true }],
      ["1 share in round 1 + seats +$20", { firstRoundInvest: 1, seatCash: 20 }],
      ["1 share in round 1 + snake", { firstRoundInvest: 1, snake: true }],
      ["2 per turn + 1 in round 1 + snake", { investPerTurn: 2, firstRoundInvest: 1, snake: true }],
    ];
    const out = {};
    for (const scoring of ["base", "cash"]) {
      out[scoring] = variants.map(([label, over]) => {
        const { ms, names } = run({ scoring, ...over }, () => [0, 1, 2].map(() => tuned(scoring)), N, 400000);
        const s = summarize(ms, names);
        const p4 = run({ scoring, ...over, players: 4 }, () => [0, 1, 2, 3].map(() => tuned(scoring)), Math.round(N / 2), 450000);
        const s4 = summarize(p4.ms, p4.names);
        return { label, over, seats: s.winBySeat, spread: Math.max(...s.winBySeat) - Math.min(...s.winBySeat), se: s.winBySeatSE,
                 seats4: s4.winBySeat, spread4: Math.max(...s4.winBySeat) - Math.min(...s4.winBySeat),
                 leadChanges: s.leadChanges, lockRound: s.lockRound, margin: s.margin.p50, stations: s.stations, shares: s.wealth.shares, cos: s.portfolioCos };
      });
      process.stdout.write(`seatfix2 ${scoring} done\n`);
    }
    return out;
  },

  /* what merges and owned dividends do to the feel of the game */
  fun(N, only) {
    const out = {};
    for (const [v, { label, settings }] of Object.entries(VARIANTS).filter(([k]) => !only || k === only)) {
      const th = JSON.parse(fs.readFileSync(`sim/out/theta-${v}.json`)).theta;
      const greedy = { name: "greedy", kind: "greedy", theta: th };
      const { ms, names } = run(settings, () => [greedy, greedy, greedy], N, 600000);
      const s = summarize(ms, names);
      const lead = (r) => mean(ms.map((m) => { const x = m.traj[r - 1]; return x && x.indexOf(Math.max(...x)) === m.winners[0] ? 1 : 0; }));
      const look = { name: "lookahead", kind: "lookahead", theta: th, oppTheta: th, K: 4 };
      const L = run(settings, (i) => { const t = [look, greedy, greedy]; const k = i % 3; return [t[k], t[(k + 1) % 3], t[(k + 2) % 3]]; }, Math.round(N / 2), 700000);
      const sl = summarize(L.ms, L.names);
      out[v] = {
        label, settings, theta: th, games: N,
        seats: s.winBySeat, leadChanges: s.leadChanges, lockRound: s.lockRound, margin: s.margin.p50,
        winnerAheadR5: lead(5), winnerAheadR10: lead(10),
        mergers: mean(ms.map((m) => m.mergers)), gamesWithMerge: mean(ms.map((m) => (m.mergers ? 1 : 0))),
        firstMergeRound: mean(ms.filter((m) => m.mergers).map((m) => m.mergeRounds[0])),
        mergeBonusShare: mean(ms.map((m) => m.mergeBonus)) / Math.max(1, s.score.mean * 3),
        divShare: s.wealth.div / Math.max(1, s.score.mean), contested: mean(ms.map((m) => m.contested)), cos: s.portfolioCos,
        stations: s.stations, track: s.track, divCalls: s.divCalls,
        lookaheadWin: sl.winRate.lookahead.rate, lookaheadSE: sl.winRate.lookahead.se, lookaheadGames: L.ms.length,
        winnerLeading: Array.from({ length: 15 }, (_, r) => lead(r + 1)),
        takeovers: mean(ms.map((m) => m.takeovers)), blocks: mean(ms.map((m) => m.blocks)), sells: mean(ms.map((m) => m.sells)),
        lookaheadMargin: sl.winRate.lookahead.rate - 1 / 3,
      };
      process.stdout.write(`fun ${v} done\n`);
    }
    return out;
  },

  /* one knob at a time, under a given scoring rule (argv[4]), tuned bots everywhere */
  sweep(N, scoring = "base") {
    const knobs = {
      stationBase: [2, 3, 4, 5, 6], stepPerShare: [0, 5, 10, 15, 20], drawCount: [2, 3, 4, 5], apPerTurn: [3, 4, 5, 6],
      startCash: [30, 60, 100, 150], perZone: [0, 1, 2], perStation: [1, 2], crossMode: ["free", "cost", "station"],
      roundLimit: [10, 12, 15, 20], investPerTurn: [1, 2, 3], priceGrowth: [0, 1, 2], handLimit: [6, 8, 10, 14], players: [3, 4, 5],
    };
    const out = { scoring, knobs: {} };
    for (const [k, vals] of Object.entries(knobs)) {
      out.knobs[k] = vals.map((v) => {
        const settings = { scoring, [k]: v };
        const np = k === "players" ? v : 3;
        const { ms, names } = run(settings, () => Array.from({ length: np }, () => tuned(scoring)), N, 90000);
        const s = summarize(ms, names);
        // free-rider index: investor archetype against tuned bots under this setting
        const inv = run(settings, (i) => { const t = [ARCH.investor(scoring), ...Array.from({ length: np - 1 }, () => tuned(scoring))]; const r = i % np; return [...t.slice(np - r), ...t.slice(0, np - r)]; }, Math.round(N / 2), 120000);
        const si = summarize(inv.ms, inv.names);
        return { value: v, firstSeat: s.winBySeat[0], lastSeat: s.winBySeat[np - 1], fair: 1 / np, margin: s.margin.p50, leadChanges: s.leadChanges, lockRound: s.lockRound,
                 stations: s.stations, track: s.track, zonesCovered: s.zonesCovered, divCalls: s.divCalls, divShare: s.wealth.div / Math.max(1, s.score.mean),
                 deadLines: s.deadLines, unownedLines: s.unownedLines, cos: s.portfolioCos, shares: s.wealth.shares, bagEnd: s.bagEnd, burned: s.burned,
                 investorRate: si.winRate.investor?.rate ?? 0, actions: s.actionsPerGame };
      });
      process.stdout.write(`sweep ${k} done\n`);
    }
    return out;
  },
};

const name = process.argv[2], N = Number(process.argv[3] || 500);
const res = exps[name](N, process.argv[4]);
fs.mkdirSync("sim/out", { recursive: true });
fs.writeFileSync(`sim/out/${name}${process.argv[4] ? "-" + process.argv[4] : ""}.json`, JSON.stringify(res, null, 1));
console.log(`${name} done`);
