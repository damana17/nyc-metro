/*  Cross-checks the sim engine against the app's own rule functions on thousands of random
 *  positions. If this fails, the simulation is not simulating the game in the app. */
import * as App from "../src/lib/game.jsx";
import * as E from "./engine.mjs";

const toApp = (g) => ({
  map: App.seedMap(),
  track: Object.fromEntries([...g.track].map(([k, l]) => [k, [l]])),
  stations: Object.fromEntries([...g.stations].map(([h, l]) => [h, { o: l }])),
  settings: g.S, prices: Object.fromEntries(g.prices.map((p, l) => [l, p])), sold: Object.fromEntries(g.sold.map((p, l) => [l, p])),
});

/* the component's `legal` memo, verbatim apart from taking its inputs as arguments */
function appLegal(state, S, map, lid) {
  const out = {};
  const net = App.lineNet(state, lid), deg = App.lineDegree(state, lid);
  const cap = (h) => (state.stations[h]?.o === lid ? S.branchAt : 2);
  net.forEach((h) => {
    if ((deg[h] || 0) >= cap(h)) return;
    const [c, r] = App.parseId(h);
    App.neighbors(c, r).forEach(([nc, nr]) => {
      const m = `${nc},${nr}`;
      if (!map.hexes[m]) return;
      const k = App.edgeKey(h, m);
      if ((map.nocross || []).includes(k)) return;
      if (state.track[k]) return;
      if ((deg[m] || 0) >= cap(m)) return;
      let toll = [];
      if (S.crossMode !== "free") {
        const foreign = new Set();
        [h, m].forEach((x) => { if (!state.stations[x]) App.occupants(state, x).forEach((o) => { if (o !== lid) foreign.add(o); }); });
        if (foreign.size) {
          if (S.crossMode === "station") return;
          toll = S.crossPay === "own" ? [[lid, S.crossDiscs]] : [...foreign].map((o) => [o, S.crossDiscs]);
        }
      }
      const water = map.hexes[m] === "w" ? S.waterExtra : 0;
      out[k] = { toll, water, target: m };
    });
  });
  return out;
}

let checks = 0, fails = 0;
const eq = (a, b, what) => { checks++; if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; if (fails < 10) console.log("MISMATCH", what, a, b); } };

for (let seed = 1; seed <= 300; seed++) {
  const variants = [{}, { crossMode: "station" }, { crossPay: "own", crossDiscs: 2 }, { stationBase: 5, waterExtra: 1 }, { crossMode: "free" }];
  const g = E.newGame(variants[seed % variants.length], seed);
  const R = E.rng(seed * 7919);
  for (let step = 0; step < 120 && !g.over; step++) {
    // random legal build, ignoring the hand so positions get large
    const l = Math.floor(R() * E.NL);
    const opts = E.legalTrack(g, l);
    if (opts.length && R() < 0.75) { const o = opts[Math.floor(R() * opts.length)]; g.track.set(o.k, l); g.cache.fill(null); }
    else { const net = [...E.line(g, l).net].filter((h) => !g.stations.has(h)); if (net.length) { g.stations.set(net[Math.floor(R() * net.length)], l); g.cache.fill(null); } }
    if (R() < 0.3) g.sold[l]++;
    if (R() < 0.2) g.prices[l] += 3;
    if (step % 10) continue;
    const st = toApp(g), map = st.map;
    for (let x = 0; x < E.NL; x++) {
      eq(E.perShare(g, x), App.perShare(st, x), `perShare l${x}`);
      eq(E.priceOf(g, x), App.priceOf(st, x), `price l${x}`);
      eq(E.sharesLeft(g, x), App.sharesLeft(st, x), `left l${x}`);
      eq(E.countLinks(g, x), App.countLinks(st, x), `links l${x}`);
      eq(E.line(g, x).stations, App.stationsOf(st, x), `stations l${x}`);
      eq([...E.line(g, x).zones].sort(), [...App.zonesOf(st, x)].sort(), `zones l${x}`);
      const mine = Object.fromEntries(E.legalTrack(g, x).map((o) => [o.k, { toll: o.toll, water: o.water, target: o.to }]));
      const app = appLegal(st, g.S, map, x);
      eq(Object.keys(App.legalExtensions({ ...st, settings: g.S }, x)).sort(), Object.keys(app).sort(), `shared legalExtensions l${x}`);
      eq(Object.keys(mine).sort(), Object.keys(app).sort(), `legal edges l${x}`);
      Object.keys(app).forEach((k) => { if (mine[k]) eq(mine[k], app[k], `legal detail ${k}`); });
    }
    for (const h of E.HEXES.slice(0, 60)) {
      eq(E.stationCost(g, h), App.stationCost(st, h), `stationCost ${h}`);
      eq(E.nearestStation(g, h), App.nearestStation(st, h), `nearest ${h}`);
    }
    for (let n = 0; n < 6; n++) eq(E.burnCount(g, n), App.burnCount(st, n), `burn ${n}`);
  }
}
/* merges: the app's pendingMerges/applyMerge against the engine's checkMerges */
let mergeCases = 0;
for (let seed = 1; seed <= 400; seed++) {
  const g = E.newGame({ merges: false, mergeAt: 3 + (seed % 3), safeAt: seed % 2 ? 8 : 0 }, 50000 + seed);
  const R = E.rng(seed * 104729);
  for (let step = 0; step < 160; step++) {
    const l = Math.floor(R() * E.NL), opts = E.legalTrack(g, l);
    if (opts.length && R() < 0.6) { const o = opts[Math.floor(R() * opts.length)]; g.track.set(o.k, l); g.cache.fill(null); }
    else { const net = [...E.line(g, l).net].filter((h) => !g.stations.has(h)); if (net.length) { g.stations.set(net[Math.floor(R() * net.length)], l); g.cache.fill(null); } }
  }
  g.players.forEach((p, i) => { for (let l = 0; l < E.NL; l++) p.shares[l] = Math.floor(R() * 4); p.cash = 100 + i; });
  for (let l = 0; l < E.NL; l++) { g.prices[l] = 10 + Math.floor(R() * 30); g.sold[l] = g.players.reduce((a, p) => a + p.shares[l], 0); }
  const st = toApp(g);
  st.players = g.players.map((p) => ({ id: p.id, name: "P" + p.id, cash: p.cash, shares: Object.fromEntries(p.shares.map((n, l) => [l, n])), hand: p.hand.flatMap((n, c) => Array(n).fill(c)) }));
  st.bag = g.bag.flatMap((n, c) => Array(n).fill(c)); st.onboard = []; st.turn = { round: 1 };
  if (!App.pendingMerges(st).length) continue;
  mergeCases++;
  for (let guard = 0; guard < 7; guard++) { const m = App.pendingMerges(st); if (!m.length) break; App.applyMerge(st, m[0].a, m[0].d); }
  g.S = { ...g.S, merges: true }; E.checkMerges(g, -1);
  eq(st.players.map((p) => p.cash), g.players.map((p) => p.cash), `merge cash seed ${seed}`);
  eq(Object.fromEntries(Object.entries(st.track).map(([k, v]) => [k, v[0]])), Object.fromEntries(g.track), `merge track seed ${seed}`);
  eq(Object.fromEntries(Object.entries(st.stations).map(([h, v]) => [h, v.o])), Object.fromEntries(g.stations), `merge stations seed ${seed}`);
  eq([...(st.defunct || [])].sort(), g.dead.map((d, l) => (d ? l : -1)).filter((l) => l >= 0).sort(), `merge defunct seed ${seed}`);
  eq(st.players.map((p) => Array.from({ length: E.NL }, (_, c) => p.hand.filter((x) => x === c).length)), g.players.map((p) => p.hand), `merge hands seed ${seed}`);
}
console.log(`merge cases compared: ${mergeCases}`);

/* events: same deck, and the same event-adjusted dividends, in the app and the engine */
eq(Object.fromEntries(Object.entries(App.EVENTS).map(([k, v]) => [k, v.n])), Object.fromEntries(Object.entries(E.EVENTS).map(([k, v]) => [k, v.n])), "events deck composition");
for (let seed = 1; seed <= 300; seed++) {
  const g = E.newGame({}, 70000 + seed), R = E.rng(seed * 31);
  for (let step = 0; step < 80; step++) {
    const l = Math.floor(R() * E.NL), opts = E.legalTrack(g, l);
    if (opts.length && R() < 0.6) { const o = opts[Math.floor(R() * opts.length)]; g.track.set(o.k, l); g.cache.fill(null); }
    else { const net = [...E.line(g, l).net].filter((h) => !g.stations.has(h)); if (net.length) { g.stations.set(net[Math.floor(R() * net.length)], l); g.cache.fill(null); } }
  }
  g.players.forEach((p) => { for (let l = 0; l < E.NL; l++) p.shares[l] = Math.floor(R() * 3); p.cash = 100; });
  g.mods = { strike: R() < 0.5 ? Math.floor(R() * E.NL) : undefined, boom: R() < 0.5, divMult: R() < 0.3 ? 0.5 : undefined };
  const st = toApp(g);
  st.players = g.players.map((p) => ({ id: p.id, cash: p.cash, shares: Object.fromEntries(p.shares.map((n, l) => [l, n])), hand: [] }));
  st.mods = { ...g.mods };
  App.payDividends(st); E.payDividends(g);
  eq(st.players.map((p) => p.cash), g.players.map((p) => p.cash), `event dividends seed ${seed}`);
  eq(Array.from({ length: E.NL }, (_, l) => st.prices[l]), g.prices, `event prices seed ${seed}`);
}
console.log(`verify: ${checks} checks, ${fails} mismatches`);
process.exit(fails ? 1 : 0);
