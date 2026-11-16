/* Shared board data, geometry and pure game helpers.
   Extracted from the playtest artifact — safe to split further. */
import { useState, useEffect, useRef, useCallback } from "react";


/* ═══════════════════════════════════════════════════════════
   NYC METRO — playtest board, v4
   Rebuilt for the 5/6/25 design: players ARE corporations,
   3 action points a turn, Acquire-style investment.
   Every undecided number is a dial in Tuning, and every
   derived number (network size, share price, build cost)
   is computed live so a session can interrogate the formulas.
   ═══════════════════════════════════════════════════════════ */

export const SEED_HEX =
"-1 -1 w;0 -1 l;1 -1 l;2 -1 l;3 -1 l;4 -1 l;5 -1 l;6 -1 w;7 -1 w;8 -1 w;9 -1 w;10 -1 w;11 -1 w;-1 0 w;0 0 l;1 0 l;2 0 l;3 0 l;4 0 l;5 0 w;6 0 w;7 0 w;8 0 w;9 0 w;10 0 w;11 0 w;-1 1 l;0 1 l;1 1 l;2 1 l;3 1 l;4 1 w;5 1 w;6 1 l;7 1 l;8 1 l;9 1 l;-1 2 w;0 2 l;1 2 l;2 2 l;3 2 l;4 2 l;5 2 l;6 2 l;7 2 l;8 2 l;9 2 l;10 2 l;11 2 o;-1 3 l;0 3 l;1 3 l;2 3 l;3 3 l;4 3 l;5 3 l;6 3 l;7 3 l;8 3 l;9 3 l;10 3 o;-1 4 w;0 4 l;1 4 l;2 4 l;3 4 l;4 4 l;5 4 l;6 4 l;7 4 l;8 4 l;9 4 l;10 4 l;-1 5 o;0 5 l;1 5 l;2 5 l;3 5 l;4 5 l;5 5 l;6 5 l;7 5 l;8 5 l;9 5 l;10 5 l;-1 6 w;0 6 l;1 6 l;2 6 l;3 6 l;4 6 l;5 6 l;6 6 l;7 6 l;8 6 l;9 6 l;10 6 l;11 6 l;-1 7 w;0 7 l;1 7 l;2 7 l;3 7 l;4 7 l;5 7 l;6 7 l;7 7 l;8 7 w;9 7 w;10 7 l;11 7 w;-1 8 w;0 8 w;1 8 l;2 8 l;3 8 l;4 8 l;5 8 l;6 8 l;7 8 l;8 8 w;9 8 w;10 8 l;11 8 w;-1 9 w;0 9 w;1 9 w;2 9 w;3 9 l;4 9 l;5 9 l;6 9 l;7 9 w;8 9 w;9 9 l;10 9 w;11 9 w;-1 10 w;1 10 l;2 10 w;3 10 w;4 10 l;5 10 l;6 10 l;7 10 w;8 10 w;9 10 w;10 10 w;11 10 w;1 11 w;2 11 w;3 11 l;4 11 l;5 11 l;6 11 o;7 11 w;8 11 w;9 11 w;10 11 w;11 11 w;1 12 w;2 12 w;3 12 w;4 12 l;5 12 l;6 12 o;7 12 w;8 12 w;9 12 w;10 12 w;11 12 w";

export const SEED_NAMES = {
  "5,-1": "Pellham Bay Park", "0,-1": "Van Cortland Park", "0,0": "Inwood",
  "5,2": "LGA Airport", "0,3": "Natural History Museum", "1,3": "The Met",
  "8,4": "Jamaica Station", "0,5": "Penn Station", "1,5": "Grand Central Terminal",
  "10,6": "JFK Airport", "4,8": "Atlantic Ave", "2,8": "Battery Park",
  "9,9": "The Rockaways", "4,9": "Prospect Park", "1,10": "Staten Island",
  "-1,5": "New Jersey Transit Path", "11,2": "Long Island Railway", "6,12": "Coney Island",
};
export const SEED_RIVERS = ["0,-1|0,0","0,0|1,0","0,1|1,0","0,1|1,1","1,1|1,2","1,1|2,2","2,1|2,2","2,1|3,2","3,1|3,2","3,1|4,2","2,2|3,2","2,3|3,2","2,3|3,3","2,3|3,4","2,4|3,4","2,5|3,4","2,5|3,5","2,5|3,6","2,6|3,6","2,7|3,6","2,7|3,7","2,7|3,8","2,8|3,8"];
export const SEED_NOCROSS = ["0,3|1,2","1,2|1,3","0,3|1,3","0,3|1,4","1,3|1,4"];

export const CONTRACTS = [
  {i:0,e:1,d:2,b:60,l:["Grand Central Terminal","Penn Station","PATH"]},
  {i:1,e:1,d:6,b:180,l:["The Met","Grand Central Terminal","Atlantic Ave"]},
  {i:2,e:1,d:6,b:180,l:["The Met","Prospect Park"]},
  {i:3,e:1,d:7,b:210,l:["Pelham Bay Park","Van Cortland Park","Inwood"]},
  {i:4,e:1,d:7,b:210,l:["Pelham Bay Park","The Met"]},
  {i:5,e:1,d:7,b:210,l:["Van Cortland Park","PATH"]},
  {i:6,e:1,d:8,b:240,l:["Van Cortland Park","Natural History Museum","Grand Central Terminal"]},
  {i:7,e:1,d:8,b:240,l:["Inwood","Penn Station","Battery Park"]},
  {i:8,e:1,d:8,b:240,l:["Natural History Museum","Battery Park","Atlantic Ave"]},
  {i:9,e:1,d:8,b:240,l:["Prospect Park","Battery Park","PATH"]},
  {i:10,e:1,d:8,b:240,l:["Natural History Museum","Penn Station","Prospect Park"]},
  {i:11,e:1,d:8,b:240,l:["Natural History Museum","Atlantic Ave","Prospect Park"]},
  {i:12,e:2,d:4,b:120,l:["Atlantic Ave","Prospect Park","Coney Island"]},
  {i:13,e:2,d:5,b:150,l:["Battery Park","Grand Central Terminal","PATH"]},
  {i:14,e:2,d:7,b:210,l:["Inwood","The Met","Penn Station"]},
  {i:15,e:2,d:8,b:240,l:["Penn Station","PATH","Staten Island"]},
  {i:16,e:2,d:9,b:270,l:["The Met","LGA Airport","Jamaica Station"]},
  {i:17,e:2,d:12,b:360,l:["Van Cortland Park","Pelham Bay Park","Jamaica Station"]},
  {i:18,e:2,d:12,b:360,l:["The Met","Battery Park","Coney Island"]},
  {i:19,e:2,d:12,b:360,l:["Van Cortland Park","Grand Central Terminal","Prospect Park"]},
  {i:20,e:2,d:13,b:390,l:["Pelham Bay Park","LGA Airport","Natural History Museum"]},
  {i:21,e:2,d:13,b:390,l:["Inwood","LGA Airport","Atlantic Ave"]},
  {i:22,e:2,d:13,b:390,l:["Van Cortland Park","Inwood","Jamaica Station"]},
  {i:23,e:2,d:13,b:390,l:["Natural History Museum","The Met","Staten Island"]},
  {i:24,e:3,d:8,b:240,l:["LGA Airport","The Met","Penn Station"]},
  {i:25,e:3,d:9,b:270,l:["JFK Airport","Jamaica Station","Atlantic Ave"]},
  {i:26,e:3,d:10,b:300,l:["Natural History Museum","The Met","Prospect Park"]},
  {i:27,e:3,d:13,b:390,l:["Natural History Museum","LGA Airport","Long Island Railroad"]},
  {i:28,e:3,d:15,b:450,l:["Van Cortland Park","Pelham Bay Park","JFK Airport"]},
  {i:29,e:3,d:16,b:480,l:["Pelham Bay Park","LGA Airport","The Rockaways"]},
  {i:30,e:3,d:17,b:510,l:["Staten Island","Atlantic Ave","Long Island Railroad"]},
  {i:31,e:3,d:18,b:540,l:["Inwood","Penn Station","Long Island Railroad"]},
  {i:32,e:3,d:19,b:570,l:["The Rockaways","Jamaica Station","Staten Island"]},
  {i:33,e:3,d:19,b:570,l:["Inwood","PATH","The Rockaways"]},
  {i:34,e:3,d:20,b:600,l:["Van Cortland Park","Long Island Railroad","The Rockaways"]},
  {i:35,e:3,d:21,b:630,l:["Pelham Bay Park","PATH","Coney Island"]}
];

export const ERA_LABEL = { 1: "Era 1 — the core", 2: "Era 2 — outward", 3: "Era 3 — the whole system" };
export const ALIAS = { "PATH": "New Jersey Transit Path", "Long Island Railroad": "Long Island Railway",
                "Pelham Bay Park": "Pellham Bay Park" };
export const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
export const eraDeck = (e) => shuffle(CONTRACTS.filter((c) => c.e === e).map((c) => c.i));
export const byId = (i) => CONTRACTS.find((c) => c.i === i);
export const contractLabel = (c) => c.l.join(" → ");

export const ZONES = ["West Bronx", "East Bronx", "Upper Manhattan", "Midtown", "Lower Manhattan", "Astoria", "Central Queens", "Jamaica", "South Queens", "North Brooklyn", "Central Brooklyn", "South Brooklyn", "Staten Island", "New Jersey", "Long Island"];
export const ZONE_COLORS = ["#E8D9B0", "#DCC9A0", "#D9E3F0", "#C4D6EE", "#AFC7E4", "#E6D6EA", "#DAC2E2", "#CBAED6", "#BC9ACA", "#D8EADE", "#BFE0CA", "#A6D5B6", "#F2DCD7", "#E4E4D2", "#D8E8E8"];
export const ZONE_RAW = "0 -1 0;1 -1 0;2 -1 0;3 -1 1;4 -1 1;5 -1 1;0 0 2;1 0 0;2 0 0;3 0 1;4 0 1;-1 1 13;0 1 2;1 1 0;2 1 0;3 1 1;6 1 6;7 1 6;8 1 7;9 1 8;0 2 2;1 2 2;2 2 2;3 2 5;4 2 5;5 2 5;6 2 6;7 2 6;8 2 7;9 2 7;10 2 14;11 2 14;-1 3 13;0 3 2;1 3 2;2 3 2;3 3 5;4 3 5;5 3 5;6 3 6;7 3 6;8 3 7;9 3 8;10 3 14;0 4 3;1 4 3;2 4 3;3 4 5;4 4 5;5 4 5;6 4 6;7 4 6;8 4 7;9 4 7;10 4 8;-1 5 13;0 5 3;1 5 3;2 5 3;3 5 9;4 5 9;5 5 5;6 5 6;7 5 7;8 5 7;9 5 8;10 5 8;0 6 3;1 6 4;2 6 4;3 6 9;4 6 9;5 6 9;6 6 9;7 6 6;8 6 7;9 6 7;10 6 8;11 6 14;0 7 4;1 7 4;2 7 4;3 7 9;4 7 9;5 7 9;6 7 9;7 7 10;10 7 8;1 8 4;2 8 4;3 8 10;4 8 10;5 8 10;6 8 10;7 8 10;10 8 8;3 9 10;4 9 10;5 9 10;6 9 10;9 9 8;1 10 12;4 10 11;5 10 11;6 10 11;3 11 11;4 11 11;5 11 11;6 11 11;4 12 11;5 12 11;6 12 11";
export const ZONE_OF = (() => { const m = {}; ZONE_RAW.split(";").forEach((t) => { const [c, r, z] = t.split(" "); m[`${c},${r}`] = +z; }); return m; })();

/* ── Version 2: the seven lines ─────────────────────────────
   Disc counts differ on purpose — a line with more discs can be
   built further, so it is worth more before anyone touches it. */
export const LINES = [
  { id: 0, name: "Broadway",   color: "#EE352E", discs: 20 },
  { id: 1, name: "Eighth Ave", color: "#0039A6", discs: 19 },
  { id: 2, name: "Sixth Ave",  color: "#FF6319", discs: 18 },
  { id: 3, name: "Lexington",  color: "#00933C", discs: 17 },
  { id: 4, name: "Flushing",   color: "#B933AD", discs: 16 },
  { id: 5, name: "Nassau",     color: "#996633", discs: 16 },
  { id: 6, name: "Canarsie",   color: "#A7A9AC", discs: 15 },
];

export const C_MIN = -3, C_MAX = 13, R_MIN = -3, R_MAX = 14;
export const R = 44, COLW = Math.sqrt(3) * R, ROWH = 1.5 * R;
export const odd = (r) => (((r % 2) + 2) % 2 === 1);
export const cx = (c, r) => COLW * c + (odd(r) ? COLW / 2 : 0);
export const cy = (c, r) => ROWH * r;
export const parseId = (id) => id.split(",").map(Number);
export const edgeKey = (a, b) => [a, b].sort().join("|");

export function neighbors(c, r) {
  return odd(r)
    ? [[c - 1, r],[c + 1, r],[c, r - 1],[c + 1, r - 1],[c, r + 1],[c + 1, r + 1]]
    : [[c - 1, r],[c + 1, r],[c - 1, r - 1],[c, r - 1],[c - 1, r + 1],[c, r + 1]];
}
/* odd-r offset → cube, for true hex distance */
export function cube(c, r) { const x = c - (r - (r & 1)) / 2, z = r; return [x, -x - z, z]; }
export function hexDist(idA, idB) {
  const [ac, ar] = parseId(idA), [bc, br] = parseId(idB);
  const a = cube(ac, ar), b = cube(bc, br);
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}
export function sharedEdge(idA, idB) {
  const [ac, ar] = parseId(idA), [bc, br] = parseId(idB);
  const x1 = cx(ac, ar), y1 = cy(ac, ar), x2 = cx(bc, br), y2 = cy(bc, br);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  let ux = x2 - x1, uy = y2 - y1; const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
  const px = -uy, py = ux, h = R / 2;
  return { x1: mx + px * h, y1: my + py * h, x2: mx - px * h, y2: my - py * h };
}

export const GRID = [];
for (let r = R_MIN; r <= R_MAX; r++) for (let c = C_MIN; c <= C_MAX; c++) GRID.push({ c, r, id: `${c},${r}` });

export const TERRAIN = { l: { label: "Land", fill: "#DDE7C8" }, w: { label: "Water", fill: "#C1E8F6" }, o: { label: "Off-board", fill: "#D7A086" } };
export const LINE_COLORS = ["#EE352E","#0039A6","#FF6319","#00933C","#B933AD","#996633"];

/* share ladder — your original values. Index 0 is the top. */
export const MARKET = [600,550,500,450,400,360,330,300,270,245,220,200,180,165,150,135,120,110,100,90,80,75,70,65,60,55,50,40];
export const START_AT = MARKET.indexOf(120);   // where a new corporation opens
export const MAINLINE = "#4A4A44";

export const DEFAULTS = {
  apPerTurn: 3,
  networkMetric: "stations",   // stations | track | hexes
  costNew: 0, costExpand: 0, costExtend: 0,
  distCost: 20,                // per hex of distance to nearest station
  distanceTo: "any",           // any | own
  waterCost: 100, riverCost: 50,
  contractTimer: 3,
  payoutToCompany: 50,         // % — rest splits among investors
  mainlineTarget: 12,
  subsidy: 500,
  tokenStart: 5, tokenStep: 5, tokenSlots: 20,
  maintPerCar: 3,         // upkeep per car, every round
  paybackRounds: 10,      // an operating line at full service repays its base over this many rounds
  redZoneAt: 100,         // at or below this price, the city is circling
  autoMarket: false,      // off: the app suggests a move, you decide
  demandPerLine: 3,       // full service; cars beyond this carry nobody
  autoUpkeep: true,
  slotsPerCharter: 6, unitsPerSlot: 4,
  trackBoxes: 20, trackLabel: "Income",
  faceUp: 4,
};

export const blankSlot = () => ({ text: "", payout: 100, timer: null, done: false, units: [false, false, false, false] });
export const blankCharter = (S) => ({
  tokens: 0,
  marks: Array.from({ length: (S || DEFAULTS).trackBoxes }, () => false),
  slots: Array.from({ length: (S || DEFAULTS).slotsPerCharter }, blankSlot),
});

export const seedMap = () => {
  const hexes = {};
  SEED_HEX.split(";").forEach((s) => { const [c, r, k] = s.split(" "); hexes[`${c},${r}`] = k; });
  return { hexes, names: { ...SEED_NAMES }, rivers: [...SEED_RIVERS], nocross: [...SEED_NOCROSS] };
};
export const newPlayer = (i) => ({
  id: i, name: `Player ${i + 1}`, abbr: `P${i + 1}`, color: LINE_COLORS[i % LINE_COLORS.length],
  cash: DEFAULTS.subsidy, done: 0, shares: {}, mainline: 0, mkt: START_AT, charter: blankCharter(DEFAULTS),
});
export const makeInitial = () => ({
  v: 0, map: seedMap(),
  track: {},      // edgeKey -> [playerId]
  stations: {},   // hexId -> { o: playerId, l: 1|2 }
  players: [newPlayer(0), newPlayer(1)],
  turn: { active: 0, ap: DEFAULTS.apPerTurn, round: 1 },
  mainlineStations: 0,
  ridership: 100,
  market: { era: 1, deck: [], up: [] },
  settings: { ...DEFAULTS },
  log: [],
});

export const Field = ({ label, value, onChange, onDone, step = 10, suffix }) => (
  <label className="flex items-center justify-between gap-2 py-0.5">
    <span className="text-xs text-stone-600">{label}</span>
    <span className="flex items-center gap-1">
      <input type="number" value={value} step={step} onBlur={onDone}
             onChange={(e) => onChange(Number(e.target.value) || 0)}
             className="w-16 bg-transparent border-b border-stone-400/60 px-1 text-right text-xs tabular-nums focus:outline-none focus:border-stone-800" />
      {suffix && <span className="text-[10px] text-stone-500 w-4">{suffix}</span>}
    </span>
  </label>
);


/* ── the car economy ──────────────────────────────────────────
   Cars up to a line’s demand carry riders; cars beyond it carry
   nobody but still cost upkeep. When ridership falls, a fleet
   that was profitable becomes a liability — which is the drop
   the design is reaching for.
   ─────────────────────────────────────────────────────────── */
export function carStats(p, S, ridership) {
  const slots = (p.charter && p.charter.slots) || [];
  const rid = (ridership ?? 100) / 100;
  const demand = Math.max(1, S.demandPerLine);
  const payback = Math.max(1, S.paybackRounds);
  let cars = 0, income = 0;
  const lines = slots.map((c) => {
    const n = ((c.units || []).filter(Boolean)).length;
    cars += n;
    const operating = !!(c.text && c.done);
    const live = operating ? Math.min(n, demand) : 0;
    const gross = operating ? Math.round((c.payout / payback) * (live / demand) * rid) : 0;
    income += gross;
    return { cars: n, live, idle: n - live, gross, operating };
  });
  const upkeep = cars * S.maintPerCar;
  return { cars, income, upkeep, net: income - upkeep, lines,
           per: Math.round((S.maintPerCar || 0)) };
}

/* ── player charter mat ───────────────────────────────────── */
export function Charter({ p, S, isActive, commit, edit, syncNow, onComplete, network, ridership }) {
  const ch = p.charter || blankCharter(S);
  const cs = carStats(p, S, ridership);
  const tokenCost = (i) => S.tokenStart + S.tokenStep * i;
  const nextCost = tokenCost(ch.tokens);
  const n = network || { size: 0, price: 0 };

  const setTokens = (v) => commit((s) => {
    const q = s.players.find((x) => x.id === p.id);
    q.charter = q.charter || blankCharter(s.settings);
    q.charter.tokens = v;
  }, `${p.name} token track → ${v}`);

  return (
    <div className={`rounded border-2 p-3 ${isActive ? "border-stone-800" : "border-stone-400"}`}
         style={{ background: "#FBFBF3" }}>
      {/* header */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b" style={{ borderColor: p.color }}>
        <span className="w-4 h-4 rounded-sm shrink-0" style={{ background: p.color }} />
        <input value={p.name} onBlur={syncNow}
               onChange={(e) => edit((s) => { const q = s.players.find((x) => x.id === p.id); q.name = e.target.value; })}
               className="font-bold bg-transparent border-b border-transparent hover:border-stone-300 focus:border-stone-500 focus:outline-none text-base min-w-0 flex-1" />
        <span className="text-xs tabular-nums text-stone-600">${p.cash} · net {n.size} · share ${n.price}</span>
        <span className={`text-xs tabular-nums px-1.5 py-0.5 rounded-sm ${cs.net < 0 ? "bg-red-100 text-red-800 font-semibold" : "bg-stone-100 text-stone-700"}`}>
          {cs.cars} cars · lines +{cs.income} − upkeep {cs.upkeep} = {cs.net >= 0 ? "+" : ""}{cs.net}/rd
        </span>
        {isActive && <span className="text-[10px] px-1.5 py-0.5 bg-stone-800 text-stone-50 rounded-sm">active</span>}
      </div>

      {/* token cost track */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[10px] uppercase tracking-widest text-stone-500">Token cost</span>
          <span className="text-xs">next token <b className="tabular-nums">${nextCost}</b></span>
        </div>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: S.tokenSlots }).map((_, i) => {
            const used = i < ch.tokens;
            return (
              <button key={i} onClick={() => setTokens(i < ch.tokens ? i : i + 1)}
                className="w-9 h-9 rounded-full border-2 text-[9px] font-semibold tabular-nums flex items-center justify-center"
                style={{ borderColor: used ? p.color : "#C0392B44", background: used ? p.color : "transparent",
                         color: used ? "#fff" : "#C0392B" }}>
                -${tokenCost(i)}
              </button>
            );
          })}
        </div>
      </div>

      {/* generic box track */}
      <div className="mb-3">
        <div className="flex items-baseline gap-2 mb-1">
          <input value={S.trackLabel} onBlur={syncNow}
                 onChange={(e) => edit((s) => { s.settings.trackLabel = e.target.value; })}
                 className="text-[10px] uppercase tracking-widest text-stone-500 bg-transparent border-b border-transparent hover:border-stone-300 focus:outline-none w-28" />
        </div>
        <div className="flex flex-wrap gap-0.5">
          {Array.from({ length: S.trackBoxes }).map((_, i) => (
            <button key={i}
              onClick={() => commit((s) => {
                const q = s.players.find((x) => x.id === p.id);
                q.charter = q.charter || blankCharter(s.settings);
                q.charter.marks = q.charter.marks || [];
                q.charter.marks[i] = !q.charter.marks[i];
              })}
              className="w-6 h-6 border border-stone-500"
              style={{ background: (ch.marks || [])[i] ? p.color : "transparent" }} />
          ))}
        </div>
      </div>

      {/* contract slots */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {(ch.slots || []).map((c, i) => (
          <div key={i} className={`border rounded p-2 ${c.done ? "border-stone-300 bg-stone-100/70 opacity-75"
                : (typeof c.timer === "number" && c.timer <= 0 && c.text) ? "border-red-500 bg-red-50/60" : "border-stone-400 bg-white"}`}>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <textarea rows={2} value={c.text} placeholder="contract" onBlur={syncNow}
                  onChange={(e) => edit((s) => { const q = s.players.find((x) => x.id === p.id); q.charter.slots[i].text = e.target.value; })}
                  className="w-full text-xs bg-transparent resize-none focus:outline-none placeholder:text-stone-400" />
                <div className="flex items-center gap-2 text-[11px] mt-1">
                  <label className="flex items-center">$<input type="number" step={20} value={c.payout} onBlur={syncNow}
                    onChange={(e) => edit((s) => { const q = s.players.find((x) => x.id === p.id); q.charter.slots[i].payout = Number(e.target.value) || 0; })}
                    className="w-12 bg-transparent border-b border-stone-300 text-right tabular-nums focus:outline-none" /></label>
                  <label className="flex items-center gap-0.5 text-stone-600">timer
                    <input type="number" step={1} value={c.timer ?? ""} placeholder="—" onBlur={syncNow}
                      onChange={(e) => edit((s) => { const q = s.players.find((x) => x.id === p.id);
                        q.charter.slots[i].timer = e.target.value === "" ? null : Number(e.target.value); })}
                      className="w-8 bg-transparent border-b border-stone-300 text-right tabular-nums focus:outline-none" /></label>
                  {c.done
                    ? <span className="ml-auto text-emerald-800 font-semibold">operating</span>
                    : c.text && <button onClick={() => onComplete(p.id, i)} className="ml-auto px-1.5 py-0.5 bg-stone-800 text-stone-50 rounded-sm">Open the line</button>}
                </div>
              </div>
              {/* cars assigned to this line */}
              <div className="flex flex-col gap-1 shrink-0 items-center">
                <span className="text-[8px] uppercase tracking-wider text-stone-500">cars</span>
                {Array.from({ length: S.unitsPerSlot }).map((_, u) => (
                  <button key={u}
                    onClick={() => commit((s) => { const q = s.players.find((x) => x.id === p.id);
                      q.charter.slots[i].units = q.charter.slots[i].units || [];
                      q.charter.slots[i].units[u] = !q.charter.slots[i].units[u]; })}
                    className="w-5 h-5 border border-stone-500 text-[8px] leading-none flex items-center justify-center"
                    style={{ background: (c.units || [])[u] ? p.color : "transparent",
                             color: (c.units || [])[u] ? "#fff" : "#8a8a80" }}>
                    {u + 1}
                  </button>
                ))}
                {cs.lines[i] && cs.lines[i].cars > 0 && (
                  <span className={`text-[8px] tabular-nums ${cs.lines[i].idle > 0 ? "text-red-700 font-bold"
                        : cs.lines[i].operating ? "text-emerald-800" : "text-stone-500"}`}>
                    {cs.lines[i].idle > 0 ? `${cs.lines[i].idle} idle`
                      : cs.lines[i].operating ? `+${cs.lines[i].gross}/rd` : "not open"}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   VERSION 2 — INFLUENCE
   Ken's 8/12/26 design plus Andrew's revisions, with the rules
   the simulations landed on. Every constant is a lever in Tuning.
   ═══════════════════════════════════════════════════════════ */

export const V2D = {
  /* turn */
  apPerTurn: 5, roundLimit: 15, handLimit: 10, drawCount: 3, startingHand: 10,
  /* track */
  ownership: "link",        // link = one disc per stretch (Age of Steam) | hex = one per tile
  branchAt: 3,              // how many track ends a line may have at its OWN station
  crossMode: "cost",        // free | cost | station  (station = crossing only where a station stands)
  crossPay: "other",        // own = a disc of your colour | other = a disc of the line you cross
  crossDiscs: 1,
  waterExtra: 0,            // extra discs to build into a water hex
  /* stations */
  stationBase: 3,           // cost = base - hexes to the nearest station
  stationMin: 0,
  burnFrac: 0.5,            // share of the discs spent that are destroyed
  burnRound: "up",          // up | down
  /* shares */
  sharesPerLine: 25,        // Acquire uses 25
  startPrice: 10, stepPerShare: 15, priceGrowth: 1,
  investPerTurn: 3, wildCost: 2, startCash: 60,
  /* dividends */
  perStation: 1, perZone: 1,
  /* merge — acquirer is whichever line has the most stations */
  mergeResist: 5,
  /* sandbox: nothing is enforced unless you switch this on */
  strict: false,
  autoAP: false,
};

export const shuffleBag = () => {
  const bag = [];
  LINES.forEach((l) => { for (let i = 0; i < l.discs; i++) bag.push(l.id); });
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  return bag;
};
export const v2Player = (i, S) => ({ id: i, name: `Player ${i + 1}`, cash: S.startCash, hand: [], shares: {} });
export const makeV2 = (over = {}) => {
  const S = { ...V2D, ...over };
  const map = seedMap();
  const bag = shuffleBag();
  const players = [v2Player(0, S), v2Player(1, S), v2Player(2, S)];
  players.forEach((p) => { for (let i = 0; i < S.startingHand && bag.length; i++) p.hand.push(bag.pop()); });
  // lines start at the map's NAMED locations — the landmarks, not blank hexes
  const named = Object.keys(map.names || {}).filter((h) => map.hexes[h]);
  const pool = named.length >= LINES.length
    ? named
    : Object.keys(map.hexes).filter((h) => map.hexes[h] === "l");
  const picks = [...pool];
  for (let i = picks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [picks[i], picks[j]] = [picks[j], picks[i]]; }
  const stations = {};
  LINES.forEach((l, i) => { const h = picks[i]; if (h) stations[h] = { o: l.id }; });
  const prices = {}, sold = {};
  LINES.forEach((l) => { prices[l.id] = S.startPrice; sold[l.id] = 0; });
  return { v: 0, map, track: {}, stations, bag, burned: [], onboard: [], players, prices, sold,
           turn: { active: 0, ap: S.apPerTurn, round: 1, invests: 0, usedSlot: false },
           settings: S, log: [] };
};

/* ── pure helpers over a state object ─────────────────────── */
export const lineOf = (id) => LINES.find((l) => l.id === id);
export const trackOwner = (s, k) => { const t = s.track[k]; return Array.isArray(t) ? t[0] : t; };
export const lineEdges = (s, lid) => Object.keys(s.track).filter((k) => trackOwner(s, k) === lid);
export const lineNet = (s, lid) => {
  const hs = new Set();
  Object.entries(s.stations).forEach(([h, st]) => { if (st.o === lid) hs.add(h); });
  lineEdges(s, lid).forEach((k) => k.split("|").forEach((h) => hs.add(h)));
  return hs;
};
export const lineDegree = (s, lid) => {
  const d = {};
  lineEdges(s, lid).forEach((k) => k.split("|").forEach((h) => { d[h] = (d[h] || 0) + 1; }));
  return d;
};
export const occupants = (s, h) => {
  const out = new Set();
  Object.keys(s.track).forEach((k) => { if (k.split("|").includes(h)) out.add(trackOwner(s, k)); });
  return out;
};
export const stationsOf = (s, lid) => Object.values(s.stations).filter((x) => x.o === lid).length;
export const zonesOf = (s, lid) => {
  const z = new Set();
  lineNet(s, lid).forEach((h) => { const q = ZONE_OF[h]; if (q !== undefined) z.add(q); });
  return z;
};
export const perShare = (s, lid) => stationsOf(s, lid) * s.settings.perStation + zonesOf(s, lid).size * s.settings.perZone;
export const priceOf = (s, lid) => (s.prices?.[lid] ?? s.settings.startPrice) + (s.sold?.[lid] ?? 0) * s.settings.stepPerShare;
export const sharesLeft = (s, lid) => s.settings.sharesPerLine - (s.sold?.[lid] ?? 0);

/* links: maximal stretches of a line's track, split at that line's own stations */
export const countLinks = (s, lid) => {
  const edges = lineEdges(s, lid);
  if (!edges.length) return 0;
  const adj = {};
  edges.forEach((k) => { const [a, b] = k.split("|"); (adj[a] = adj[a] || []).push([b, k]); (adj[b] = adj[b] || []).push([a, k]); });
  const seen = new Set(); let n = 0;
  edges.forEach((e0) => {
    if (seen.has(e0)) return;
    n++; const stack = [e0];
    while (stack.length) {
      const e = stack.pop();
      if (seen.has(e)) continue;
      seen.add(e);
      e.split("|").forEach((h) => {
        if (s.stations[h]?.o === lid) return;          // a station ends the link
        (adj[h] || []).forEach(([, e2]) => { if (!seen.has(e2)) stack.push(e2); });
      });
    }
  });
  return n;
};
export const syncMarkers = (s) => {
  if (s.settings.ownership !== "link") return;
  const want = LINES.reduce((a, l) => a + countLinks(s, l.id), 0);
  while (s.onboard.length < want && s.bag.length) s.onboard.push(s.bag.pop());
  while (s.onboard.length > want) s.bag.push(s.onboard.pop());
};

export const nearestStation = (s, id) => {
  let d = null;
  Object.keys(s.stations).forEach((h) => {
    if (h === id) return;
    const x = hexDist(id, h);
    if (d === null || x < d) d = x;
  });
  return d;
};
export const stationCost = (s, id) => {
  const d = nearestStation(s, id);
  return Math.max(s.settings.stationMin, s.settings.stationBase - (d === null ? 0 : d));
};
export const burnCount = (s, n) => {
  const raw = n * s.settings.burnFrac;
  return s.settings.burnRound === "up" ? Math.ceil(raw) : Math.floor(raw);
};
