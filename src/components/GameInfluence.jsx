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
import { backend } from "../lib/storage.js";

const ago = (t) => {
  if (!t) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

export default function GameInfluence({ hidden }) {
  const [roomInput, setRoomInput] = useState("");
  const [tab, setTab] = useState("play");
  const [mode, setMode] = useState("track");
  const [paint, setPaint] = useState("l");
  const [activeLine, setActiveLine] = useState(0);
  const [pending, setPending] = useState(null);
  const [sel, setSel] = useState(null);
  const [showZones, setShowZones] = useState(true);
  const [showTune, setShowTune] = useState(false);
  const [reveal, setReveal] = useState(true);
  const [status, setStatus] = useState("");
  const [showTally, setShowTally] = useState(false);
  const [zoom, setZoom] = useState(() => (typeof window !== "undefined" && window.innerWidth < 640 ? 1.6 : 1));   // bigger hexes to tap on a phone
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  const [mergeFrom, setMergeFrom] = useState(0);
  const [mergeTo, setMergeTo] = useState(1);

  const seatRef = useRef(undefined);
  const T = useTable("i", () => makeV2(), {
    finish: (n) => { if (n.settings.strict) syncMarkers(n); },
    who: (s) => {
      const sid = seatRef.current;
      const p = sid !== null && sid !== undefined ? s.players.find((x) => x.id === sid) : s.players.find((x) => x.id === s.turn.active);
      return p?.name || "?";
    },
  });
  const { state, room, join, commit, diag, seat, setSeat, since } = T;
  seatRef.current = seat;
  const edit = useCallback((mut) => commit(mut, null, { quiet: true }), [commit]);
  const syncNow = () => {};
  const undo = () => { const r = T.undo(); if (r?.why) setStatus(r.why); };
  const hexName = (h) => state.map?.names?.[h] || h;

  /* what other players changed since my last move */
  const changed = useMemo(() => {
    const hexes = new Set(), edges = [], out = { hexes, edges, log: 0 };
    if (!room || !since || since === state) return out;
    const tk = new Set([...Object.keys(since.track || {}), ...Object.keys(state.track || {})]);
    tk.forEach((k) => {
      if (JSON.stringify(since.track?.[k]) !== JSON.stringify(state.track?.[k])) {
        edges.push({ k, gone: !state.track?.[k] }); k.split("|").forEach((h) => hexes.add(h));
      }
    });
    const sk = new Set([...Object.keys(since.stations || {}), ...Object.keys(state.stations || {})]);
    sk.forEach((h) => { if (JSON.stringify(since.stations?.[h]) !== JSON.stringify(state.stations?.[h])) hexes.add(h); });
    const newest = since.log?.[0]?.t || 0;
    out.log = (state.log || []).filter((l) => (l.t || 0) > newest).length;
    return out;
  }, [room, since, state]);

  const S = state.settings || V2D;
  const map = state.map || seedMap();
  const me = state.turn.active;
  const cur = state.players[me];
  const colorOf = (id) => lineOf(id)?.color || "#333";
  const handCount = (p, lid) => (p?.hand || []).filter((d) => d === lid).length;
  const over = state.turn.round > S.roundLimit;

  const reach = useMemo(() => {
    const out = {};
    LINES.forEach((l) => {
      out[l.id] = { stations: stationsOf(state, l.id), zones: [...zonesOf(state, l.id)],
                    links: countLinks(state, l.id), per: perShare(state, l.id),
                    price: priceOf(state, l.id), left: sharesLeft(state, l.id) };
    });
    return out;
  }, [state]);

  const acquirer = useMemo(() => {
    let best = null;
    LINES.forEach((l) => { const n = stationsOf(state, l.id); if (!best || n > best.n) best = { id: l.id, n }; });
    return best;
  }, [state]);

  /* which extensions are legal for the active line, and what they cost */
  const legal = useMemo(() => {
    const lid = activeLine, out = {};
    const net = lineNet(state, lid), deg = lineDegree(state, lid);
    const cap = (h) => (state.stations[h]?.o === lid ? S.branchAt : 2);
    net.forEach((h) => {
      if ((deg[h] || 0) >= cap(h)) return;
      const [c, r] = parseId(h);
      neighbors(c, r).forEach(([nc, nr]) => {
        const m = `${nc},${nr}`;
        if (!map.hexes[m]) return;
        const k = edgeKey(h, m);
        if ((map.nocross || []).includes(k)) return;
        if (state.track[k]) return;                        // exclusive
        if ((deg[m] || 0) >= cap(m)) return;
        let toll = [];
        if (S.crossMode !== "free") {
          const foreign = new Set();
          [h, m].forEach((x) => { if (!state.stations[x]) occupants(state, x).forEach((o) => { if (o !== lid) foreign.add(o); }); });
          if (foreign.size) {
            if (S.crossMode === "station") return;          // blocked outright
            toll = S.crossPay === "own" ? [[lid, S.crossDiscs]] : [...foreign].map((o) => [o, S.crossDiscs]);
          }
        }
        const water = map.hexes[m] === "w" ? S.waterExtra : 0;
        out[k] = { toll, water, target: m };
      });
    });
    return out;
  }, [state, activeLine, S, map]);

  const canPay = (info) => {
    if (!info || !cur) return false;
    let need = 1 + info.water;
    if (handCount(cur, activeLine) < need) return false;
    for (const [col, n] of info.toll) {
      const extra = col === activeLine ? need : 0;
      if (handCount(cur, col) < n + extra) return false;
    }
    return true;
  };

  const onHex = (id, exists) => {
    if (tab === "map") {
      if (mode === "terrain") commit((s) => { if (paint === "x") { delete s.map.hexes[id]; delete s.map.names[id]; } else s.map.hexes[id] = paint; }, `map ${id}`);
      return;
    }
    if (!exists) return;
    setSel(id);
    if (mode === "track") {
      if (!pending) { setPending(id); setStatus(""); return; }
      if (pending === id) { setPending(null); setStatus(""); return; }
      const [pc, pr] = parseId(pending);
      if (!neighbors(pc, pr).some(([c2, r2]) => `${c2},${r2}` === id)) { setPending(id); setStatus("those two hexes aren't neighbours"); return; }
      const k = edgeKey(pending, id);

      if (!S.strict) {                       // SANDBOX: place or clear, no rules, no cost
        const removing = trackOwner(state, k) === activeLine;
        commit((s2) => {
          if (trackOwner(s2, k) === activeLine) delete s2.track[k];
          else s2.track[k] = [activeLine];
        }, `${removing ? "removed" : "laid"} ${lineOf(activeLine).name} track ${hexName(pending)} – ${hexName(id)}`);
        setPending(id); setStatus(""); return;
      }

      const info = legal[k];
      if (!info) {
        const net = lineNet(state, activeLine);
        if (state.track[k]) setStatus(`that track already belongs to ${lineOf(trackOwner(state, k))?.name}`);
        else if (!net.has(pending) && !net.has(id)) setStatus(`${lineOf(activeLine).name} has no track or station there`);
        else setStatus("that end already has its maximum connections — branch at one of your stations");
        setPending(id); return;
      }
      if (!canPay(info)) {
        const need = 1 + info.water + info.toll.reduce((x, [, n]) => x + n, 0);
        setStatus(`need ${need} disc${need > 1 ? "s" : ""} — ${cur?.name} doesn't hold them`);
        setPending(id); return;
      }
      commit((s2) => {
        const p = s2.players.find((x) => x.id === s2.turn.active);
        const take = (col, n) => { for (let i = 0; i < n; i++) { const ix = p.hand.indexOf(col); if (ix >= 0) { p.hand.splice(ix, 1); s2.bag.push(col); } } };
        take(activeLine, 1 + info.water);
        info.toll.forEach(([col, n]) => take(col, n));
        if (s2.settings.ownership === "hex") { const ix = s2.bag.lastIndexOf(activeLine); if (ix >= 0) { s2.bag.splice(ix, 1); s2.onboard.push(activeLine); } }
        s2.track[k] = [activeLine];
        if (s2.settings.autoAP) s2.turn.ap = Math.max(0, s2.turn.ap - 1);
      }, `laid ${lineOf(activeLine).name} track ${hexName(pending)} – ${hexName(id)}`);
      setPending(id); setStatus(""); return;
    }
    if (mode === "station") {
      if (!S.strict) {                       // SANDBOX
        const removing = state.stations[id]?.o === activeLine;
        commit((s2) => {
          if (s2.stations[id] && s2.stations[id].o === activeLine) delete s2.stations[id];
          else s2.stations[id] = { o: activeLine };
        }, `${removing ? "removed" : "built"} a ${lineOf(activeLine).name} station at ${hexName(id)}`);
        setStatus(""); return;
      }
      if (!state.stations[id]) {
        const net = lineNet(state, activeLine);
        if (!net.has(id)) { setStatus(`${lineOf(activeLine).name} has no track there`); return; }
        const c = stationCost(state, id);
        if (handCount(cur, activeLine) < c) { setStatus(`that station costs ${c} discs — ${cur?.name} holds ${handCount(cur, activeLine)}`); return; }
      }
      setStatus("");
      commit((s2) => {
        if (s2.stations[id]) { delete s2.stations[id]; return; }
        const p = s2.players.find((x) => x.id === s2.turn.active);
        const c = stationCost(s2, id), burn = burnCount(s2, c);
        for (let i = 0; i < c; i++) { const ix = p.hand.indexOf(activeLine); if (ix >= 0) p.hand.splice(ix, 1); }
        for (let i = 0; i < burn; i++) s2.burned.push(activeLine);
        for (let i = 0; i < c - burn; i++) s2.bag.push(activeLine);
        s2.stations[id] = { o: activeLine };
        if (s2.settings.autoAP) s2.turn.ap = Math.max(0, s2.turn.ap - 1);
      }, `${lineOf(activeLine).name} station at ${hexName(id)}`);
      return;
    }
  };

  const drawDiscs = () => commit((s) => {
    const p = s.players.find((x) => x.id === s.turn.active);
    for (let i = 0; i < s.settings.drawCount; i++) {
      if (!s.bag.length || p.hand.length >= s.settings.handLimit) break;
      p.hand.push(s.bag.pop());
    }
    s.turn.ap = Math.max(0, s.turn.ap - 1);
  }, "drew influence");

  const invest = (lid, wild) => commit((s) => {
    const p = s.players.find((x) => x.id === s.turn.active);
    if (s.turn.invests >= s.settings.investPerTurn) return;
    const price = priceOf(s, lid);
    if (s.settings.strict) {
      if (sharesLeft(s, lid) <= 0) return;
      if (p.cash < price) return;
      if (wild) {
        if (p.hand.length < s.settings.wildCost) return;
        for (let i = 0; i < s.settings.wildCost; i++) s.bag.push(p.hand.pop());
      } else {
        const ix = p.hand.indexOf(lid);
        if (ix < 0) return;
        p.hand.splice(ix, 1); s.bag.push(lid);
      }
    } else {
      const ix = p.hand.indexOf(lid);
      if (ix >= 0) { p.hand.splice(ix, 1); s.bag.push(lid); }
    }
    p.cash -= price; p.shares[lid] = (p.shares[lid] || 0) + 1; s.sold[lid] += 1;
    s.turn.invests += 1;
    if (s.settings.autoAP && !s.turn.usedSlot) { s.turn.usedSlot = true; s.turn.ap = Math.max(0, s.turn.ap - 1); }
  }, `bought a ${lineOf(lid)?.name} share`);

  const callDividends = () => commit((s) => {
    s.players.forEach((p) => {
      let paid = 0;
      Object.entries(p.shares || {}).forEach(([lid, n]) => { paid += n * perShare(s, Number(lid)); });
      p.cash += paid;
    });
    LINES.forEach((l) => { s.prices[l.id] = (s.prices[l.id] ?? s.settings.startPrice) + Math.round(perShare(s, l.id) * s.settings.priceGrowth); });
    if (s.settings.autoAP && !s.turn.usedSlot) { s.turn.usedSlot = true; s.turn.ap = Math.max(0, s.turn.ap - 1); }
  }, "called for dividends");

  const endTurn = () => commit((s) => {
    const n = s.players.length || 1;
    const i = (s.players.findIndex((p) => p.id === s.turn.active) + 1) % n;
    s.turn.active = s.players[i].id; s.turn.ap = s.settings.apPerTurn;
    s.turn.invests = 0; s.turn.usedSlot = false;
    if (i === 0) s.turn.round += 1;
  }, "ended turn");

  const doMerge = () => commit((s) => {
    const from = mergeFrom, to = mergeTo;
    if (from === to) return;
    Object.keys(s.track).forEach((k) => { if (trackOwner(s, k) === from) s.track[k] = [to]; });
    Object.entries(s.stations).forEach(([h, x]) => { if (x.o === from) s.stations[h] = { o: to }; });
    s.players.forEach((p) => { if (p.shares?.[from]) { p.shares[to] = (p.shares[to] || 0) + p.shares[from]; delete p.shares[from]; } });
    s.sold[to] = Math.min(s.settings.sharesPerLine, (s.sold[to] || 0) + (s.sold[from] || 0));
    s.sold[from] = 0; s.prices[from] = s.settings.startPrice;
  }, `merged ${lineOf(mergeFrom)?.name} into ${lineOf(mergeTo)?.name}`);

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
  const zoneBorders = useMemo(() => {
    const out = [], seen = new Set();
    Object.keys(ZONE_OF).forEach((id) => {
      const [c, r] = parseId(id);
      neighbors(c, r).forEach(([nc, nr]) => {
        const nid = `${nc},${nr}`;
        if (ZONE_OF[nid] === undefined || ZONE_OF[nid] === ZONE_OF[id]) return;
        const k = edgeKey(id, nid);
        if (seen.has(k)) return;
        seen.add(k); out.push(sharedEdge(id, nid));
      });
    });
    return out;
  }, []);
  const netHexes = useMemo(() => lineNet(state, activeLine), [state, activeLine]);
  const crossHexes = useMemo(() => {
    const out = new Set();
    Object.keys(map.hexes).forEach((h) => { if (occupants(state, h).size > 1) out.add(h); });
    return out;
  }, [state, map.hexes]);

  const selCost = sel && map.hexes[sel] ? { d: nearestStation(state, sel), c: stationCost(state, sel) } : null;
  const N = (label, key, step = 1, suffix) => (
    <Field label={label} value={S[key]} step={step} suffix={suffix}
           onChange={(v) => edit((s) => { s.settings[key] = v; })} onDone={syncNow} />
  );
  const Sel = (label, key, opts) => (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-stone-600">{label}</span>
      <select value={S[key]} onChange={(e) => commit((s) => { s.settings[key] = e.target.value; })}
              className="text-xs bg-white border border-stone-300 rounded-sm py-0.5">
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <div className="w-full text-stone-900" style={{ display: hidden ? "none" : "block", background: "#F1F1D3" }}>
      <div className="px-4 py-2.5 border-b-2 border-stone-800 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex rounded-sm overflow-hidden border border-stone-800">
          {[["play", "Play"], ["map", "Edit map"]].map(([t, l]) => (
            <button key={t} onClick={() => { setTab(t); setPending(null); setMode(t === "play" ? "track" : "terrain"); }}
              className={`px-3 py-1 text-sm ${tab === t ? "bg-stone-800 text-stone-50" : "hover:bg-white/60"}`}>{l}</button>
          ))}
        </div>
        <button onClick={() => setShowZones((z) => !z)} className={`px-2.5 py-1 text-sm rounded-sm border ${showZones ? "bg-stone-800 text-stone-50 border-stone-800" : "border-stone-400"}`}>Zones</button>
        <button onClick={() => setShowTune((x) => !x)} className={`px-2.5 py-1 text-sm rounded-sm border ${showTune ? "bg-stone-800 text-stone-50 border-stone-800" : "border-stone-400"}`}>Tuning</button>
        <button onClick={() => { if (!confirm(room ? `Start a new game at table "${room}"? This resets the board for everyone.` : "Start a new game?")) return;
                                  commit(() => { const f = makeV2(S); f.settings = { ...S }; f.players = f.players.map((p, i) => state.players[i] ? { ...p, name: state.players[i].name } : p); return f; }, "started a new game"); }}
                className="px-2.5 py-1 text-sm rounded-sm border border-stone-400">New setup</button>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {room ? (
            <>
              <span className="text-stone-600">Table <b className="text-stone-900">{room}</b></span>
              <button onClick={() => { const u = shareLink(room); navigator.clipboard?.writeText(u).then(() => setStatus("link copied — send it to the other players"), () => window.prompt("Copy this link:", u)); }}
                      className="px-3 py-1 bg-stone-800 text-stone-50 rounded-sm">Copy invite link</button>
              <button onClick={() => { if (confirm("Leave this table? You can rejoin with the same code.")) join(""); }}
                      className="px-2.5 py-1 border border-stone-500 rounded-sm">Leave</button>
            </>
          ) : (
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const c = cleanCode(roomInput); if (c) { join(c); setStatus(""); } }}>
              <input value={roomInput} onChange={(e) => setRoomInput(e.target.value)} placeholder="table code, e.g. friday"
                     className="w-44 bg-white/60 border border-stone-400 px-2 py-1 rounded-sm" />
              <button type="submit" className="px-3 py-1 bg-stone-800 text-stone-50 rounded-sm">Start or join table</button>
            </form>
          )}
        </div>
      </div>

      <div className="px-4 py-2 border-b border-stone-400 flex flex-wrap items-center gap-x-4 gap-y-2 bg-white/40">
        <span className="text-xs uppercase tracking-widest text-stone-600">Round {state.turn.round} / {S.roundLimit}</span>
        {over && <span className="px-2 py-0.5 text-xs font-bold bg-stone-800 text-stone-50 rounded-sm">GAME OVER</span>}
        <span className="font-semibold text-sm">{cur?.name}</span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-stone-600 mr-1">AP</span>
          {Array.from({ length: S.apPerTurn }).map((_, i) => (
            <button key={i} onClick={() => commit((s) => { s.turn.ap = i < state.turn.ap ? i : i + 1; })}
              className="w-4 h-4 rounded-full border-2 border-stone-700"
              style={{ background: i < state.turn.ap ? "#26261f" : "transparent" }} />
          ))}
        </span>
        <button onClick={drawDiscs} className="px-2.5 py-1 text-sm rounded-sm border border-stone-500 hover:bg-white/60">Draw {S.drawCount}</button>
        <button onClick={callDividends} disabled={S.strict && state.turn.usedSlot}
                className="px-2.5 py-1 text-sm rounded-sm border border-stone-500 hover:bg-white/60 disabled:opacity-40">Call dividends</button>
        <button onClick={endTurn} className="px-3 py-1 text-sm bg-stone-800 text-stone-50 rounded-sm">End turn</button>
        <button onClick={undo} disabled={!T.canUndo} title="Takes back your own last move"
                className="px-2.5 py-1 text-sm rounded-sm border border-stone-500 hover:bg-white/60 disabled:opacity-40">↶ Undo my move</button>
        <button onClick={() => setShowTally((x) => !x)} className={`px-2.5 py-1 text-sm rounded-sm border ${showTally || over ? "bg-stone-800 text-stone-50 border-stone-800" : "border-stone-500 hover:bg-white/60"}`}>Tally</button>
        <label className="flex items-center gap-1 text-[11px] text-stone-600">
          <input type="checkbox" checked={!!S.strict} onChange={(e) => commit((s2) => { s2.settings.strict = e.target.checked; })} />
          enforce rules
        </label>
        <span className="ml-auto text-xs text-stone-600 tabular-nums">
          bag {state.bag.length} · on board {state.onboard.length} · destroyed {state.burned.length} · of {LINES.reduce((a, l) => a + l.discs, 0)}
        </span>
      </div>

      {showTune && (
        <div className="px-4 py-3 border-b border-stone-400 bg-white/60">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-0.5 max-w-6xl">
            {N("Action points / turn", "apPerTurn")}
            {N("Rounds in the game", "roundLimit")}
            {N("Hand limit", "handLimit")}
            {N("Discs per Draw", "drawCount")}
            {N("Station base (discs)", "stationBase")}
            {N("Station minimum", "stationMin")}
            {N("Fraction destroyed", "burnFrac", 0.25)}
            {Sel("Rounding", "burnRound", [["up", "round up"], ["down", "round down"]])}
            {Sel("Ownership disc", "ownership", [["link", "one per link"], ["hex", "one per hex"]])}
            {N("Branch ends at a station", "branchAt")}
            {Sel("Crossing", "crossMode", [["free", "free anywhere"], ["cost", "costs discs"], ["station", "only at a station"]])}
            {Sel("Crossing paid in", "crossPay", [["own", "your own colour"], ["other", "the crossed line's colour"]])}
            {N("Discs per crossing", "crossDiscs")}
            {N("Extra discs for water", "waterExtra")}
            {N("Shares per line", "sharesPerLine")}
            {N("Starting share price", "startPrice", 5)}
            {N("Price step per share sold", "stepPerShare", 5)}
            {N("Price growth per dividend", "priceGrowth", 1, "×")}
            {N("Invests per turn", "investPerTurn")}
            {N("Wild share costs", "wildCost", 1, "disc")}
            {N("Starting cash", "startCash", 10)}
            {N("$ per station", "perStation")}
            {N("$ per zone", "perZone")}
            {N("Discs to resist a merge", "mergeResist")}
            <label className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-xs text-stone-600">Enforce the rules</span>
              <input type="checkbox" checked={!!S.strict} onChange={(e) => commit((s2) => { s2.settings.strict = e.target.checked; })} />
            </label>
            <label className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-xs text-stone-600">Spend action points automatically</span>
              <input type="checkbox" checked={!!S.autoAP} onChange={(e) => commit((s2) => { s2.settings.autoAP = e.target.checked; })} />
            </label>
          </div>
          <p className="text-[11px] text-stone-500 mt-2 max-w-4xl">
            Simulation found: separation peaks around round 14, so 15 is the sweet spot. Station base 3 with round-up
            destruction drains the bag but clusters stations; base 5 spreads them but barely burns discs. Crossing at a
            cost keeps lines unstuck where "only at a station" walls in 3–4 of the 7.
          </p>
        </div>
      )}

      {showTally || over ? (() => {
        const rows = state.players.map((p) => {
          const shares = Object.entries(p.shares || {}).reduce((a, [lid, n]) => a + n * (reach[lid]?.price || 0), 0);
          return { p, cash: p.cash || 0, shares, total: (p.cash || 0) + shares };
        }).sort((x, y) => y.total - x.total);
        return (
          <div className="px-4 py-3 border-b border-stone-400 bg-white/70">
            <div className="flex items-baseline gap-3 mb-1.5">
              <h2 style={{ fontFamily: "'Roboto Slab', serif" }} className="text-sm font-bold">{over ? "Final tally" : "Tally if the game ended now"}</h2>
              <span className="text-[11px] text-stone-500">cash + every share at today&rsquo;s price. Merger bonuses are not included.</span>
              {!over && <button onClick={() => setShowTally(false)} className="ml-auto text-xs underline">close</button>}
            </div>
            <table className="text-sm tabular-nums">
              <thead><tr className="text-[11px] uppercase tracking-wide text-stone-500"><th className="text-left pr-6 font-medium"></th><th className="text-left pr-6 font-medium">Investor</th><th className="text-right pr-6 font-medium">Cash</th><th className="text-right pr-6 font-medium">Shares</th><th className="text-right font-medium">Total</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.p.id} className={i === 0 ? "font-bold" : ""}>
                    <td className="pr-6 text-stone-500">{i + 1}</td>
                    <td className="pr-6">{r.p.name}</td>
                    <td className="pr-6 text-right">${r.cash}</td>
                    <td className="pr-6 text-right">${r.shares}</td>
                    <td className="text-right">${r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })() : null}

      {/* sync status — the first thing to check when playing with someone else */}
      {(() => {
        const bad = !!diag.err;
        const live = diag.link === "live";
        return (
          <div className="px-4 py-1.5 border-b border-stone-300 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
               style={{ background: !room ? "#EDEDE2" : bad ? "#FBE3E0" : backend === "local" ? "#FBF1D9" : "#E4F0E4" }}>
            <span className="font-semibold uppercase tracking-wide text-stone-600">Sync</span>
            {!room ? <span className="text-stone-600">Playing on this screen only. Start or join a table to play with others — everyone uses the same code, or the invite link.</span> : (
              <>
                {backend === "local"
                  ? <span className="text-amber-900 font-semibold">Multiplayer isn&rsquo;t set up on this site yet — this table is shared only between tabs in this browser.</span>
                  : <span className={live ? "text-emerald-800 font-semibold" : "text-stone-700"}>{live ? "● live" : diag.link || "connecting"}</span>}
                <span className="tabular-nums text-stone-600">v{state.v}</span>
                {diag.pending > 0 && <span className="text-stone-700">saving…</span>}
                {diag.conflicts > 0 && <span className="text-stone-500" title="Times two players moved at once; both moves were kept">{diag.conflicts} simultaneous move{diag.conflicts > 1 ? "s" : ""} merged</span>}
                {diag.note && <span className="text-amber-900">{diag.note}</span>}
                {bad && <span className="text-red-800 font-semibold">{diag.err}</span>}
                {diag.at && <span className="ml-auto text-stone-500">last synced {diag.at}</span>}
              </>
            )}
          </div>
        );
      })()}

      {room && T.loaded && seat === undefined ? (
        <div className="px-4 py-3 border-b-2 border-stone-800 bg-amber-50 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Which player are you?</span>
          {state.players.map((p) => (
            <button key={p.id} onClick={() => setSeat(p.id)} className="px-3 py-1 rounded-sm border-2 border-stone-800 bg-white hover:bg-stone-800 hover:text-stone-50">{p.name}</button>
          ))}
          <button onClick={() => setSeat(null)} className="px-3 py-1 rounded-sm border border-stone-400">Everyone at this screen</button>
          <span className="text-[11px] text-stone-500 basis-full">Rename players in the Investors panel first if you like. Your choice is remembered for this table.</span>
        </div>
      ) : (
        <div className="px-4 py-1.5 border-b border-stone-300 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] bg-white/50">
          <span className="font-semibold uppercase tracking-wide text-stone-600">You are</span>
          <span className="flex flex-wrap gap-1">
            {state.players.map((p) => (
              <button key={p.id} onClick={() => setSeat(p.id)}
                className={`px-2 py-0.5 rounded-sm border ${seat === p.id ? "bg-stone-800 text-stone-50 border-stone-800" : "border-stone-400 hover:bg-white"}`}>
                {p.name}
              </button>
            ))}
            <button onClick={() => setSeat(null)} className={`px-2 py-0.5 rounded-sm border ${seat === null || seat === undefined ? "bg-stone-800 text-stone-50 border-stone-800" : "border-stone-400"}`}>everyone here</button>
          </span>
          {seat !== null && seat !== undefined && (seat === me
            ? <span className="px-2 py-0.5 rounded-sm bg-emerald-100 text-emerald-900 font-semibold">Your turn</span>
            : <span className="px-2 py-0.5 rounded-sm bg-amber-100 text-amber-900 font-semibold">It is {cur?.name}&rsquo;s turn — your clicks will move their pieces</span>)}
          {status && <span className="ml-auto text-stone-700">{status}</span>}
        </div>
      )}

      {room && (state.log || []).length > 0 && (
        <div className="px-4 py-1.5 border-b border-stone-300 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs bg-white/30">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-600">Latest</span>
          {(state.log || []).slice(0, 3).map((l, i) => (
            <span key={i} className={i < changed.log ? "text-stone-900" : "text-stone-500"}>
              {i < changed.log && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 mr-1 align-middle" />}
              <b className="font-semibold">{l.who}</b> {l.note} <span className="text-stone-400">{ago(l.t)}</span>
            </span>
          ))}
          {changed.hexes.size > 0 && (
            <span className="ml-auto flex items-center gap-2">
              <span className="text-amber-900">Changes since your last move are outlined on the board</span>
              <button onClick={T.clearSince} className="underline text-stone-600">clear</button>
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col lg:flex-row">
        <div className="flex-1 min-w-0 p-3">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {(tab === "play" ? [["track", "Lay track"], ["station", "Build station"]] : [["terrain", "Paint terrain"]]).map(([m, l]) => (
              <button key={m} onClick={() => { setMode(m); setPending(null); }}
                className={`px-3 py-1.5 text-sm rounded-sm border ${mode === m ? "bg-stone-800 text-stone-50 border-stone-800" : "border-stone-400 hover:bg-white/60"}`}>{l}</button>
            ))}
            {tab === "map" && mode === "terrain" && Object.entries(TERRAIN).map(([k, t]) => (
              <button key={k} onClick={() => setPaint(k)} className={`px-2.5 py-1 text-xs rounded-sm border-2 ${paint === k ? "border-stone-900" : "border-stone-300"}`} style={{ background: t.fill }}>{t.label}</button>
            ))}
            <span className="mx-1 h-5 w-px bg-stone-400" />
            {LINES.map((l) => (
              <button key={l.id} onClick={() => setActiveLine(l.id)}
                className={`px-2 py-1 text-xs font-semibold rounded-sm border-2 flex items-center gap-1 ${activeLine === l.id ? "border-stone-900" : "border-transparent"}`}
                style={{ background: l.color, color: "#fff", opacity: handCount(cur, l.id) ? 1 : 0.45 }}>
                {l.name}<span className="tabular-nums opacity-80">{handCount(cur, l.id)}</span>
              </button>
            ))}
          </div>

          <div className="relative">
          <div className="absolute right-2 top-2 z-10 flex rounded-sm overflow-hidden border border-stone-500 bg-white/90 text-xs shadow-sm">
            {[[1, "Fit"], [1.6, "Zoom"], [2.4, "Zoom ×2"]].map(([z, l]) => (
              <button key={z} onClick={() => setZoom(z)} className={`px-2 py-1 ${zoom === z ? "bg-stone-800 text-stone-50" : ""}`}>{l}</button>
            ))}
          </div>
          <div className="bg-white/40 border border-stone-400 rounded-sm overflow-auto max-h-[78vh] lg:max-h-[70vh]">
            <svg viewBox={`${view.x0} ${view.y0} ${view.w} ${view.h}`} style={{ width: `${zoom * 100}%`, display: "block" }}>
              {cells.map(({ c, r, id }) => {
                const k = map.hexes[id]; if (!k && tab !== "map") return null;
                const x = cx(c, r), y = cy(c, r), z = ZONE_OF[id];
                const fill = !k ? "#00000008" : (showZones && z !== undefined && k !== "w") ? ZONE_COLORS[z] : TERRAIN[k].fill;
                return (
                  <g key={id} onClick={() => onHex(id, !!k)} className="cursor-pointer">
                    <polygon points={hexPath(x, y)} fill={fill} stroke={k ? "#4a4a44" : "#00000022"} strokeWidth={k ? 0.8 : 0.6} strokeDasharray={k ? "" : "3 3"} />
                    {crossHexes.has(id) && <polygon points={hexPath(x, y)} fill="#B4530933" stroke="#B45309" strokeWidth="1.5" />}
                    {tab === "play" && netHexes.has(id) && <polygon points={hexPath(x, y)} fill="none" stroke={colorOf(activeLine)} strokeWidth="2" opacity="0.5" />}
                    {sel === id && <polygon points={hexPath(x, y)} fill="none" stroke="#B45309" strokeWidth="3" />}
                    {pending === id && <polygon points={hexPath(x, y)} fill="none" stroke="#111" strokeWidth="3" />}
                    {changed.hexes.has(id) && <polygon points={hexPath(x, y)} fill="#F59E0B22" stroke="#D97706" strokeWidth="3.5" strokeDasharray="7 4" pointerEvents="none" />}
                    {map.names[id] && <text x={x} y={y + 19} textAnchor="middle" style={{ fontSize: 7, pointerEvents: "none" }} fill="#2b2b26">
                      {map.names[id].length > 17 ? map.names[id].split(" ").slice(0, 2).join(" ") : map.names[id]}</text>}
                  </g>
                );
              })}
              {showZones && zoneBorders.map((e, i) => (
                <g key={"zb" + i} pointerEvents="none">
                  <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#ffffffaa" strokeWidth="7" strokeLinecap="round" />
                  <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#5a5a4e" strokeWidth="4" strokeLinecap="round" />
                </g>
              ))}
              {/* legal next builds for the active line */}
              {tab === "play" && mode === "track" && Object.entries(legal).map(([k, info]) => {
                const [a, b] = k.split("|"); const [ac, ar] = parseId(a), [bc, br] = parseId(b);
                const ok = canPay(info);
                return <line key={"lg" + k} x1={cx(ac, ar)} y1={cy(ac, ar)} x2={cx(bc, br)} y2={cy(bc, br)}
                             stroke={colorOf(activeLine)} strokeWidth="3" strokeDasharray="4 4"
                             opacity={ok ? 0.55 : 0.18} pointerEvents="none" />;
              })}
              {changed.edges.map(({ k, gone }) => {
                const [a, b] = k.split("|"); const [ac, ar] = parseId(a), [bc, br] = parseId(b);
                return <line key={"ch" + k} x1={cx(ac, ar)} y1={cy(ac, ar)} x2={cx(bc, br)} y2={cy(bc, br)} pointerEvents="none"
                             stroke={gone ? "#7c7c70" : "#F59E0B"} strokeWidth={gone ? 4 : 16} strokeDasharray={gone ? "3 5" : ""} strokeLinecap="round" opacity={gone ? 0.9 : 0.55} />;
              })}
              {Object.keys(state.track).map((k) => {
                const lid = trackOwner(state, k);
                const [a, b] = k.split("|"); const [ac, ar] = parseId(a), [bc, br] = parseId(b);
                return (
                  <g key={k} pointerEvents="none">
                    <line x1={cx(ac, ar)} y1={cy(ac, ar)} x2={cx(bc, br)} y2={cy(bc, br)} stroke="#fff" strokeWidth="8" strokeLinecap="round" />
                    <line x1={cx(ac, ar)} y1={cy(ac, ar)} x2={cx(bc, br)} y2={cy(bc, br)} stroke={colorOf(lid)} strokeWidth="5" strokeLinecap="round" />
                  </g>
                );
              })}
              {(map.nocross || []).map((k) => { const [a, b] = k.split("|"); const e = sharedEdge(a, b);
                return <line key={"n" + k} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#1F5432" strokeWidth="6" strokeLinecap="round" pointerEvents="none" />; })}
              {(map.rivers || []).map((k) => { const [a, b] = k.split("|"); const e = sharedEdge(a, b);
                return <line key={"r" + k} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#2674BA" strokeWidth="6" strokeLinecap="round" pointerEvents="none" />; })}
              {cells.map(({ c, r, id }) => {
                if (!map.hexes[id]) return null;
                const x = cx(c, r), y = cy(c, r), stn = state.stations[id];
                return (
                  <g key={"m" + id} onClick={() => onHex(id, true)} className="cursor-pointer">
                    {map.names[id] && !stn && <circle cx={x} cy={y} r="6" fill="#111" />}
                    {stn && <><circle cx={x} cy={y} r="11" fill="#fff" stroke={colorOf(stn.o)} strokeWidth="4" /><circle cx={x} cy={y} r="4" fill={colorOf(stn.o)} /></>}
                  </g>
                );
              })}
            </svg>
          </div>
          </div>

          <div className="mt-2 border border-stone-400 rounded-sm bg-white/60 p-2.5">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-xs uppercase tracking-widest text-stone-600">
                {(seat !== null ? state.players.find((p) => p.id === seat) : cur)?.name}&rsquo;s influence
                <button onClick={() => setReveal((r) => !r)} className="ml-2 normal-case tracking-normal underline text-[11px]">{reveal ? "hide" : "show"}</button>
              </span>
              <span className="text-[11px] text-stone-500 tabular-nums">{(((seat !== null ? state.players.find((p) => p.id === seat) : cur)?.hand) || []).length} / {S.handLimit}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mb-2 pb-2 border-b border-stone-300">
              <span className="text-[10px] uppercase tracking-wide text-stone-500 mr-1">add / remove</span>
              {LINES.map((l) => (
                <span key={l.id} className="flex items-center rounded-sm" style={{ border: `1px solid ${l.color}` }}>
                  <button onClick={() => commit((s2) => { const who = seat !== null ? seat : s2.turn.active;
                            const q = s2.players.find((x) => x.id === who); const ix = q.hand.indexOf(l.id); if (ix >= 0) q.hand.splice(ix, 1); }, `removed a ${l.name} disc`)}
                          className="px-1 text-[11px] leading-none">−</button>
                  <span className="w-3 h-3 rounded-full" style={{ background: l.color }} />
                  <button onClick={() => commit((s2) => { const who = seat !== null ? seat : s2.turn.active;
                            const q = s2.players.find((x) => x.id === who); q.hand.push(l.id);
                            const ix = s2.bag.indexOf(l.id); if (ix >= 0) s2.bag.splice(ix, 1); }, `added a ${l.name} disc`)}
                          className="px-1 text-[11px] leading-none">+</button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {!(((seat !== null ? state.players.find((p) => p.id === seat) : cur)?.hand) || []).length && <span className="text-xs text-stone-500">Empty — press Draw, or use + above.</span>}
              {[...(((seat !== null ? state.players.find((p) => p.id === seat) : cur)?.hand) || [])].sort((a, b) => a - b).map((d, i) => (
                <span key={i} title={lineOf(d)?.name} className="w-7 h-7 rounded-full border-2 border-white shadow-sm"
                      style={{ background: reveal ? colorOf(d) : "#b8b8ac" }} />
              ))}
            </div>
            {sel && (
              <div className="mt-2 text-xs text-stone-700">
                <b>{map.names[sel] || sel}</b> — nearest station {selCost?.d === null ? "none yet" : selCost?.d + " hex"};
                a {lineOf(activeLine)?.name} station here costs <b className="tabular-nums">{selCost?.c} discs</b>
                {" "}({burnCount(state, selCost?.c || 0)} destroyed, {(selCost?.c || 0) - burnCount(state, selCost?.c || 0)} back to the bag)
              </div>
            )}
          </div>
        </div>

        <div className="w-full lg:w-[390px] shrink-0 border-t-2 lg:border-t-0 lg:border-l-2 border-stone-800 p-4 space-y-5 text-sm">
          <section>
            <h2 style={{ fontFamily: "'Roboto Slab', serif" }} className="text-xs uppercase tracking-widest mb-2 text-stone-600">The seven lines</h2>
            <div className="space-y-1">
              {LINES.map((l) => {
                const rc = reach[l.id];
                const isAcq = acquirer?.id === l.id;
                return (
                  <div key={l.id} className={`flex items-center gap-1.5 text-xs border rounded-sm px-1.5 py-1 ${isAcq ? "border-stone-800 bg-white/70" : "border-stone-300 bg-white/50"}`}>
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: l.color }} />
                    <span className="w-16 truncate font-medium">{l.name}</span>
                    <span className="tabular-nums text-stone-600" title="stations">{rc.stations}s</span>
                    <span className="tabular-nums text-stone-600" title="zones">{rc.zones.length}z</span>
                    <span className="tabular-nums text-stone-600" title="links">{rc.links}L</span>
                    <span className="tabular-nums font-semibold" title="dividend per share">${rc.per}</span>
                    <span className="tabular-nums text-stone-500" title="shares left">{rc.left}</span>
                    <span className="ml-auto flex gap-1">
                      <button disabled={S.strict && (handCount(cur, l.id) < 1 || (cur?.cash ?? 0) < rc.price || rc.left <= 0 || state.turn.invests >= S.investPerTurn)}
                              onClick={() => invest(l.id, false)} title={`1 ${l.name} disc + $${rc.price}`}
                              className="px-1.5 py-0.5 border border-stone-400 rounded-sm disabled:opacity-30">${rc.price}</button>
                      <button disabled={S.strict && ((cur?.hand || []).length < S.wildCost || (cur?.cash ?? 0) < rc.price || rc.left <= 0 || state.turn.invests >= S.investPerTurn)}
                              onClick={() => invest(l.id, true)} title={`${S.wildCost} discs of any colour + $${rc.price}`}
                              className="px-1.5 py-0.5 border border-stone-400 rounded-sm disabled:opacity-30">wild</button>
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-stone-500 mt-1.5">
              s = stations · z = zones · L = links · then dividend per share, shares left, and price.
              Bordered row is the current <b>acquirer</b> — most stations. Invests {state.turn.invests}/{S.investPerTurn} this turn.
            </p>
          </section>

          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h2 style={{ fontFamily: "'Roboto Slab', serif" }} className="text-xs uppercase tracking-widest text-stone-600">Investors</h2>
              <button onClick={() => commit((s) => { const ids = s.players.map((p) => p.id); let i = 0; while (ids.includes(i)) i++;
                        const q = v2Player(i, s.settings); for (let n = 0; n < s.settings.startingHand && s.bag.length; n++) q.hand.push(s.bag.pop()); s.players.push(q); }, "added an investor")}
                      className="text-xs underline">add</button>
            </div>
            <div className="space-y-2">
              {state.players.map((p, idx) => (
                <div key={p.id} className={`border rounded-sm p-2 ${p.id === me ? "border-stone-800 bg-white/70" : "border-stone-400 bg-white/40"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <input value={p.name} onBlur={syncNow} onChange={(e) => edit((s) => { s.players[idx].name = e.target.value; })}
                           className="flex-1 min-w-0 font-semibold bg-transparent border-b border-stone-300 focus:outline-none text-sm" />
                    <span className="flex items-center gap-0.5">
                      <span className="text-stone-500">$</span>
                      <input type="number" step={10} value={p.cash} onBlur={syncNow}
                             onChange={(e) => edit((s2) => { s2.players[idx].cash = Number(e.target.value) || 0; })}
                             className="w-16 bg-transparent border-b border-stone-300 text-right tabular-nums font-semibold focus:outline-none text-sm" />
                    </span>
                    <button onClick={() => commit((s) => { s.turn.active = p.id; }, `made ${p.name} active`)}
                            className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${p.id === me ? "bg-stone-800 text-stone-50 border-stone-800" : "border-stone-400"}`}>
                      {p.id === me ? "active" : "make active"}</button>
                  </div>
                  <div className="flex flex-wrap gap-1 items-center">
                    {LINES.map((l) => {
                      const n = (p.shares || {})[l.id] || 0;
                      return (
                        <span key={l.id} className={`flex items-center gap-0.5 rounded-sm px-1 ${n ? "" : "opacity-35"}`} style={{ border: `1px solid ${l.color}` }}>
                          <span className="w-2 h-2 rounded-full" style={{ background: l.color }} />
                          <button onClick={() => commit((s) => { const q = s.players.find((x) => x.id === p.id); q.shares[l.id] = Math.max(0, (q.shares[l.id] || 0) - 1); s.sold[l.id] = Math.max(0, (s.sold[l.id] || 0) - 1); }, `took a ${l.name} share from ${p.name}`)} className="px-0.5 text-[11px] leading-none">−</button>
                          <span className="text-[11px] font-semibold tabular-nums w-3 text-center">{n}</span>
                          <button onClick={() => commit((s) => { const q = s.players.find((x) => x.id === p.id); q.shares[l.id] = (q.shares[l.id] || 0) + 1; s.sold[l.id] = (s.sold[l.id] || 0) + 1; }, `gave ${p.name} a ${l.name} share`)} className="px-0.5 text-[11px] leading-none">+</button>
                        </span>
                      );
                    })}
                  </div>
                  <div className="mt-1 text-[11px] text-stone-600 tabular-nums">
                    {(p.hand || []).length} discs · dividends ${Object.entries(p.shares || {}).reduce((a, [lid, n]) => a + n * (reach[lid]?.per || 0), 0)}
                    {" · portfolio $"}{Object.entries(p.shares || {}).reduce((a, [lid, n]) => a + n * (reach[lid]?.price || 0), 0)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 style={{ fontFamily: "'Roboto Slab', serif" }} className="text-xs uppercase tracking-widest mb-2 text-stone-600">Merge</h2>
            <p className="text-[11px] text-stone-500 mb-1.5">
              The line with the most stations is the acquirer — currently <b style={{ color: colorOf(acquirer?.id) }}>{lineOf(acquirer?.id)?.name}</b> with {acquirer?.n}.
              Merging moves all track, stations and shares across. Payouts are not automated.
            </p>
            <div className="flex items-center gap-1.5 text-xs">
              <select value={mergeFrom} onChange={(e) => setMergeFrom(Number(e.target.value))} className="bg-white border border-stone-300 rounded-sm py-0.5 flex-1 min-w-0">
                {LINES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <span className="text-stone-500">into</span>
              <select value={mergeTo} onChange={(e) => setMergeTo(Number(e.target.value))} className="bg-white border border-stone-300 rounded-sm py-0.5 flex-1 min-w-0">
                {LINES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <button onClick={() => { if (confirm("Merge? This cannot be undone.")) doMerge(); }}
                      className="px-2 py-0.5 bg-stone-800 text-stone-50 rounded-sm">go</button>
            </div>
          </section>

          <section>
            <h2 style={{ fontFamily: "'Roboto Slab', serif" }} className="text-xs uppercase tracking-widest mb-2 text-stone-600">Zones reached <span className="normal-case tracking-normal text-stone-400">({ZONES.length})</span></h2>
            <div className="space-y-0.5 text-xs max-h-52 overflow-y-auto pr-1">
              {ZONES.map((z, zi) => {
                const ls = LINES.filter((l) => (reach[l.id]?.zones || []).includes(zi));
                return (
                  <div key={z} className={`flex items-center gap-2 ${ls.length ? "" : "opacity-55"}`}>
                    <span className="w-3 h-3 rounded-sm border border-stone-400 shrink-0" style={{ background: ZONE_COLORS[zi] }} />
                    <span className="flex-1 truncate">{z}</span>
                    {!ls.length && <span className="text-[10px] text-stone-400 italic">unreached</span>}
                    <span className="flex gap-0.5">{ls.map((l) => <span key={l.id} className="w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 style={{ fontFamily: "'Roboto Slab', serif" }} className="text-xs uppercase tracking-widest mb-2 text-stone-600">Log</h2>
            <div className="max-h-48 overflow-auto text-xs text-stone-600 space-y-0.5">
              {!(state.log || []).length && <p className="text-stone-500">Nothing yet.</p>}
              {(state.log || []).map((l, i) => (
                <div key={i} className={i < changed.log ? "text-stone-900" : ""}>
                  {i < changed.log && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-600 mr-1 align-middle" />}
                  <span className="font-medium">{l.who}</span> {l.note} <span className="text-stone-400">{ago(l.t)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

