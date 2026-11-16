/*  Bots.
 *
 *  The main bot is a greedy value-maximiser. Each action point it scores every legal action by
 *  how much it changes a projected final standing, takes the best, and ends its turn when
 *  nothing improves it. The projection, for every player j:
 *
 *    F_j = cash_j
 *        + wDisc * discs in hand                                 (discs are the means to act)
 *        + sum over lines l of shares_jl * ( T_l                 (what a share is worth at the end, by the scoring rule)
 *                                          + D_l * Rrem * (1+g)) (expected future dividends, and the price rise they cause)
 *        + wPot * sum over lines l of shares_jl * room_l         (room to grow: hexes on the line with no station yet)
 *        + end-game bonuses, if the scoring rule has them
 *
 *  where D_l is the line's dividend per share, Rrem = phi * turns left is how many more dividend
 *  calls it expects, and g is the price growth per call (0 if shares score nothing).
 *  It maximises F_me - lambda * mean(F_others): lambda = 0 is pure self-interest, 1 is pure
 *  "beat the table". The five numbers (phi, wDisc, wPot, lambda, noise) are evolved by self-play
 *  in evolve.mjs, so the bots are as good at this game as a search over that family can make them.
 *
 *  "allow" restricts the action types, which is how the single-strategy archetypes are built.
 */
import * as E from "./engine.mjs";

export const DEFAULT_THETA = { phi: 0.3, wDisc: 3, wPot: 1, lambda: 0.7, noise: 0.5 };

function project(g) {
  const S = g.S, NL = E.NL;
  const D = [], room = [], T = [];
  for (let l = 0; l < NL; l++) {
    D.push(E.perShare(g, l));
    room.push(Math.min(E.line(g, l).sites, 4));
    T.push(E.shareValue(g, l));
  }
  const players = g.players.map((p) => ({ cash: p.cash, hand: E.handSize(p), shares: [...p.shares] }));
  const totalTurns = S.roundLimit * g.players.length;
  return { D, room, T, prices: [...g.prices], sold: [...g.sold], players, turnsLeft: totalTurns - g.turn.n };
}
const copy = (a) => ({ D: [...a.D], room: [...a.room], T: [...a.T], prices: [...a.prices], sold: [...a.sold], turnsLeft: a.turnsLeft,
                       players: a.players.map((p) => ({ cash: p.cash, hand: p.hand, shares: [...p.shares] })) });

function bonusOf(g, a) {
  if (g.S.scoring !== "acq") return a.players.map(() => 0);
  const out = a.players.map(() => 0);
  for (let l = 0; l < E.NL; l++) {
    const hold = a.players.map((p) => p.shares[l]);
    const top = Math.max(...hold); if (top <= 0) continue;
    const first = hold.map((h, i) => (h === top ? i : -1)).filter((i) => i >= 0);
    const P = a.prices[l];
    if (first.length > 1) { first.forEach((i) => { out[i] += (g.S.majBonus + g.S.minBonus) * P / first.length; }); continue; }
    out[first[0]] += g.S.majBonus * P;
    const rest = hold.map((h, i) => (i === first[0] ? -1 : h)), sec = Math.max(...rest);
    if (sec <= 0) { out[first[0]] += g.S.minBonus * P; continue; }
    const secs = rest.map((h, i) => (h === sec ? i : -1)).filter((i) => i >= 0);
    secs.forEach((i) => { out[i] += g.S.minBonus * P / secs.length; });
  }
  return out;
}

function objective(g, a, me, th) {
  const S = g.S, g1 = S.scoring === "cash" ? 0 : S.priceGrowth;
  const Rrem = th.phi * a.turnsLeft;
  const bon = bonusOf(g, a);
  const F = a.players.map((p, j) => {
    let v = p.cash + th.wDisc * Math.min(p.hand, S.handLimit) + bon[j];
    for (let l = 0; l < E.NL; l++) if (p.shares[l]) v += p.shares[l] * (a.T[l] + a.D[l] * Rrem * (1 + g1) + th.wPot * a.room[l]);
    return v;
  });
  let opp = 0; F.forEach((v, j) => { if (j !== me) opp += v; });
  return F[me] - th.lambda * opp / Math.max(1, F.length - 1);
}

/* every candidate action this bot may take now, with its projected effect */
function candidates(g, th, allow) {
  const S = g.S, p = E.cur(g), me = g.turn.active, base = project(g), out = [];
  const ok = (t) => !allow || allow.includes(t);
  const push = (act, mutate) => { if (!E.canDo(g, act)) return; const a = copy(base); mutate(a); out.push({ act, a }); };
  const mtm = S.scoring === "mtm";

  if (ok("track")) for (let l = 0; l < E.NL; l++) {
    if (!p.hand[l]) continue;
    const L = E.line(g, l);
    for (const o of E.legalTrack(g, l)) {
      const need = E.trackNeed(l, o); if (!E.canPayArr(p, need)) continue;
      const cost = need.reduce((x, y) => x + y, 0);
      push({ t: "track", l, ...o }, (a) => {
        a.players[me].hand -= cost;
        if (!L.net.has(o.to)) {
          if (!g.stations.has(o.to)) a.room[l] = Math.min(L.sites + 1, 4);
          const z = E.ZONE[o.to]; if (z !== undefined && !L.zones.has(z)) a.D[l] += S.perZone;
        }
      });
    }
  }
  if (ok("station")) for (let l = 0; l < E.NL; l++) {
    const L = E.line(g, l); let best = null;
    for (const h of L.net) { if (g.stations.has(h)) continue; const c = E.stationCost(g, h); if (c <= p.hand[l] && (!best || c < best.c || (c === best.c && g.R() < 0.5))) best = { h, c }; }
    if (best) push({ t: "station", l, h: best.h }, (a) => { a.players[me].hand -= best.c; a.D[l] += S.perStation; a.room[l] = Math.min(Math.max(0, L.sites - 1), 4); });
  }
  if (ok("draw")) {
    const bagN = g.bag.reduce((x, y) => x + y, 0);
    const n = Math.min(S.drawCount, S.handLimit - E.handSize(p), bagN);
    if (n > 0) push({ t: "draw" }, (a) => { a.players[me].hand += n; });
  }
  if (ok("invest")) for (let l = 0; l < E.NL; l++) for (const wild of [false, true]) {
    const price = E.priceOf(g, l);
    push({ t: "invest", l, wild }, (a) => {
      const q = a.players[me]; q.cash -= price; q.shares[l]++; q.hand -= wild ? S.wildCost : 1;
      a.sold[l]++; if (mtm) a.T[l] += S.stepPerShare;
    });
  }
  if (ok("div")) push({ t: "div" }, (a) => {
    const g1 = S.scoring === "cash" ? 0 : S.priceGrowth;
    a.players.forEach((q) => { for (let l = 0; l < E.NL; l++) q.cash += q.shares[l] * a.D[l]; });
    for (let l = 0; l < E.NL; l++) { const rise = Math.round(a.D[l] * S.priceGrowth); a.prices[l] += rise; if (S.scoring !== "cash") a.T[l] += rise; }
  });
  return { base, out };
}

/* choose and play one action; returns false when the turn is over */
export function greedyStep(g, th, allow) {
  const me = g.turn.active;
  const { base, out } = candidates(g, th, allow);
  const v0 = objective(g, base, me, th);
  let best = null, bestV = 0;
  for (const c of out) {
    const v = objective(g, c.a, me, th) - v0 + (th.noise ? (g.R() - 0.5) * th.noise : 0);
    if (v > bestV) { bestV = v; best = c; }
  }
  if (!best) { E.apply(g, { t: "end" }); return false; }
  E.apply(g, best.act);
  return true;
}

export function randomStep(g) {
  const p = E.cur(g), acts = [];
  for (let l = 0; l < E.NL; l++) {
    for (const o of E.legalTrack(g, l)) { const a = { t: "track", l, ...o }; if (E.canDo(g, a)) acts.push(a); }
    for (const h of E.line(g, l).net) { const a = { t: "station", l, h }; if (E.canDo(g, a)) acts.push(a); }
    for (const wild of [false, true]) { const a = { t: "invest", l, wild }; if (E.canDo(g, a)) acts.push(a); }
  }
  for (const a of [{ t: "draw" }, { t: "div" }]) if (E.canDo(g, a)) acts.push(a);
  if (!acts.length || g.R() < 0.12) { E.apply(g, { t: "end" }); return false; }
  E.apply(g, acts[Math.floor(g.R() * acts.length)]);
  return true;
}

/* a bot is {name, kind:"greedy"|"random", theta, allow} */
export function playTurn(g, bot) {
  const startTurn = g.turn.n;
  let guard = 0;
  while (!g.over && g.turn.n === startTurn && guard++ < 40) {
    const more = bot.kind === "random" ? randomStep(g) : greedyStep(g, bot.theta, bot.allow);
    if (!more) break;
  }
  if (!g.over && g.turn.n === startTurn) E.apply(g, { t: "end" });
}

export function playGame(settings, seed, bots) {
  const g = E.newGame({ ...settings, players: bots.length }, seed);
  while (!g.over) playTurn(g, bots[g.turn.active]);
  return g;
}
