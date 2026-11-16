/*  Headless V2 (Influence) engine for simulation.
 *
 *  The rules are the app's "enforce rules" mode with "spend action points automatically" on
 *  (GameInfluence.jsx: onHex / drawDiscs / invest / callDividends / endTurn, and the pure
 *  helpers in src/lib/game.jsx). Map, zones, geometry and the default settings are imported
 *  from the app itself, so the board cannot drift. verify.mjs cross-checks the derived numbers
 *  (dividend per share, price, station cost, links) against the app's own functions.
 *
 *  Things the app leaves to the table, and how this engine settles them (all switchable):
 *   - Investing and calling dividends share one "market slot" per turn: a turn may invest
 *     (up to investPerTurn shares, 1 AP for the lot) OR call dividends (1 AP), not both.
 *   - The game ends after roundLimit full rounds.
 *   - Final score: see SCORING below. The app's Tally uses "mtm".
 */
import { SEED_HEX, SEED_NAMES, SEED_NOCROSS, ZONE_OF, LINES, V2D, neighbors, hexDist } from "../src/lib/game.jsx";

export const NL = LINES.length;

/* ── the board, precomputed ────────────────────────────────────────── */
const HEX = {};
SEED_HEX.split(";").forEach((s) => { const [c, r, k] = s.split(" "); HEX[`${c},${r}`] = k; });
export const HEXES = Object.keys(HEX);
export const TYPE = HEX;
export const NAMES = SEED_NAMES;
export const NBR = {};
HEXES.forEach((h) => { const [c, r] = h.split(",").map(Number); NBR[h] = neighbors(c, r).map(([a, b]) => `${a},${b}`).filter((x) => HEX[x]); });
export const ekey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);   // same as edgeKey: [a,b].sort().join("|")
const NOCROSS = new Set(SEED_NOCROSS);
export const ZONE = ZONE_OF;
const DIST = {};
HEXES.forEach((a) => { DIST[a] = {}; HEXES.forEach((b) => { DIST[a][b] = hexDist(a, b); }); });
export const dist = (a, b) => DIST[a][b];
export const NAMED = Object.keys(SEED_NAMES).filter((h) => HEX[h]);

/* ── rng ───────────────────────────────────────────────────────────── */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ── state ─────────────────────────────────────────────────────────── */
export const DEFAULTS = { ...V2D, strict: true, autoAP: true, players: 3, scoring: "mtm", majBonus: 5, minBonus: 2,
  seatCash: 0,          // extra starting cash per seat after the first (seat k gets k × this)
  firstRoundInvest: 0,  // if set, the share limit in round 1
  rotateStart: false,   // the start player moves one seat left each round
  snake: false,         // turn order reverses every round: 1-2-3, 3-2-1, 1-2-3 ...
  flatRound1: false,    // in round 1 every share costs the starting price (the step starts counting from round 2)
  /* merges (designed, not yet in the app): when two lines' networks touch and both have at least
     mergeAt stations, the line with more stations absorbs the other. The absorbed line's majority and
     minority holders get majBonus× / minBonus× its base price, then every holder sells its shares to
     the bank at that price. Its track, stations and disc colour become the acquirer's. */
  merges: false, mergeAt: 4,
  safeAt: 0,            // if set, a line with this many stations can never be absorbed (Acquire's "safe" chain)
  /* owned dividends: the caller names ONE line; only that line pays and only its price rises */
  divOne: false,
};

export function newGame(over = {}, seed = 1) {
  const S = { ...DEFAULTS, ...over };
  const R = rng(seed);
  const bag = LINES.map((l) => l.discs);
  const g = {
    S, R, seed,
    track: new Map(), stations: new Map(),
    bag, burned: 0, onboard: Array(NL).fill(0),
    players: [], prices: Array(NL).fill(S.startPrice), sold: Array(NL).fill(0),
    turn: { active: 0, ap: S.apPerTurn, round: 1, invests: 0, usedSlot: false, n: 0, k: 0, start: 0 },
    over: false, ver: 0, cache: Array(NL).fill(null), dead: Array(NL).fill(false),
    stats: { divCalls: 0, actions: {}, divPaid: 0, history: [], handCapped: 0, drawShort: 0, mergers: [], mergeBonus: 0 },
  };
  for (let i = 0; i < S.players; i++) {
    const p = { id: i, cash: S.startCash + (S.seatCash ? S.seatCash * i : 0), hand: Array(NL).fill(0), shares: Array(NL).fill(0), divIncome: 0, spent: 0 };
    for (let k = 0; k < S.startingHand; k++) { const d = drawDisc(g); if (d < 0) break; p.hand[d]++; }
    g.players.push(p);
  }
  // each line starts with one station on a distinct named location
  const picks = [...NAMED];
  for (let i = picks.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [picks[i], picks[j]] = [picks[j], picks[i]]; }
  for (let l = 0; l < NL; l++) g.stations.set(picks[l], l);
  return g;
}

export function drawDisc(g) {
  const tot = g.bag.reduce((a, b) => a + b, 0);
  if (!tot) return -1;
  let x = Math.floor(g.R() * tot);
  for (let l = 0; l < NL; l++) { if (x < g.bag[l]) { g.bag[l]--; return l; } x -= g.bag[l]; }
  return -1;
}
export const handSize = (p) => p.hand.reduce((a, b) => a + b, 0);
const touch = (g) => { g.ver++; g.cache.fill(null); };

/* ── derived, per line (cached until the board changes) ────────────── */
export function line(g, l) {
  if (g.cache[l]) return g.cache[l];
  const net = new Set(), deg = {}, edges = [];
  for (const [h, o] of g.stations) if (o === l) net.add(h);
  for (const [k, o] of g.track) if (o === l) { edges.push(k); const [a, b] = k.split("|"); net.add(a); net.add(b); deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1; }
  let st = 0; for (const o of g.stations.values()) if (o === l) st++;
  const zones = new Set(); net.forEach((h) => { const z = ZONE[h]; if (z !== undefined) zones.add(z); });
  let sites = 0; net.forEach((h) => { if (!g.stations.has(h)) sites++; });
  const c = { net, deg, edges, stations: st, zones, sites };
  g.cache[l] = c;
  return c;
}
export const perShare = (g, l) => line(g, l).stations * g.S.perStation + line(g, l).zones.size * g.S.perZone;
export const priceOf = (g, l) => g.prices[l] + (g.S.flatRound1 ? (g.turn.round === 1 ? 0 : g.sold[l]) : g.sold[l]) * g.S.stepPerShare;
export const sharesLeft = (g, l) => g.S.sharesPerLine - g.sold[l];

export function occupants(g, h) {
  const out = new Set();
  for (const [k, o] of g.track) { const [a, b] = k.split("|"); if (a === h || b === h) out.add(o); }
  return out;
}
export function countLinks(g, l) {
  const { edges } = line(g, l);
  if (!edges.length) return 0;
  const adj = {};
  edges.forEach((k) => { const [a, b] = k.split("|"); (adj[a] = adj[a] || []).push(k); (adj[b] = adj[b] || []).push(k); });
  const seen = new Set(); let n = 0;
  for (const e0 of edges) {
    if (seen.has(e0)) continue;
    n++; const stack = [e0];
    while (stack.length) {
      const e = stack.pop(); if (seen.has(e)) continue; seen.add(e);
      for (const h of e.split("|")) { if (g.stations.get(h) === l) continue; for (const e2 of adj[h] || []) if (!seen.has(e2)) stack.push(e2); }
    }
  }
  return n;
}
export function nearestStation(g, id) {
  let d = null;
  for (const h of g.stations.keys()) { if (h === id) continue; const x = DIST[id][h]; if (d === null || x < d) d = x; }
  return d;
}
export const stationCost = (g, id) => { const d = nearestStation(g, id); return Math.max(g.S.stationMin, g.S.stationBase - (d === null ? 0 : d)); };
export const burnCount = (g, n) => { const raw = n * g.S.burnFrac; return g.S.burnRound === "up" ? Math.ceil(raw) : Math.floor(raw); };

/* legal extensions of line l — a port of GameInfluence's `legal` memo */
export function legalTrack(g, l) {
  const S = g.S, { net, deg } = line(g, l), out = [];
  const cap = (h) => (g.stations.get(h) === l ? S.branchAt : 2);
  for (const h of net) {
    if ((deg[h] || 0) >= cap(h)) continue;
    for (const m of NBR[h]) {
      const k = ekey(h, m);
      if (NOCROSS.has(k) || g.track.has(k)) continue;
      if ((deg[m] || 0) >= cap(m)) continue;
      let toll = [];
      if (S.crossMode !== "free") {
        const foreign = new Set();
        for (const x of [h, m]) if (!g.stations.has(x)) occupants(g, x).forEach((o) => { if (o !== l) foreign.add(o); });
        if (foreign.size) {
          if (S.crossMode === "station") continue;
          toll = S.crossPay === "own" ? [[l, S.crossDiscs]] : [...foreign].map((o) => [o, S.crossDiscs]);
        }
      }
      const water = TYPE[m] === "w" ? S.waterExtra : 0;
      out.push({ k, from: h, to: m, toll, water });
    }
  }
  return out;
}
/* discs needed, as a per-colour array */
export function trackNeed(l, info) {
  const need = Array(NL).fill(0);
  need[l] += 1 + info.water;
  info.toll.forEach(([c, n]) => { need[c] += n; });
  return need;
}
export const canPayArr = (p, need) => need.every((n, c) => p.hand[c] >= n);

/* ── markers (one disc per link, drawn from the bag) ───────────────── */
function syncMarkers(g) {
  if (g.S.ownership !== "link") return;
  let want = 0; for (let l = 0; l < NL; l++) want += countLinks(g, l);
  let on = g.onboard.reduce((a, b) => a + b, 0);
  while (on < want) { const d = drawDisc(g); if (d < 0) break; g.onboard[d]++; on++; }
  while (on > want) { const c = g.onboard.findIndex((x) => x > 0); g.onboard[c]--; g.bag[c]++; on--; }
}

/* ── actions ───────────────────────────────────────────────────────── *
 *  {t:"track", l, k, from, to, toll, water}  {t:"station", l, h}  {t:"draw"}
 *  {t:"invest", l, wild, pay?:[colours]}  {t:"div"}  {t:"end"}
 */
export const cur = (g) => g.players[g.turn.active];

export function canDo(g, a) {
  const p = cur(g), T = g.turn, S = g.S;
  if (g.over) return false;
  if (a.t === "end") return true;
  if (a.t === "invest") {
    if (T.invests >= (T.round === 1 && S.firstRoundInvest ? S.firstRoundInvest : S.investPerTurn)) return false;
    if (!T.usedSlot && T.ap < 1) return false;
    if (T.usedSlot && T.invests === 0) return false;       // the slot went to dividends
  } else if (T.ap < 1) return false;
  switch (a.t) {
    case "track": return canPayArr(p, trackNeed(a.l, a));
    case "station": {
      if (g.stations.has(a.h) || !line(g, a.l).net.has(a.h)) return false;
      return p.hand[a.l] >= stationCost(g, a.h);
    }
    case "draw": return true;
    case "invest": {
      if (g.dead[a.l] || sharesLeft(g, a.l) <= 0 || p.cash < priceOf(g, a.l)) return false;
      if (a.wild) return handSize(p) >= S.wildCost;
      return p.hand[a.l] >= 1;
    }
    case "div": return !T.usedSlot && (!S.divOne || (a.l !== undefined && !g.dead[a.l]));
  }
  return false;
}

export function apply(g, a) {
  const p = cur(g), T = g.turn, S = g.S;
  g.stats.actions[a.t] = (g.stats.actions[a.t] || 0) + 1;
  switch (a.t) {
    case "track": {
      const need = trackNeed(a.l, a);
      need.forEach((n, c) => { p.hand[c] -= n; g.bag[c] += n; });
      g.track.set(a.k, a.l); touch(g); syncMarkers(g);
      if (S.merges) checkMerges(g, a.l);
      T.ap -= 1; break;
    }
    case "station": {
      const c = stationCost(g, a.h), burn = Math.min(c, burnCount(g, c));
      p.hand[a.l] -= c; g.burned += burn; g.bag[a.l] += c - burn;
      g.stations.set(a.h, a.l); touch(g); syncMarkers(g);
      if (S.merges) checkMerges(g, a.l);
      T.ap -= 1; break;
    }
    case "draw": {
      let got = 0;
      for (let i = 0; i < S.drawCount; i++) {
        if (handSize(p) >= S.handLimit) { g.stats.handCapped++; break; }
        const d = drawDisc(g); if (d < 0) { g.stats.drawShort++; break; }
        p.hand[d]++; got++;
      }
      T.ap -= 1; break;
    }
    case "invest": {
      const price = priceOf(g, a.l);
      if (a.wild) {
        // pay with the colours given, else the most plentiful
        const pay = a.pay ? [...a.pay] : [];
        while (pay.length < S.wildCost) { let best = -1; for (let c = 0; c < NL; c++) if (p.hand[c] - pay.filter((x) => x === c).length > 0 && (best < 0 || p.hand[c] > p.hand[best])) best = c; pay.push(best); }
        pay.forEach((c) => { p.hand[c]--; g.bag[c]++; });
      } else { p.hand[a.l]--; g.bag[a.l]++; }
      p.cash -= price; p.spent += price; p.shares[a.l]++; g.sold[a.l]++;
      if (!T.usedSlot) { T.usedSlot = true; T.ap -= 1; }
      T.invests++; break;
    }
    case "div": {
      const ps = []; for (let l = 0; l < NL; l++) ps.push(S.divOne && l !== a.l ? 0 : perShare(g, l));
      g.players.forEach((q) => { let paid = 0; for (let l = 0; l < NL; l++) paid += q.shares[l] * ps[l]; q.cash += paid; q.divIncome += paid; g.stats.divPaid += paid; });
      for (let l = 0; l < NL; l++) g.prices[l] += Math.round(ps[l] * S.priceGrowth);
      g.stats.divCalls++;
      T.usedSlot = true; T.ap -= 1; break;
    }
    case "end": endTurn(g); return;
  }
}

/* does line l touch another live line that is also big enough? merge until nothing qualifies */
export function checkMerges(g, l) {
  for (let guard = 0; guard < NL; guard++) {
    let pair = null;
    for (let a = 0; a < NL && !pair; a++) {
      if (g.dead[a] || line(g, a).stations < g.S.mergeAt) continue;
      for (let b = a + 1; b < NL; b++) {
        if (g.dead[b] || line(g, b).stations < g.S.mergeAt) continue;
        const na = line(g, a).net, nb = line(g, b).net;
        let touchHex = false; for (const h of na) if (nb.has(h)) { touchHex = true; break; }
        if (touchHex && g.S.safeAt && line(g, a).stations >= g.S.safeAt && line(g, b).stations >= g.S.safeAt) continue;
        if (touchHex) { pair = [a, b]; break; }
      }
    }
    if (!pair) return;
    const [a, b] = pair, A = line(g, a), B = line(g, b);
    const big = A.stations !== B.stations ? (A.stations > B.stations ? a : b)
              : A.edges.length !== B.edges.length ? (A.edges.length > B.edges.length ? a : b)
              : (a === l ? a : b === l ? b : a);
    merge(g, big, big === a ? b : a);
  }
}
export function merge(g, A, D) {
  const S = g.S, P = g.prices[D];
  // Acquire-style bonuses to the absorbed line's holders
  const hold = g.players.map((p) => p.shares[D]);
  const top = Math.max(...hold);
  if (top > 0) {
    const firsts = hold.map((h, i) => (h === top ? i : -1)).filter((i) => i >= 0);
    const pay = (i, amt) => { g.players[i].cash += amt; g.stats.mergeBonus += amt; };
    if (firsts.length > 1) firsts.forEach((i) => pay(i, Math.round((S.majBonus + S.minBonus) * P / firsts.length)));
    else {
      pay(firsts[0], S.majBonus * P);
      const rest = hold.map((h, i) => (i === firsts[0] ? -1 : h)), sec = Math.max(...rest);
      if (sec > 0) { const secs = rest.map((h, i) => (h === sec ? i : -1)).filter((i) => i >= 0); secs.forEach((i) => pay(i, Math.round(S.minBonus * P / secs.length))); }
      else pay(firsts[0], S.minBonus * P);
    }
  }
  g.players.forEach((p) => { p.cash += p.shares[D] * P; p.shares[D] = 0; p.hand[A] += p.hand[D]; p.hand[D] = 0; });
  for (const [k, o] of g.track) if (o === D) g.track.set(k, A);
  for (const [h, o] of g.stations) if (o === D) g.stations.set(h, A);
  g.bag[A] += g.bag[D]; g.bag[D] = 0; g.onboard[A] += g.onboard[D]; g.onboard[D] = 0;
  g.sold[D] = 0; g.dead[D] = true;
  g.stats.mergers.push({ round: g.turn.round, A, D, by: g.turn.active });
  touch(g);
}

/* an independent copy for lookahead (fresh random stream; history not carried) */
export function cloneGame(g) {
  return {
    S: g.S, R: rng(Math.floor(g.R() * 4294967296)), seed: g.seed,
    track: new Map(g.track), stations: new Map(g.stations), bag: [...g.bag], burned: g.burned, onboard: [...g.onboard],
    players: g.players.map((p) => ({ ...p, hand: [...p.hand], shares: [...p.shares] })), prices: [...g.prices], sold: [...g.sold],
    turn: { ...g.turn }, over: g.over, ver: g.ver, cache: Array(NL).fill(null), dead: [...g.dead],
    stats: { divCalls: g.stats.divCalls, actions: {}, divPaid: 0, history: [], handCapped: 0, drawShort: 0, mergers: [], mergeBonus: 0 },
  };
}

export function endTurn(g) {
  const T = g.turn, n = g.players.length;
  g.stats.history.push(snapshot(g));
  T.k++; T.n++;
  if (T.k >= n) { T.k = 0; T.round += 1; if (g.S.rotateStart) T.start = (T.start + 1) % n; }
  const k = g.S.snake && T.round % 2 === 0 ? n - 1 - T.k : T.k;
  T.active = (T.start + k) % n; T.ap = g.S.apPerTurn; T.invests = 0; T.usedSlot = false;
  if (T.round > g.S.roundLimit) g.over = true;
}

/* ── scoring ───────────────────────────────────────────────────────── *
 *  mtm   cash + every share at the current price ladder (the app's Tally)
 *  base  cash + every share at its base price (the price without the per-share-sold step)
 *  cash  cash only — shares are worth nothing at the end
 *  acq   base, plus Acquire-style majority / minority bonuses per line (majBonus×, minBonus× base price)
 */
export function shareValue(g, l) {
  const sc = g.S.scoring;
  if (sc === "mtm") return priceOf(g, l);
  if (sc === "base" || sc === "acq") return g.prices[l];
  return 0;
}
export function bonuses(g) {
  const out = g.players.map(() => 0);
  if (g.S.scoring !== "acq") return out;
  for (let l = 0; l < NL; l++) {
    const hold = g.players.map((p) => p.shares[l]);
    const top = Math.max(...hold); if (top <= 0) continue;
    const firsts = hold.map((h, i) => (h === top ? i : -1)).filter((i) => i >= 0);
    const P = g.prices[l];
    if (firsts.length > 1) { const pot = (g.S.majBonus + g.S.minBonus) * P / firsts.length; firsts.forEach((i) => { out[i] += pot; }); continue; }
    out[firsts[0]] += g.S.majBonus * P;
    const rest = hold.map((h, i) => (i === firsts[0] ? -1 : h));
    const sec = Math.max(...rest); if (sec <= 0) { out[firsts[0]] += g.S.minBonus * P; continue; }
    const secs = rest.map((h, i) => (h === sec ? i : -1)).filter((i) => i >= 0);
    secs.forEach((i) => { out[i] += g.S.minBonus * P / secs.length; });
  }
  return out;
}
export function scores(g) {
  const b = bonuses(g);
  return g.players.map((p, i) => p.cash + p.shares.reduce((a, n, l) => a + n * shareValue(g, l), 0) + b[i]);
}
export function snapshot(g) {
  return { n: g.turn.n, round: g.turn.round, scores: scores(g), cash: g.players.map((p) => p.cash),
           per: Array.from({ length: NL }, (_, l) => perShare(g, l)), bag: g.bag.reduce((a, b) => a + b, 0) };
}
