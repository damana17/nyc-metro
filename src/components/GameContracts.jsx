import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  SEED_HEX, SEED_NAMES, SEED_RIVERS, SEED_NOCROSS, ZONES, ZONE_COLORS, ZONE_OF,
  LINES, V2D, GRID, TERRAIN, R, cx, cy, parseId, edgeKey, neighbors, sharedEdge, hexDist,
  seedMap, Field, CONTRACTS, ERA_LABEL, eraDeck, byId, contractLabel,
  MARKET, START_AT, DEFAULTS, blankSlot, blankCharter, newPlayer, makeInitial, carStats, Charter,
  makeV2, v2Player, lineOf, trackOwner, lineEdges, lineNet, lineDegree, occupants,
  stationsOf, zonesOf, perShare, priceOf, sharesLeft, countLinks, syncMarkers,
  nearestStation, stationCost, burnCount,
} from "../lib/game.jsx";

import { useTable, shareLink, cleanCode } from "../lib/sync.js";

export default function GameContracts({ hidden }) {
  const [roomInput, setRoomInput] = useState("");
  const [tab, setTab] = useState("play");
  const [mode, setMode] = useState("build");
  const [paint, setPaint] = useState("l");
  const [sel, setSel] = useState(null);       // selected hex (build calculator)
  const [pending, setPending] = useState(null);
  const [naming, setNaming] = useState(null); const [nameDraft, setNameDraft] = useState("");
  const [status, setStatus] = useState("");
  const [showTune, setShowTune] = useState(false);
  const [bids, setBids] = useState({});
  const [bidTo, setBidTo] = useState({});
  const [hoverC, setHoverC] = useState(null);
  const fileRef = useRef(null);

  const T = useTable("c", makeInitial, { who: (s) => s.players.find((p) => p.id === s.turn.active)?.abbr || "?" });
  const { state, room, join, commit } = T;
  useEffect(() => {
    if (!T.loaded) return;
    if (state.market && !state.market.deck.length && !state.market.up.length) {
      commit((s) => { const e = s.market.era || 1, d = eraDeck(e), n = s.settings.faceUp; s.market = { era: e, deck: d.slice(n), up: d.slice(0, n) }; });
    }
  }, [T.loaded]); // eslint-disable-line
  const edit = useCallback((mut) => commit(mut, null, { quiet: true }), [commit]);
  const syncNow = () => {};

  const map = state.map || seedMap();
  const hexForName = useCallback((n) => {
    const names = map.names || {};
    for (const [h, v] of Object.entries(names)) if (v === n || v === ALIAS[n]) return h;
    return null;
  }, [map.names]);
  const S = state.settings || DEFAULTS;
  const me = state.turn.active;
  const player = (id) => state.players.find((p) => p.id === id);
  const colorOf = (id) => (id === "M" ? MAINLINE : player(id)?.color || "#333");
  const trackAt = (k) => { const t = state.track[k]; return Array.isArray(t) ? t : t == null ? [] : [t]; };

  /* ── derived: network size, share price ── */
  const network = useMemo(() => {
    const out = {};
    state.players.forEach((p) => {
      const stations = Object.values(state.stations).filter((s) => s.o === p.id).length;
      const segs = Object.keys(state.track).filter((k) => trackAt(k).includes(p.id)).length;
      const hexes = new Set();
      Object.entries(state.stations).forEach(([h, s]) => { if (s.o === p.id) hexes.add(h); });
      Object.keys(state.track).forEach((k) => { if (trackAt(k).includes(p.id)) k.split("|").forEach((h) => hexes.add(h)); });
      const size = S.networkMetric === "track" ? segs : S.networkMetric === "hexes" ? hexes.size : stations;
      const mkt = MARKET[Math.min(MARKET.length - 1, Math.max(0, p.mkt ?? START_AT))];
      out[p.id] = { stations, segs, hexes: hexes.size, size, price: mkt,
                    red: mkt <= (S.redZoneAt || 0) };
    });
    return out;
  }, [state.stations, state.track, state.players, S.networkMetric]);

  /* ── derived: build cost for the selected hex ── */
  const buildCost = useMemo(() => {
    if (!sel || !map.hexes[sel]) return null;
    const owned = Object.entries(state.stations).filter(([, s]) => S.distanceTo === "own" ? s.o === me : true);
    let d = null;
    owned.forEach(([h]) => { if (h !== sel) { const x = hexDist(sel, h); if (d === null || x < d) d = x; } });
    const terrain = map.hexes[sel] === "w" ? S.waterCost : 0;
    const dist = d === null ? 0 : d * S.distCost;
    return { d, terrain, dist, neu: S.costNew + dist + terrain, expand: S.costExpand + terrain, extend: S.costExtend + terrain };
  }, [sel, state.stations, S, map.hexes, me]);

  const spendAP = (n, note) => commit((s) => {
    s.turn.ap = Math.max(0, s.turn.ap - n);
    if (note) s.log = [{ who: s.players[s.turn.active]?.abbr || "?", note }, ...(s.log || [])].slice(0, 50);
  });

  const onHex = (id, exists) => {
    if (tab === "map") {
      if (mode === "terrain") { commit((s) => { if (paint === "x") { delete s.map.hexes[id]; delete s.map.names[id]; } else s.map.hexes[id] = paint; }, `map ${id}`); return; }
      if (mode === "name") { if (exists) { setNaming(id); setNameDraft(map.names[id] || ""); } return; }
      if (mode === "edge") {
        if (!pending) { setPending(id); return; }
        if (pending === id) { setPending(null); return; }
        const [pc, pr] = parseId(pending);
        if (!neighbors(pc, pr).some(([c, r]) => `${c},${r}` === id)) { setPending(id); return; }
        const k = edgeKey(pending, id);
        commit((s) => {
          const inR = s.map.rivers.includes(k), inN = s.map.nocross.includes(k);
          s.map.rivers = s.map.rivers.filter((x) => x !== k);
          s.map.nocross = s.map.nocross.filter((x) => x !== k);
          if (!inR && !inN) s.map.rivers.push(k); else if (inR) s.map.nocross.push(k);
        }, `border ${k}`);
        setPending(id); return;
      }
      return;
    }
    if (!exists) return;
    setSel(id);
    if (mode === "build") {
      if (!pending) { setPending(id); return; }
      if (pending === id) { setPending(null); return; }
      const [pc, pr] = parseId(pending);
      if (!neighbors(pc, pr).some(([c, r]) => `${c},${r}` === id)) { setPending(id); return; }
      const k = edgeKey(pending, id);
      commit((s) => {
        const cur = Array.isArray(s.track[k]) ? s.track[k] : s.track[k] == null ? [] : [s.track[k]];
        const nx = cur.includes(me) ? cur.filter((x) => x !== me) : [...cur, me];
        if (nx.length) s.track[k] = nx; else delete s.track[k];
      }, `track ${k}`);
      setPending(id); return;
    }
    if (mode === "station") {
      commit((s) => {
        const cur = s.stations[id];
        if (!cur) s.stations[id] = { o: me, l: 1 };
        else if (cur.o === me && cur.l === 1) s.stations[id] = { o: me, l: 2 };
        else if (cur.o === me) delete s.stations[id];
        else s.stations[id] = { o: me, l: 1 };
      }, `station ${id}`); return;
    }
    if (mode === "erase") {
      commit((s) => { delete s.stations[id]; Object.keys(s.track).forEach((k) => { if (k.split("|").includes(id)) delete s.track[k]; }); }, `clear ${id}`);
    }
  };

  const saveName = () => {
    const id = naming, val = nameDraft.trim();
    commit((s) => { if (val) s.map.names[id] = val; else delete s.map.names[id]; }, `named ${id}`);
    setNaming(null); setNameDraft("");
  };

  /* ── contract market ── */
  const refill = (s) => {
    while (s.market.up.length < s.settings.faceUp && s.market.deck.length) s.market.up.push(s.market.deck.shift());
  };
  const openEra = (e) => commit((s) => {
    s.market.era = e; s.market.deck = eraDeck(e); s.market.up = []; refill(s);
  }, `opened era ${e}`);

  const award = (cid, playerId, bid) => commit((s) => {
    const p = s.players.find((x) => x.id === playerId); if (!p) return;
    p.charter = p.charter || blankCharter(s.settings);
    let slot = p.charter.slots.findIndex((x) => !x.text);
    if (slot < 0) { p.charter.slots.push(blankSlot()); slot = p.charter.slots.length - 1; }
    const c = byId(cid);
    p.charter.slots[slot] = { ...blankSlot(), text: contractLabel(c), payout: c.b,
                              timer: s.settings.contractTimer, cid };
    p.cash += bid;                     // subsidy received; a negative bid means paying the city
    s.market.up = s.market.up.filter((x) => x !== cid);
    if (s.turn.active === playerId) s.turn.ap = Math.max(0, s.turn.ap - 1);
    refill(s);
    s.log = [{ who: p.abbr || p.name, note: `won ${contractLabel(c)} — subsidy ${bid >= 0 ? "+$" + bid : "-$" + Math.abs(bid)}` }, ...(s.log || [])].slice(0, 50);
  });

  const discard = (cid) => commit((s) => {
    s.market.up = s.market.up.filter((x) => x !== cid); refill(s);
  }, "passed on a contract");

  const giveShare = (holderId, targetId, delta) => commit((s) => {
    const h = s.players.find((x) => x.id === holderId); if (!h) return;
    h.shares = h.shares || {};
    const next = Math.max(0, (h.shares[targetId] || 0) + delta);
    if (next) h.shares[targetId] = next; else delete h.shares[targetId];
  });

  const setMkt = (pid, idx) => commit((s) => {
    const q = s.players.find((x) => x.id === pid); if (!q) return;
    q.mkt = Math.min(MARKET.length - 1, Math.max(0, idx));
  });

  const moveMkt = (pid, delta) => commit((s) => {
    const q = s.players.find((x) => x.id === pid); if (!q) return;
    q.mkt = Math.min(MARKET.length - 1, Math.max(0, (q.mkt ?? START_AT) - delta));
  });

  const endTurn = () => commit((s) => {
    const n = s.players.length || 1;
    const nextIdx = (s.players.findIndex((p) => p.id === s.turn.active) + 1) % n;
    s.turn.active = s.players[nextIdx].id;
    s.turn.ap = s.settings.apPerTurn;
    if (nextIdx === 0) {
      s.turn.round += 1;
      if (s.settings.autoUpkeep) {
        s.players.forEach((q) => {
          const cs = carStats(q, s.settings, s.ridership);
          if (cs.cars === 0 && cs.income === 0) return;
          const split = (s.settings.payoutToCompany || 100) / 100;
          let toCo = cs.net, toInv = 0;
          if (cs.net > 0) { toCo = Math.round(cs.net * split); toInv = cs.net - toCo; }
          const holders = s.players.filter((x) => (x.shares?.[q.id] || 0) > 0);
          const total = holders.reduce((a, x) => a + (x.shares[q.id] || 0), 0);
          if (toInv > 0 && total > 0) holders.forEach((x) => { x.cash += Math.round(toInv * (x.shares[q.id] / total)); });
          else toCo = cs.net;            // no shareholders: the company keeps all of it
          q.cash += toCo;
          const dir = cs.net > 0 ? 1 : cs.net < 0 ? -1 : 0;
          if (dir && s.settings.autoMarket) q.mkt = Math.min(MARKET.length - 1, Math.max(0, (q.mkt ?? START_AT) - dir));
          s.log = [{ who: q.abbr || q.name,
                     note: `lines ${cs.income} − upkeep ${cs.upkeep} = ${cs.net >= 0 ? "+" : ""}${cs.net}` +
                           (toInv > 0 && total > 0 ? ` (${toInv} to holders)` : "") +
                           (dir ? (s.settings.autoMarket ? ` · share ${dir > 0 ? "↑" : "↓"}`
                                                         : ` · suggest share ${dir > 0 ? "↑" : "↓"}`) : "") },
                   ...(s.log || [])].slice(0, 50);
        });
      }
      s.players.forEach((p) => (p.charter?.slots || []).forEach((c) => {
        if (c.text && !c.done && typeof c.timer === "number" && c.timer > 0) c.timer -= 1;
      }));
    }
  }, "ended turn");

  const completeContract = (pid, ci) => commit((s) => {
    const own = s.players.find((p) => p.id === pid); if (!own) return;
    const c = own.charter?.slots?.[ci]; if (!c || c.done) return;
    c.done = true;                       // the line opens; it now earns every round
    own.done += 1;                       // completed-contract count drives share price
    s.log = [{ who: own.abbr || own.name, note: `opened ${c.text}` }, ...(s.log || [])].slice(0, 50);
  });

  const buyShare = (targetId) => commit((s) => {
    const buyer = s.players.find((p) => p.id === s.turn.active);
    const t = s.players.find((p) => p.id === targetId); if (!buyer || !t) return;
    const price = MARKET[Math.min(MARKET.length - 1, Math.max(0, t.mkt ?? START_AT))];
    buyer.cash -= price;
    t.cash += price;                    // the money goes into the corporation you bought into
    buyer.shares = buyer.shares || {};
    buyer.shares[targetId] = (buyer.shares[targetId] || 0) + 1;
    s.turn.ap = Math.max(0, s.turn.ap - 1);
  }, "bought a share");

  const cells = tab === "map" ? GRID : Object.keys(map.hexes).map((id) => { const [c, r] = parseId(id); return { c, r, id }; });
  const view = useMemo(() => {
    if (!cells.length) return { x0: -100, y0: -100, w: 400, h: 400 };
    const xs = cells.map((g) => cx(g.c, g.r)), ys = cells.map((g) => cy(g.c, g.r));
    return { x0: Math.min(...xs) - R * 1.3, y0: Math.min(...ys) - R * 1.4,
             w: Math.max(...xs) - Math.min(...xs) + R * 2.6, h: Math.max(...ys) - Math.min(...ys) + R * 2.8 };
  }, [cells]);
  const hexPath = (x, y) => Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(x + R * Math.cos(a)).toFixed(1)},${(y + R * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

  const cur = player(me);
  const gameOver = state.mainlineStations >= S.mainlineTarget;

  return (
    <div className="w-full text-stone-900" style={{ display: hidden ? "none" : "block", background: "#F1F1D3" }}>
      <div className="px-4 py-2.5 border-b-2 border-stone-800 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex rounded-sm overflow-hidden border border-stone-800">
          {[["play","Play"],["charter","Charters"],["map","Edit map"]].map(([t, l]) => (
            <button key={t} onClick={() => { setTab(t); setPending(null); if (t !== "charter") setMode(t === "play" ? "build" : "terrain"); }}
              className={`px-3 py-1 text-sm ${tab === t ? "bg-stone-800 text-stone-50" : "hover:bg-white/60"}`}>{l}</button>
          ))}
        </div>
        <button onClick={() => setShowTune((x) => !x)} className={`px-3 py-1 text-sm rounded-sm border ${showTune ? "bg-stone-800 text-stone-50 border-stone-800" : "border-stone-400 hover:bg-white/60"}`}>Tuning</button>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {room ? (
            <>
              <button onClick={() => { const u = shareLink(room, "contracts"); navigator.clipboard?.writeText(u).then(() => setStatus("invite link copied"), () => window.prompt("Copy this link:", u)); }}
                      className="px-3 py-1 bg-stone-800 text-stone-50 rounded-sm">Copy invite link</button>
              <button onClick={() => join("")} className="px-2.5 py-1 border border-stone-500 rounded-sm">Leave</button>
            </>
          ) : (
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const c = cleanCode(roomInput); if (c) join(c); }}>
              <input value={roomInput} onChange={(e) => setRoomInput(e.target.value)} placeholder="table code" className="w-28 bg-white/60 border border-stone-400 px-2 py-1 rounded-sm" />
              <button type="submit" className="px-3 py-1 bg-stone-800 text-stone-50 rounded-sm">Join</button>
            </form>
          )}
          <span className="text-xs text-stone-600">{room ? `“${room}”` : "solo"}{status && ` · ${status}`}</span>
        </div>
      </div>

      {/* turn bar */}
      {tab !== "map" && (
        <div className="px-4 py-2 border-b border-stone-400 flex flex-wrap items-center gap-x-4 gap-y-2 bg-white/40">
          <span className="text-xs uppercase tracking-widest text-stone-600">Round {state.turn.round}</span>
          <span className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-sm" style={{ background: cur?.color }} />
            <span className="font-semibold text-sm">{cur?.name}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-xs text-stone-600 mr-1">AP</span>
            {Array.from({ length: S.apPerTurn }).map((_, i) => (
              <button key={i} onClick={() => commit((s) => { s.turn.ap = i < state.turn.ap ? i : i + 1; })}
                className="w-5 h-5 rounded-full border-2 border-stone-700"
                style={{ background: i < state.turn.ap ? (cur?.color || "#333") : "transparent" }} />
            ))}
          </span>
          <button onClick={endTurn} className="px-3 py-1 text-sm bg-stone-800 text-stone-50 rounded-sm">End turn</button>
          <span className="flex items-center gap-1.5 text-sm">
            <span className="text-xs uppercase tracking-widest text-stone-600">Ridership</span>
            {[100, 75, 50, 25].map((lvl) => (
              <button key={lvl} onClick={() => commit((s) => { s.ridership = lvl; }, `ridership → ${lvl}%`)}
                className={`px-1.5 py-0.5 text-[11px] rounded-sm border tabular-nums ${state.ridership === lvl
                  ? (lvl <= 50 ? "bg-red-700 text-white border-red-700" : "bg-stone-800 text-stone-50 border-stone-800")
                  : "border-stone-400 hover:bg-white/60"}`}>{lvl}%</button>
            ))}
            <span className="text-[11px] text-stone-600 tabular-nums">lines earn {state.ridership}% of full</span>
          </span>
          <span className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-xs uppercase tracking-widest text-stone-600">Mainline</span>
            <button onClick={() => commit((s) => { s.mainlineStations = Math.max(0, s.mainlineStations - 1); })} className="px-1.5 border border-stone-400 rounded-sm">−</button>
            <span className="tabular-nums font-semibold">{state.mainlineStations}<span className="text-stone-500 font-normal"> / {S.mainlineTarget}</span></span>
            <button onClick={() => commit((s) => { s.mainlineStations += 1; })} className="px-1.5 border border-stone-400 rounded-sm">+</button>
            {gameOver && <span className="px-2 py-0.5 text-xs font-bold bg-stone-800 text-stone-50 rounded-sm">GAME END</span>}
          </span>
        </div>
      )}

      {showTune && (
        <div className="px-4 py-3 border-b border-stone-400 bg-white/60">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-0.5 max-w-4xl">
            <Field label="Action points / turn" value={S.apPerTurn} step={1} onChange={(v) => edit((s) => { s.settings.apPerTurn = v; })} onDone={syncNow} />
            <Field label="Starting cash" value={S.subsidy} onChange={(v) => edit((s) => { s.settings.subsidy = v; })} onDone={syncNow} />
            <Field label="Base cost — New" value={S.costNew} onChange={(v) => edit((s) => { s.settings.costNew = v; })} onDone={syncNow} />
            <Field label="Cost per hex of distance" value={S.distCost} onChange={(v) => edit((s) => { s.settings.distCost = v; })} onDone={syncNow} />
            <Field label="Base cost — Expand" value={S.costExpand} onChange={(v) => edit((s) => { s.settings.costExpand = v; })} onDone={syncNow} />
            <Field label="Base cost — Extend" value={S.costExtend} onChange={(v) => edit((s) => { s.settings.costExtend = v; })} onDone={syncNow} />
            <Field label="Water hex surcharge" value={S.waterCost} onChange={(v) => edit((s) => { s.settings.waterCost = v; })} onDone={syncNow} />
            <Field label="River crossing" value={S.riverCost} onChange={(v) => edit((s) => { s.settings.riverCost = v; })} onDone={syncNow} />
            <Field label="Contract timer" value={S.contractTimer} step={1} onChange={(v) => edit((s) => { s.settings.contractTimer = v; })} onDone={syncNow} suffix="rd" />
            <Field label="Payout to company" value={S.payoutToCompany} step={5} onChange={(v) => edit((s) => { s.settings.payoutToCompany = v; })} onDone={syncNow} suffix="%" />
            <Field label="Car upkeep (each, per round)" value={S.maintPerCar} step={5} onChange={(v) => edit((s) => { s.settings.maintPerCar = v; })} onDone={syncNow} />
            <Field label="Red zone at or below" value={S.redZoneAt} step={10} onChange={(v) => edit((s) => { s.settings.redZoneAt = v; })} onDone={syncNow} />
            <Field label="Line repays its base over" value={S.paybackRounds} step={1} onChange={(v) => edit((s) => { s.settings.paybackRounds = v; })} onDone={syncNow} suffix="rd" />
            <Field label="Rider demand per line" value={S.demandPerLine} step={1} onChange={(v) => edit((s) => { s.settings.demandPerLine = v; })} onDone={syncNow} suffix="car" />
            <label className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-xs text-stone-600">Apply upkeep automatically</span>
              <input type="checkbox" checked={!!S.autoUpkeep} onChange={(e) => commit((s) => { s.settings.autoUpkeep = e.target.checked; })} />
            </label>
            <Field label="Mainline endgame at" value={S.mainlineTarget} step={1} onChange={(v) => edit((s) => { s.settings.mainlineTarget = v; })} onDone={syncNow} />
            <label className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-xs text-stone-600">Network size =</span>
              <select value={S.networkMetric} onChange={(e) => commit((s) => { s.settings.networkMetric = e.target.value; })}
                      className="text-xs bg-white border border-stone-300 rounded-sm py-0.5">
                <option value="stations">stations</option><option value="track">track segments</option><option value="hexes">hexes touched</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-xs text-stone-600">Distance measured to</span>
              <select value={S.distanceTo} onChange={(e) => commit((s) => { s.settings.distanceTo = e.target.value; })}
                      className="text-xs bg-white border border-stone-300 rounded-sm py-0.5">
                <option value="any">any station</option><option value="own">your own only</option>
              </select>
            </label>
          </div>
          <p className="text-[11px] text-stone-500 mt-2 max-w-3xl">
            One income system: you receive the subsidy when you win a contract, and the line earns every round once it opens.
            A line at full service ({S.demandPerLine} cars) earns its base ÷ {S.paybackRounds} per round, scaled by ridership.
            Each car costs ${S.maintPerCar} a round whether or not its line is open — so a line only clears upkeep once its base exceeds{" "}
            <b className="tabular-nums">${S.maintPerCar * S.paybackRounds * S.demandPerLine}</b>.
          </p>
        </div>
      )}

      {tab === "charter" ? (
        <div className="p-4 space-y-4">
          <p className="text-xs text-stone-600 max-w-2xl">
            One mat per corporation. Token circles fill left to right — click one to set how many you’ve placed; the next cost updates.
            The boxes beside each contract are the units assigned to that line. Timers tick when the round advances; leave one blank for no timer.
          </p>
          {state.players.map((p) => (
            <Charter key={p.id} p={p} S={S} isActive={p.id === me} commit={commit} edit={edit}
                     syncNow={syncNow} onComplete={completeContract} network={network[p.id]} ridership={state.ridership} />
          ))}
          <button onClick={() => commit((s) => { const ids = s.players.map((x) => x.id); let i = 0; while (ids.includes(i)) i++;
                    const q = newPlayer(i); q.cash = s.settings.subsidy; q.charter = blankCharter(s.settings); s.players.push(q); }, "added a corporation")}
                  className="text-xs underline text-stone-600">add a corporation</button>
        </div>
      ) : (
      <div className="flex flex-col lg:flex-row">
        <div className="flex-1 min-w-0 p-3">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {(tab === "play"
              ? [["build","Track"],["station","Station"],["erase","Clear"]]
              : [["terrain","Paint terrain"],["name","Name a hex"],["edge","Rivers & walls"]]
            ).map(([m, l]) => (
              <button key={m} onClick={() => { setMode(m); setPending(null); }}
                className={`px-3 py-1.5 text-sm rounded-sm border ${mode === m ? "bg-stone-800 text-stone-50 border-stone-800" : "border-stone-400 hover:bg-white/60"}`}>{l}</button>
            ))}
            {tab === "map" && mode === "terrain" && (
              <>
                {Object.entries(TERRAIN).map(([k, t]) => (
                  <button key={k} onClick={() => setPaint(k)} className={`px-2.5 py-1 text-xs rounded-sm border-2 ${paint === k ? "border-stone-900" : "border-stone-300"}`} style={{ background: t.fill }}>{t.label}</button>
                ))}
                <button onClick={() => setPaint("x")} className={`px-2.5 py-1 text-xs rounded-sm border-2 ${paint === "x" ? "border-stone-900" : "border-stone-300"} bg-white/50`}>Remove hex</button>
              </>
            )}
            {tab === "play" && <span className="text-xs text-stone-600">Building as <b>{cur?.name}</b> — everything you place belongs to the active player.</span>}
          </div>

          <div className="bg-white/40 border border-stone-400 rounded-sm overflow-auto" style={{ maxHeight: "62vh" }}>
            <svg viewBox={`${view.x0} ${view.y0} ${view.w} ${view.h}`} className="w-full" style={{ minWidth: 720 }}>
              {cells.map(({ c, r, id }) => {
                const k = map.hexes[id]; if (!k && tab !== "map") return null;
                const x = cx(c, r), y = cy(c, r);
                return (
                  <g key={id} onClick={() => onHex(id, !!k)} className="cursor-pointer">
                    <polygon points={hexPath(x, y)} fill={k ? TERRAIN[k].fill : "#00000008"} stroke={k ? "#4a4a44" : "#00000022"} strokeWidth={k ? 0.8 : 0.6} strokeDasharray={k ? "" : "3 3"} />
                    {sel === id && tab === "play" && <polygon points={hexPath(x, y)} fill="none" stroke="#B45309" strokeWidth="3" />}
                    {hoverC !== null && (byId(hoverC)?.l || []).some((nm) => hexForName(nm) === id) &&
                      <polygon points={hexPath(x, y)} fill="#B4530922" stroke="#B45309" strokeWidth="4" />}
                    {pending === id && <polygon points={hexPath(x, y)} fill="none" stroke="#111" strokeWidth="3" />}
                    {map.names[id] && <text x={x} y={y + 19} textAnchor="middle" style={{ fontSize: 7, pointerEvents: "none" }} fill="#2b2b26">{map.names[id].length > 17 ? map.names[id].split(" ").slice(0, 2).join(" ") : map.names[id]}</text>}
                  </g>
                );
              })}

              {Object.keys(state.track).map((k) => {
                const ids = trackAt(k); if (!ids.length) return null;
                const [a, b] = k.split("|"); const [ac, ar] = parseId(a), [bc, br] = parseId(b);
                const x1 = cx(ac, ar), y1 = cy(ac, ar), x2 = cx(bc, br), y2 = cy(bc, br);
                let ux = x2 - x1, uy = y2 - y1; const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
                const px = -uy, py = ux;
                return (
                  <g key={k} pointerEvents="none">
                    {ids.map((cid, i) => {
                      const o = (i - (ids.length - 1) / 2) * 5.5;
                      return (
                        <g key={cid}>
                          <line x1={x1 + px * o} y1={y1 + py * o} x2={x2 + px * o} y2={y2 + py * o} stroke="#fff" strokeWidth="6.5" strokeLinecap="round" />
                          <line x1={x1 + px * o} y1={y1 + py * o} x2={x2 + px * o} y2={y2 + py * o} stroke={colorOf(cid)} strokeWidth="4" strokeLinecap="round" />
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {(map.nocross || []).map((k) => { const [a, b] = k.split("|"); const e = sharedEdge(a, b);
                return <line key={"n" + k} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#1F5432" strokeWidth="6" strokeLinecap="round" pointerEvents="none" />; })}
              {(map.rivers || []).map((k) => { const [a, b] = k.split("|"); const e = sharedEdge(a, b);
                return <line key={"r" + k} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#2674BA" strokeWidth="6" strokeLinecap="round" pointerEvents="none" />; })}

              {cells.map(({ c, r, id }) => {
                if (!map.hexes[id]) return null;
                const x = cx(c, r), y = cy(c, r);
                const st = state.stations[id], named = !!map.names[id];
                return (
                  <g key={"m" + id} onClick={() => onHex(id, true)} className="cursor-pointer">
                    {named && !st && <circle cx={x} cy={y} r="7" fill="#111" />}
                    {st && st.l === 1 && <circle cx={x} cy={y} r="6" fill="#fff" stroke={colorOf(st.o)} strokeWidth="3" />}
                    {st && st.l === 2 && <><circle cx={x} cy={y} r="10.5" fill="#fff" stroke={colorOf(st.o)} strokeWidth="3.5" /><circle cx={x} cy={y} r="3.5" fill={colorOf(st.o)} /></>}
                  </g>
                );
              })}
            </svg>
          </div>

          {naming && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                     onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setNaming(null); }}
                     className="flex-1 max-w-xs bg-white/70 border border-stone-400 px-2 py-1 rounded-sm" placeholder={`name for ${naming}`} />
              <button onClick={saveName} className="px-3 py-1 bg-stone-800 text-stone-50 rounded-sm">Save</button>
              <button onClick={() => setNaming(null)} className="px-2 py-1 border border-stone-400 rounded-sm">Cancel</button>
            </div>
          )}

          {/* build calculator */}
          {tab === "play" && (
            <div className="mt-2 border border-stone-400 rounded-sm bg-white/60 p-2.5">
              {!sel ? <p className="text-xs text-stone-500">Click a hex to price a build there.</p> : (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
                  <span className="font-semibold">{map.names[sel] || sel}</span>
                  <span className="text-stone-600">nearest station: <b className="tabular-nums">{buildCost?.d === null ? "none yet" : buildCost.d + " hex"}</b></span>
                  {buildCost?.terrain > 0 && <span className="text-stone-600">water +{buildCost.terrain}</span>}
                  <span className="ml-auto flex gap-2">
                    {[["New", buildCost?.neu],["Expand", buildCost?.expand],["Extend", buildCost?.extend]].map(([l, v]) => (
                      <button key={l} disabled={state.turn.ap < 1}
                        onClick={() => commit((s) => {
                          const p = s.players.find((x) => x.id === s.turn.active); if (p) p.cash -= v;
                          s.turn.ap = Math.max(0, s.turn.ap - 1);
                        }, `${l} at ${map.names[sel] || sel} for $${v}`)}
                        className="px-2 py-1 rounded-sm border border-stone-400 hover:bg-white disabled:opacity-40">
                        {l} <b className="tabular-nums">${v}</b>
                      </button>
                    ))}
                  </span>
                </div>
              )}
            </div>
          )}

          {tab === "map" && (
            <div className="mt-2 flex gap-3 text-xs">
              <button onClick={() => { const b = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "nyc-metro-map.json"; a.click(); }} className="underline">Download map</button>
              <button onClick={() => fileRef.current?.click()} className="underline">Load map</button>
              <input ref={fileRef} type="file" accept="application/json" className="hidden"
                     onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader();
                       rd.onload = () => { try { const m = JSON.parse(rd.result); if (!m.hexes) throw 0;
                         commit((s) => { s.map = { hexes: m.hexes, names: m.names || {}, rivers: m.rivers || [], nocross: m.nocross || [] }; }, "loaded a map"); } catch { setStatus("not a map file"); } };
                       rd.readAsText(f); e.target.value = ""; }} />
            </div>
          )}
        </div>

        {/* ── side panel ── */}
        <div className="w-full lg:w-[390px] shrink-0 border-l-2 border-stone-800 p-4 space-y-5 text-sm">
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h2 style={{ fontFamily: "'Roboto Slab', serif" }} className="text-xs uppercase tracking-widest text-stone-600">Corporations</h2>
              <button onClick={() => commit((s) => { const ids = s.players.map((p) => p.id); let i = 0; while (ids.includes(i)) i++; const p = newPlayer(i); p.cash = s.settings.subsidy; s.players.push(p); }, "added a corporation")} className="text-xs underline">add</button>
            </div>
            <div className="space-y-2">
              {state.players.map((p, idx) => {
                const n = network[p.id] || { size: 0, price: 0, stations: 0, segs: 0, hexes: 0 };
                const isMe = p.id === me;
                return (
                  <div key={p.id} className={`border rounded-sm p-2 ${isMe ? "border-stone-800 bg-white/70" : "border-stone-400 bg-white/40"}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <input type="color" value={p.color} onChange={(e) => edit((s) => { s.players[idx].color = e.target.value; })} onBlur={syncNow} className="w-5 h-5 rounded-sm border-0 bg-transparent p-0 cursor-pointer shrink-0" />
                      <input value={p.name} onChange={(e) => edit((s) => { s.players[idx].name = e.target.value; })} onBlur={syncNow} className="flex-1 min-w-0 font-semibold bg-transparent border-b border-stone-300 focus:outline-none text-sm" />
                      <button onClick={() => commit((s) => { s.turn.active = p.id; })} className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${isMe ? "bg-stone-800 text-stone-50 border-stone-800" : "border-stone-400"}`}>{isMe ? "active" : "make active"}</button>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-center mb-1.5">
                      {[["cash", "$" + p.cash],["network", n.size],["done", p.done]].map(([l, v]) => (
                        <div key={l} className="bg-stone-100/70 rounded-sm py-1">
                          <div className="text-[9px] uppercase tracking-wide text-stone-500">{l}</div>
                          <div className="text-sm font-semibold tabular-nums">{v}</div>
                        </div>
                      ))}
                      <div className={`rounded-sm py-1 ${n.red ? "bg-red-200" : "bg-stone-100/70"}`}>
                        <div className="text-[9px] uppercase tracking-wide text-stone-500">share</div>
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => moveMkt(p.id, -1)} className="px-1 text-xs border border-stone-400 rounded-sm leading-none">−</button>
                          <span className="text-sm font-semibold tabular-nums">{n.price}</span>
                          <button onClick={() => moveMkt(p.id, 1)} className="px-1 text-xs border border-stone-400 rounded-sm leading-none">+</button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-stone-600">
                      <span>{n.stations} stn · {n.segs} track · {n.hexes} hex</span>
                      <span className="flex items-center gap-1">
                        <button onClick={() => commit((s) => { const q = s.players.find((x) => x.id === p.id); q.done = Math.max(0, q.done - 1); })} className="px-1 border border-stone-300 rounded-sm">−</button>
                        <span>contracts</span>
                        <button onClick={() => commit((s) => { const q = s.players.find((x) => x.id === p.id); q.done += 1; })} className="px-1 border border-stone-300 rounded-sm">+</button>
                      </span>
                    </div>
                    {!isMe && (
                      <button onClick={() => buyShare(p.id)} disabled={state.turn.ap < 1}
                        className="mt-1.5 w-full text-xs py-1 rounded-sm border border-stone-500 hover:bg-white disabled:opacity-40">
                        Buy a share — ${n.price} · 1 AP
                      </button>
                    )}
                    <div className="mt-1.5 pt-1.5 border-t border-stone-300">
                      <div className="text-[9px] uppercase tracking-wide text-stone-500 mb-0.5">holds shares in</div>
                      <div className="flex flex-wrap gap-1.5">
                        {state.players.map((t) => {
                          const held = (p.shares || {})[t.id] || 0;
                          return (
                            <span key={t.id} className={`flex items-center gap-0.5 rounded-sm px-1 py-0.5 ${held ? "" : "opacity-45"}`}
                                  style={{ background: held ? t.color + "22" : "transparent", border: `1px solid ${t.color}` }}>
                              <span className="w-2 h-2 rounded-sm" style={{ background: t.color }} />
                              <button onClick={() => giveShare(p.id, t.id, -1)} className="px-0.5 text-[11px] leading-none text-stone-600">−</button>
                              <span className="text-[11px] font-semibold tabular-nums w-3 text-center">{held}</span>
                              <button onClick={() => giveShare(p.id, t.id, 1)} className="px-0.5 text-[11px] leading-none text-stone-600">+</button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <div className="flex items-baseline justify-between mb-1">
              <h2 style={{ fontFamily: "'Roboto Slab', serif" }} className="text-xs uppercase tracking-widest text-stone-600">Contract market</h2>
              <span className="flex gap-1">
                {[1, 2, 3].map((e) => (
                  <button key={e} onClick={() => { if (e === state.market?.era || confirm(`Open Era ${e}? This replaces the face-up contracts and reshuffles.`)) openEra(e); }}
                    className={`px-1.5 py-0.5 text-[11px] rounded-sm border ${state.market?.era === e ? "bg-stone-800 text-stone-50 border-stone-800" : "border-stone-400 hover:bg-white/60"}`}>
                    E{e}
                  </button>
                ))}
              </span>
            </div>
            <p className="text-[11px] text-stone-500 mb-2">
              {ERA_LABEL[state.market?.era || 1]} · {(state.market?.deck || []).length} left in the deck
            </p>
            <div className="space-y-1.5">
              {!(state.market?.up || []).length && <p className="text-xs text-stone-500">Deck exhausted — open the next era.</p>}
              {(state.market?.up || []).map((cid) => {
                const c = byId(cid); if (!c) return null;
                return (
                  <div key={cid} onMouseEnter={() => setHoverC(cid)} onMouseLeave={() => setHoverC(null)}
                       className={`border rounded-sm p-2 ${hoverC === cid ? "border-amber-600 bg-amber-50/70" : "border-stone-400 bg-white/60"}`}>
                    <div className="text-xs font-medium leading-snug">{contractLabel(c)}</div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-stone-600">
                      <span className="tabular-nums">pays <b className="text-stone-900">${c.b}</b></span>
                      <span className="tabular-nums">difficulty {c.d}</span>
                      <button onClick={() => discard(cid)} className="ml-auto text-stone-400 hover:text-stone-700">pass</button>
                    </div>
                    <div className="flex items-center gap-1 mt-1.5">
                      <select value={bidTo[cid] ?? me}
                              onChange={(e) => setBidTo((b) => ({ ...b, [cid]: Number(e.target.value) }))}
                              className="text-[11px] bg-white border border-stone-300 rounded-sm py-0.5 flex-1 min-w-0">
                        {state.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input type="number" step={10} placeholder="subsidy" value={bids[cid] ?? ""}
                             onChange={(e) => setBids((b) => ({ ...b, [cid]: e.target.value }))}
                             className="w-16 text-[11px] bg-white border border-stone-300 rounded-sm px-1 py-0.5 text-right tabular-nums focus:outline-none" />
                      <button onClick={() => { award(cid, bidTo[cid] ?? me, Number(bids[cid]) || 0);
                                               setBids((b) => ({ ...b, [cid]: "" })); }}
                              className="px-2 py-0.5 text-[11px] bg-stone-800 text-stone-50 rounded-sm">Award</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-stone-500 mt-1.5">
              Bidding runs <b>downward</b>: the bid is the subsidy the winner accepts to build the line. It is paid to them on award.
              A negative bid means they pay the city for the franchise.
            </p>
          </section>

          <section>
            <div className="flex items-baseline justify-between mb-1">
              <h2 style={{ fontFamily: "'Roboto Slab', serif" }} className="text-xs uppercase tracking-widest text-stone-600">Share ladder</h2>
              <label className="flex items-center gap-1 text-[11px] text-stone-600">
                <input type="checkbox" checked={!!S.autoMarket}
                       onChange={(e) => commit((s) => { s.settings.autoMarket = e.target.checked; })} />
                move automatically
              </label>
            </div>
            <p className="text-[11px] text-stone-500 mb-1.5">
              A line that cleared upkeep suggests a step up; one that lost money, a step down.
              {S.autoMarket ? " Applied at the end of each round." : " Nothing moves unless you move it — check the log for the suggestion."}
              {" "}Click a row to drop <b>{cur?.name}</b> there, or use the ± on any corporation card.
              {" "}At ${S.redZoneAt} and below the city is circling.
            </p>
            <div className="border border-stone-500 rounded-sm overflow-hidden max-h-56 overflow-y-auto">
              {MARKET.map((v, i) => {
                const here = state.players.filter((p) => (p.mkt ?? START_AT) === i);
                const red = v <= (S.redZoneAt || 0);
                return (
                  <div key={v} onClick={() => setMkt(me, i)} title={`Move ${cur?.name} here`}
                       className="flex items-center justify-between px-2 py-0.5 border-b border-stone-300 last:border-0 text-xs cursor-pointer hover:brightness-95"
                       style={{ background: red ? "#F0837F" : "#fff" }}>
                    <span className="tabular-nums font-medium">{v}</span>
                    <span className="flex gap-1">
                      {here.map((p) => (
                        <span key={p.id} className="px-1 rounded-sm text-[10px] font-bold"
                              style={{ background: p.color, color: "#fff" }}>{p.abbr}</span>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 style={{ fontFamily: "'Roboto Slab', serif" }} className="text-xs uppercase tracking-widest mb-2 text-stone-600">Mainline shares</h2>
            <div className="space-y-1">
              {state.players.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
                  <span className="flex-1 truncate">{p.name}</span>
                  <button onClick={() => commit((s) => { const q = s.players.find((x) => x.id === p.id); q.mainline = Math.max(0, (q.mainline || 0) - 1); })} className="px-1 border border-stone-300 rounded-sm">−</button>
                  <span className="w-6 text-center tabular-nums font-semibold">{p.mainline || 0}</span>
                  <button onClick={() => commit((s) => { const q = s.players.find((x) => x.id === p.id); q.mainline = (q.mainline || 0) + 1; })} className="px-1 border border-stone-300 rounded-sm">+</button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 style={{ fontFamily: "'Roboto Slab', serif" }} className="text-xs uppercase tracking-widest mb-2 text-stone-600">Log</h2>
            <div className="max-h-28 overflow-auto text-xs text-stone-600 space-y-0.5">
              {!(state.log || []).length && <p className="text-stone-500">Nothing yet.</p>}
              {(state.log || []).map((l, i) => <div key={i}><span className="font-medium">{l.who}</span> {l.note}</div>)}
            </div>
          </section>

          <button onClick={() => { if (!confirm("Reset the game? Your map and tuning are kept.")) return;
                    const f = makeInitial(); f.map = JSON.parse(JSON.stringify(map)); f.settings = { ...S };
                    f.players = state.players.map((p) => ({ ...p, cash: S.subsidy, done: 0, shares: {}, mainline: 0, mkt: START_AT, charter: blankCharter(S) }));
                    f.ridership = 100; commit(() => f, "reset the game"); }}
                  className="text-xs text-stone-500 underline">Reset game (keep map & tuning)</button>
        </div>
      </div>
      )}
    </div>
  );
}
