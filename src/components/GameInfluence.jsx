import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  SEED_HEX, SEED_NAMES, SEED_RIVERS, SEED_NOCROSS, ZONES, ZONE_COLORS, ZONE_OF,
  LINES, V2D, GRID, TERRAIN, R, cx, cy, parseId, edgeKey, neighbors, sharedEdge, hexDist,
  seedMap, Field, CONTRACTS, ERA_LABEL, eraDeck, byId, contractLabel,
  MARKET, START_AT, DEFAULTS, blankSlot, blankCharter, newPlayer, makeInitial, carStats, Charter,
  makeV2, v2Player, lineOf, trackOwner, lineEdges, lineNet, lineDegree, occupants,
  stationsOf, zonesOf, perShare, priceOf, sharesLeft, countLinks, syncMarkers,
  nearestStation, stationCost, burnCount,
  pendingMerges, mergePayouts, applyMerge, isDefunct, liveLines,
  nextTurn, legalExtensions, collisionWatch, holders, goalById, goalLine, checkGoals, finalScore, dealGoals,
  startingCash, untouched,
} from "../lib/game.jsx";
import { useTable, shareLink, cleanCode } from "../lib/sync.js";
import { backend } from "../lib/storage.js";

const ago = (t) => {
  if (!t) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

/* MTA-style round line badges */
const BULLET = { 0: "B", 1: "8", 2: "6", 3: "Lx", 4: "F", 5: "N", 6: "C" };
const Bullet = ({ lid, size = 24, dim }) => {
  const l = LINES.find((x) => x.id === lid);
  return (
    <span className="inline-flex items-center justify-center rounded-full font-bold text-white shrink-0 select-none"
          style={{ width: size, height: size, background: l?.color || "#333", fontSize: size * (String(BULLET[lid]).length > 1 ? 0.42 : 0.56),
                   opacity: dim ? 0.35 : 1, letterSpacing: "-0.03em" }}>
      {BULLET[lid]}
    </span>
  );
};

export default function GameInfluence({ hidden, slot }) {
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
  const [tallySeen, setTallySeen] = useState(false);
  const [menu, setMenu] = useState(null);
  const [side, setSide] = useState("lines");
  const [adjust, setAdjust] = useState(false);
  useEffect(() => { if (!status) return; const t = setTimeout(() => setStatus(""), 4000); return () => clearTimeout(t); }, [status]);
  const [zoom, setZoom] = useState(() => (typeof window !== "undefined" && window.innerWidth < 640 ? 1.6 : 1));   // bigger hexes to tap on a phone
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  const [mergeFrom, setMergeFrom] = useState(0);
  const [mergeTo, setMergeTo] = useState(1);

  const seatRef = useRef(undefined);
  const T = useTable("i", () => makeV2(), {
    finish: (n) => {
      if (n.settings.strict) syncMarkers(n);
      const notes = checkGoals(n, n.turn.active);
      if (notes.length) n._notes = [...(n._notes || []), ...notes];
    },
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
  const hexName = (h) => state.map?.names?.[h] || "";
  const trackAt = (a, b) => { const n = [hexName(a), hexName(b)].filter(Boolean); return n.length ? ` near ${n.join(" / ")}` : ""; };

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
    liveLines(state).forEach((l) => { const n = stationsOf(state, l.id); if (!best || n > best.n) best = { id: l.id, n }; });
    return best;
  }, [state]);
  const live = liveLines(state);
  const dueMerges = useMemo(() => pendingMerges(state), [state]);
  useEffect(() => { if (isDefunct(state, activeLine) && live.length) setActiveLine(live[0].id); }, [state, activeLine]); // eslint-disable-line

  /* which extensions are legal for the active line, and what they cost */
  const legal = useMemo(() => legalExtensions(state, activeLine), [state, activeLine]);

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
        }, `${removing ? "removed" : "laid"} ${lineOf(activeLine).name} track${trackAt(pending, id)}`);
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
      }, `laid ${lineOf(activeLine).name} track${trackAt(pending, id)}`);
      setPending(id); setStatus(""); return;
    }
    if (mode === "station") {
      if (!S.strict) {                       // SANDBOX
        const removing = state.stations[id]?.o === activeLine;
        commit((s2) => {
          if (s2.stations[id] && s2.stations[id].o === activeLine) delete s2.stations[id];
          else s2.stations[id] = { o: activeLine };
        }, `${removing ? "removed" : "built"} a ${lineOf(activeLine).name} station${hexName(id) ? " at " + hexName(id) : ""}`);
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
      }, `${lineOf(activeLine).name} station${hexName(id) ? " at " + hexName(id) : ""}`);
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
    // a compact picture of the board at every turn's end, for the game record
    s.snapshots = [...(s.snapshots || []), {
      round: s.turn.round, active: s.turn.active,
      players: s.players.map((p) => ({ id: p.id, cash: p.cash, shares: { ...(p.shares || {}) }, hand: (p.hand || []).length })),
      lines: LINES.map((l) => ({ id: l.id, stations: stationsOf(s, l.id), track: lineEdges(s, l.id).length, per: perShare(s, l.id), price: s.prices?.[l.id], sold: s.sold?.[l.id] })),
      defunct: [...(s.defunct || [])], score: finalScore(s).map((r) => r.total),
    }];
    nextTurn(s);
  }, "ended turn");

  /* line a absorbs line d: bonuses to d's two biggest holders, d's shares sold at base price, d's track,
     stations and discs become a's. The payout is worked out on the board as it stands when the move is saved. */
  const runMerge = (a, d) => {
    if (a === d || isDefunct(state, a) || isDefunct(state, d)) return;
    const pays = mergePayouts(state, d).filter((x) => x.bonus || x.sale);
    const who = pays.map((x) => `${x.name} +$${x.bonus + x.sale}`).join(", ");
    commit((s) => { if (!isDefunct(s, a) && !isDefunct(s, d)) applyMerge(s, a, d); },
           `merged ${lineOf(d)?.name} into ${lineOf(a)?.name}${who ? ` (${who})` : ""}`);
  };
  const doMerge = () => runMerge(mergeTo, mergeFrom);

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

  const viewer = (seat !== null && seat !== undefined ? state.players.find((p) => p.id === seat) : null) || cur;
  const myTurn = seat !== null && seat !== undefined && seat === me;
  const close = () => setMenu(null);

  const syncDot = !room ? null : diag.err ? ["#D93025", diag.err]
    : backend === "local" ? ["#F2A900", "Multiplayer isn't set up on this site yet: this table is shared only between tabs in this browser."]
    : diag.link === "live" ? ["#00933C", `Live · v${state.v}${diag.at ? " · synced " + diag.at : ""}`]
    : ["#9A9A94", diag.link || "connecting"];

  const topControls = (
    <div className="flex items-center gap-2 text-[13px] min-w-0">
      {room ? (
        <>
          <span className="hidden sm:flex items-center gap-1.5 text-white/70 min-w-0" title={syncDot[1]}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: syncDot[0] }} />
            <span className="truncate">Table <b className="text-white">{room}</b></span>
            {diag.pending > 0 && <span className="text-white/50">saving…</span>}
          </span>
          <span className="sm:hidden w-2.5 h-2.5 rounded-full shrink-0" style={{ background: syncDot[0] }} title={syncDot[1]} />
          <button onClick={() => setMenu(menu === "seat" ? null : "seat")} className="nm-btn-dark truncate max-w-[40vw]">
            {seat === undefined ? "Pick your seat" : seat === null ? "Everyone here" : `You: ${viewer?.name}`} ▾
          </button>
          <button onClick={() => { const u = shareLink(room); navigator.clipboard?.writeText(u).then(() => setStatus("Invite link copied. Send it to the other players."), () => window.prompt("Copy this link:", u)); }}
                  className="nm-btn-light">Invite</button>
        </>
      ) : (
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); const c = cleanCode(roomInput); if (c) join(c); }}>
          <input value={roomInput} onChange={(e) => setRoomInput(e.target.value)} placeholder="Table code"
                 className="w-28 sm:w-36 h-8 rounded-md bg-white/10 border border-white/20 px-2.5 text-white placeholder-white/40 focus:outline-none focus:border-white/60" />
          <button type="submit" className="nm-btn-light">Play online</button>
        </form>
      )}
      <button onClick={() => setMenu(menu === "table" ? null : "table")} className="nm-btn-dark px-2.5" aria-label="Table menu">⋯</button>
    </div>
  );

  const Menu = ({ children }) => (
    <>
      <div className="fixed inset-0 z-40" onClick={close} />
      <div className="fixed right-2 top-12 z-50 w-72 max-w-[calc(100vw-16px)] bg-white rounded-xl shadow-xl border border-[#E2E1DB] py-1.5 text-[14px]">{children}</div>
    </>
  );
  const Item = ({ onClick, children, sub }) => (
    <button onClick={() => { close(); onClick(); }} className="w-full text-left px-4 py-2 hover:bg-[#F2F1EC]">
      <div>{children}</div>{sub && <div className="text-[12px] text-[#6B6B66]">{sub}</div>}
    </button>
  );
  const Check = ({ checked, onChange, children }) => (
    <label className="flex items-center justify-between px-4 py-2 hover:bg-[#F2F1EC] cursor-pointer">
      <span>{children}</span><input type="checkbox" className="w-4 h-4 accent-black" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
  const Sheet = ({ title, onClose, children, wide }) => (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div className={`bg-white w-full ${wide ? "sm:max-w-4xl" : "sm:max-w-lg"} max-h-[90vh] overflow-auto rounded-t-2xl sm:rounded-2xl shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white flex items-center justify-between px-5 py-3.5 border-b border-[#E2E1DB]">
          <h2 className="text-[17px] font-bold">{title}</h2>
          {onClose && <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-[#F2F1EC] text-xl leading-none" aria-label="Close">×</button>}
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );

  const score = finalScore(state);
  const tallyRows = [...score].sort((x, y) => y.total - x.total);
  const watch = collisionWatch(state);
  const watchHexes = new Set(watch.flatMap((w) => w.hexes));
  const openGoals = state.settings.goals && state.goals ? state.goals.public.filter((id) => !state.goals.done[id]) : [];
  const goalHexes = new Set(openGoals.flatMap((id) => [goalById(id).a, goalById(id).b]));
  const mySecrets = seat !== null && seat !== undefined && state.secrets ? state.secrets[seat] || [] : null;

  const downloadRecord = () => {
    const rec = { app: "nyc-metro", game: "influence", format: 1, exported: new Date().toISOString(), table: room || null,
                  settings: state.settings, players: state.players.map((p) => ({ id: p.id, name: p.name })),
                  moves: state.record || [], snapshots: state.snapshots || [], mergers: state.mergers || [],
                  goals: state.goals || null, secrets: state.secrets || null, final: finalScore(state), round: state.turn.round };
    const blob = new Blob([JSON.stringify(rec, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `nyc-metro-${room || "solo"}-${new Date().toISOString().slice(0, 10)}-r${state.turn.round}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setStatus("Game record downloaded");
  };

  const btn = "h-10 px-4 rounded-lg border border-[#CFCEC7] bg-white font-semibold text-[14px] hover:bg-[#F2F1EC] disabled:opacity-40 disabled:hover:bg-white";
  const seg = (on) => `h-8 px-3 text-[13px] font-semibold ${on ? "bg-[#111] text-white" : "bg-white text-[#111] hover:bg-[#F2F1EC]"}`;
  const hand = viewer?.hand || [];
  const handBy = liveLines(state).map((l) => ({ l, n: hand.filter((d) => d === l.id).length }));

  return (
    <div className="flex-1 min-h-0 flex-col lg:flex-row text-[#111] bg-[#F2F1EC]" style={{ display: hidden ? "none" : "flex" }}>
      {slot && !hidden && createPortal(topControls, slot)}

      {menu === "seat" && (
        <Menu>
          <div className="px-4 pt-1.5 pb-1 text-[12px] font-semibold uppercase tracking-wide text-[#6B6B66]">Which player are you?</div>
          {state.players.map((p) => (
            <Item key={p.id} onClick={() => setSeat(p.id)}>{seat === p.id ? "✓ " : ""}{p.name}</Item>
          ))}
          <Item onClick={() => setSeat(null)} sub="Pass-and-play on one device">{seat === null ? "✓ " : ""}Everyone at this screen</Item>
        </Menu>
      )}
      {menu === "table" && (
        <Menu>
          <Item onClick={() => setShowTally(true)} sub="The final score if the game ended now">Tally</Item>
          <Item onClick={downloadRecord} sub="Every move and the board each turn, as a file">Download game record</Item>
          <Item onClick={() => setShowTune(true)}>Tuning</Item>
          <Item onClick={() => { const t = tab === "map" ? "play" : "map"; setTab(t); setPending(null); setMode(t === "play" ? "track" : "terrain"); }}>
            {tab === "map" ? "Back to play" : "Edit map"}</Item>
          <Check checked={showZones} onChange={setShowZones}>Show zones</Check>
          <Check checked={!!S.strict} onChange={(v) => commit((s2) => { s2.settings.strict = v; }, v ? "turned rules on" : "turned rules off")}>Enforce rules</Check>
          <Check checked={!!S.autoAP} onChange={(v) => commit((s2) => { s2.settings.autoAP = v; })}>Spend action points automatically</Check>
          <div className="my-1.5 border-t border-[#E2E1DB]" />
          <Item onClick={() => { if (!confirm(room ? `Start a new game at table "${room}"? This resets the board for everyone.` : "Start a new game?")) return;
                                 commit(() => { const f = makeV2(S, state.players.length); f.settings = { ...S }; f.players = f.players.map((p, i) => state.players[i] ? { ...p, name: state.players[i].name } : p); return f; }, "started a new game"); }}>
            New game</Item>
          {room && <Item onClick={() => { if (confirm("Leave this table? You can rejoin with the same code.")) join(""); }}>Leave table</Item>}
          {room && backend === "local" && <div className="px-4 py-2 text-[12px] text-[#8A5A00] bg-[#FFF6DB] mx-2 mt-1 rounded-md">{syncDot[1]}</div>}
        </Menu>
      )}

      {room && T.loaded && seat === undefined && (
        <Sheet title="Which player are you?">
          <p className="text-[14px] text-[#6B6B66] mb-4">Your moves are logged under this name. You can change it any time from the top bar.</p>
          <div className="grid grid-cols-2 gap-2">
            {state.players.map((p) => <button key={p.id} onClick={() => setSeat(p.id)} className={btn + " h-12 text-[15px]"}>{p.name}</button>)}
          </div>
          <button onClick={() => setSeat(null)} className="mt-3 w-full text-[14px] text-[#6B6B66] underline">Everyone at this screen (pass-and-play)</button>
        </Sheet>
      )}

      {(showTally || (over && !tallySeen)) && (
        <Sheet title={over ? "Final tally" : "Tally if the game ended now"} onClose={() => { setShowTally(false); setTallySeen(true); }}>
          <div className="overflow-x-auto">
          <table className="w-full text-[15px] tabular-nums">
            <thead><tr className="text-[12px] uppercase tracking-wide text-[#6B6B66] border-b border-[#E2E1DB]">
              <th className="text-left py-2 w-8"></th><th className="text-left py-2">Investor</th><th className="text-right py-2 px-2">Cash</th><th className="text-right py-2 px-2">Shares</th>
              {S.endBonuses && <th className="text-right py-2 px-2">Bonuses</th>}{S.goals && <th className="text-right py-2 px-2">Routes</th>}<th className="text-right py-2">Total</th></tr></thead>
            <tbody>
              {tallyRows.map((r, i) => (
                <tr key={r.id} className={`border-b border-[#EEEDE8] ${i === 0 ? "font-bold" : ""}`}>
                  <td className="py-2.5 text-[#6B6B66]">{i + 1}</td><td>{r.name}</td>
                  <td className="text-right px-2">${r.cash}</td><td className="text-right px-2">${r.shares}</td>
                  {S.endBonuses && <td className="text-right px-2">${r.bonuses}</td>}
                  {S.goals && <td className="text-right px-2">{over || r.id === seat ? `$${r.routes}` : "?"}</td>}
                  <td className="text-right">${over || !S.goals || r.id === seat ? r.total : r.total - r.routes}{!over && S.goals && r.id !== seat ? "+" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="text-[12px] text-[#6B6B66] mt-3">
            Shares count at their base price (the price without the per-sale step).
            {S.endBonuses ? ` Each line still running pays its biggest holder ${S.majBonus}× its base price and the second biggest ${S.minBonus}×.` : ""}
            {S.goals ? ` Secret routes are worth $${S.secretValue} each if one line links them; rivals' routes stay hidden until the game ends.` : ""}
          </p>
        </Sheet>
      )}

      {showTune && (
        <Sheet title="Tuning" onClose={() => setShowTune(false)} wide>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <button onClick={() => { if (confirm("Reset every setting to the recommended defaults? The board and scores are not touched.")) commit((s2) => { s2.settings = { ...V2D, strict: s2.settings.strict, autoAP: s2.settings.autoAP }; if (!s2.goals) dealGoals(s2); }, "reset tuning to the recommended defaults"); }}
                    className="h-9 px-3 rounded-lg border border-[#CFCEC7] font-semibold text-[13px] hover:bg-[#F2F1EC]">Reset to recommended defaults</button>
            <span className="text-[12px] text-[#6B6B66]">Games started before an update keep their old settings. This brings them up to date.</span>
          </div>
          <div className="tune grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8">
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
            {N("Shares per turn", "investPerTurn")}
            {Sel("Turn order", "turnOrder", [["snake", "snake: 1-2-3, 3-2-1"], ["rotate", "start player moves left"], ["fixed", "fixed: 1-2-3 every round"]])}
            <label className="flex items-center justify-between gap-2 py-0.5"><span className="text-xs text-stone-600">End-of-game holder bonuses</span>
              <input type="checkbox" checked={!!S.endBonuses} onChange={(e) => commit((s2) => { s2.settings.endBonuses = e.target.checked; })} /></label>
            <label className="flex items-center justify-between gap-2 py-0.5"><span className="text-xs text-stone-600">Landmark goals and secret routes</span>
              <input type="checkbox" checked={!!S.goals} onChange={(e) => commit((s2) => { s2.settings.goals = e.target.checked; })} /></label>
            {N("Goal bonus to the player who completes it ($)", "goalBonus", 5)}
            {N("Goal raises the line's base price by ($)", "goalPrice")}
            {N("Secret route value ($)", "secretValue", 5)}
            {N("Wild share costs", "wildCost", 1, "disc")}
            {N("Starting cash", "startCash", 10)}
            {N("With 4+ players, extra starting cash per later seat", "seatCash4", 5)}
            {N("$ per station", "perStation")}
            {N("$ per zone", "perZone")}
            {N("Merge when both lines have (stations)", "mergeAt")}
            {N("A line is safe from (stations, 0 = never)", "safeAt")}
            {N("Majority bonus (× base price)", "majBonus")}
            {N("Minority bonus (× base price)", "minBonus")}
          </div>
          <p className="text-[13px] text-[#6B6B66] mt-4">
            Simulation found: separation peaks around round 14, so 15 is the sweet spot. Station base 3 with round-up
            destruction drains the bag but clusters stations; base 5 spreads them but barely burns discs. Crossing at a
            cost keeps lines unstuck where &ldquo;only at a station&rdquo; walls in 3–4 of the 7.
          </p>
        </Sheet>
      )}

      {status && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-5 z-50 bg-[#111] text-white text-[14px] px-4 py-2.5 rounded-lg shadow-lg max-w-[90vw]">{status}</div>
      )}

      {/* ── board ─────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 flex flex-col gap-2.5 p-2.5 sm:p-3 lg:h-[calc(100vh-48px)]">
        <div className="flex flex-wrap items-center gap-2">
          {tab === "play" ? (
            <div className="flex rounded-lg overflow-hidden border border-[#111]">
              {[["track", "Lay track"], ["station", "Build station"]].map(([m, l]) => (
                <button key={m} onClick={() => { setMode(m); setPending(null); }} className={seg(mode === m) + " h-9 px-3.5"}>{l}</button>
              ))}
            </div>
          ) : (
            <>
              <span className="text-[13px] font-bold mr-1">Editing map</span>
              {Object.entries(TERRAIN).map(([k, t]) => (
                <button key={k} onClick={() => setPaint(k)} className={`h-8 px-3 text-[13px] rounded-lg border-2 ${paint === k ? "border-[#111]" : "border-transparent"}`} style={{ background: t.fill }}>{t.label}</button>
              ))}
              <button onClick={() => { setTab("play"); setMode("track"); }} className="h-8 px-3 text-[13px] underline">Done</button>
            </>
          )}
          {tab === "play" && (
            <div className="flex flex-wrap items-center gap-1">
              {live.map((l) => {
                const n = handCount(cur, l.id), on = activeLine === l.id;
                return (
                  <button key={l.id} onClick={() => setActiveLine(l.id)} title={`${l.name} — ${cur?.name} holds ${n}`}
                          className={`h-9 pl-1 pr-2.5 rounded-full flex items-center gap-1.5 text-[13px] font-semibold border-2 ${on ? "border-[#111] bg-white" : "border-transparent hover:bg-white/70"}`}>
                    <Bullet lid={l.id} size={26} dim={!n} />
                    <span className={`hidden xl:inline ${n ? "" : "text-[#9A9A94]"}`}>{l.name}</span>
                    <span className="tabular-nums text-[#6B6B66]">{n}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="relative flex-1 min-h-[60vh] lg:min-h-0">
        <div className="absolute right-2 top-2 z-10 flex rounded-lg overflow-hidden border border-[#CFCEC7] shadow-sm">
          {[[1, "Fit"], [1.6, "Zoom"], [2.4, "×2"]].map(([z, l]) => (
            <button key={z} onClick={() => setZoom(z)} className={seg(zoom === z)}>{l}</button>
          ))}
        </div>
        <div className="absolute inset-0 bg-white rounded-xl border border-[#E2E1DB] overflow-auto">
          <svg viewBox={`${view.x0} ${view.y0} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet"
               style={zoom === 1 ? { width: "100%", height: "100%", display: "block", position: "absolute", inset: 0 } : { width: `${zoom * 100}%`, display: "block" }}>
            {cells.map(({ c, r, id }) => {
              const k = map.hexes[id]; if (!k && tab !== "map") return null;
              const x = cx(c, r), y = cy(c, r), z = ZONE_OF[id];
              const fill = !k ? "#F6F5F0" : k === "w" ? "#D6EAF5" : k === "o" ? "#E7D2C6" : (showZones && z !== undefined) ? ZONE_COLORS[z] : "#ECEBE3";
              return (
                <g key={id} onClick={() => onHex(id, !!k)} className="cursor-pointer">
                  <polygon points={hexPath(x, y)} fill={fill} stroke={k ? "#ffffff" : "#E2E1DB"} strokeWidth={k ? 2.5 : 1} strokeDasharray={k ? "" : "3 3"} />
                  {crossHexes.has(id) && <polygon points={hexPath(x, y)} fill="#B4530922" stroke="none" />}
                  {tab === "play" && netHexes.has(id) && <polygon points={hexPath(x, y)} fill={colorOf(activeLine)} fillOpacity="0.10" stroke="none" />}
                </g>
              );
            })}
            {showZones && zoneBorders.map((e, i) => (
              <line key={"zb" + i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#55554E" strokeWidth="2.5" strokeLinecap="round" pointerEvents="none" />
            ))}
            {(map.rivers || []).map((k) => { const [a, b] = k.split("|"); const e = sharedEdge(a, b);
              return <line key={"r" + k} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#2F7FC1" strokeWidth="6" strokeLinecap="round" pointerEvents="none" />; })}
            {(map.nocross || []).map((k) => { const [a, b] = k.split("|"); const e = sharedEdge(a, b);
              return <line key={"n" + k} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#2E7D46" strokeWidth="6" strokeLinecap="round" pointerEvents="none" />; })}
            {cells.map(({ c, r, id }) => {
              if (!map.hexes[id]) return null;
              const x = cx(c, r), y = cy(c, r);
              const ring = sel === id ? "#111" : pending === id ? "#111" : changed.hexes.has(id) ? "#E58A00" : null;
              if (!ring) return watchHexes.has(id) ? <g key={"o" + id} pointerEvents="none"><polygon points={hexPath(x, y)} fill="#D9302512" stroke="#D93025" strokeWidth="3" strokeDasharray="4 4" /><text x={x} y={y - 18} textAnchor="middle" style={{ fontSize: 13, fontWeight: 700 }} fill="#D93025">⚡</text></g> : null;
              return <polygon key={"o" + id} points={hexPath(x, y)} fill={changed.hexes.has(id) && sel !== id ? "#FFB0001F" : "none"} stroke={ring}
                              strokeWidth={pending === id ? 4 : 3} strokeDasharray={pending === id || sel === id ? "" : "8 5"} pointerEvents="none" />;
            })}
            {tab === "play" && mode === "track" && Object.entries(legal).map(([k, info]) => {
              const [a, b] = k.split("|"); const [ac, ar] = parseId(a), [bc, br] = parseId(b);
              return <line key={"lg" + k} x1={cx(ac, ar)} y1={cy(ac, ar)} x2={cx(bc, br)} y2={cy(bc, br)}
                           stroke={colorOf(activeLine)} strokeWidth="4" strokeDasharray="5 6" strokeLinecap="round"
                           opacity={canPay(info) ? 0.6 : 0.2} pointerEvents="none" />;
            })}
            {changed.edges.map(({ k, gone }) => {
              const [a, b] = k.split("|"); const [ac, ar] = parseId(a), [bc, br] = parseId(b);
              return <line key={"ch" + k} x1={cx(ac, ar)} y1={cy(ac, ar)} x2={cx(bc, br)} y2={cy(bc, br)} pointerEvents="none"
                           stroke={gone ? "#8A8A82" : "#FFB000"} strokeWidth={gone ? 4 : 20} strokeDasharray={gone ? "3 6" : ""} strokeLinecap="round" opacity={gone ? 0.9 : 0.55} />;
            })}
            {Object.keys(state.track).map((k) => {
              const lid = trackOwner(state, k);
              const [a, b] = k.split("|"); const [ac, ar] = parseId(a), [bc, br] = parseId(b);
              return (
                <g key={k} pointerEvents="none">
                  <line x1={cx(ac, ar)} y1={cy(ac, ar)} x2={cx(bc, br)} y2={cy(bc, br)} stroke="#fff" strokeWidth="13" strokeLinecap="round" />
                  <line x1={cx(ac, ar)} y1={cy(ac, ar)} x2={cx(bc, br)} y2={cy(bc, br)} stroke={colorOf(lid)} strokeWidth="8" strokeLinecap="round" />
                </g>
              );
            })}
            {cells.map(({ c, r, id }) => {
              if (!map.hexes[id]) return null;
              const x = cx(c, r), y = cy(c, r), stn = state.stations[id], nm = map.names[id];
              if (!stn && !nm) return null;
              return (
                <g key={"m" + id} onClick={() => onHex(id, true)} className="cursor-pointer">
                  {goalHexes.has(id) && <circle cx={x} cy={y} r="19" fill="none" stroke="#C99A00" strokeWidth="3" strokeDasharray="3 3" />}
                  {nm && !stn && <circle cx={x} cy={y} r="6" fill="#111" stroke="#fff" strokeWidth="2.5" />}
                  {stn && <>
                    <circle cx={x} cy={y} r="13" fill="#fff" stroke="#111" strokeWidth="3" />
                    <circle cx={x} cy={y} r="8" fill={colorOf(stn.o)} />
                  </>}
                </g>
              );
            })}
            {cells.map(({ c, r, id }) => {
              const nm = map.hexes[id] && map.names[id]; if (!nm) return null;
              const x = cx(c, r), y = cy(c, r), words = nm.split(" ");
              const half = Math.ceil(words.length / 2);
              const lines = nm.length > 13 && words.length > 1 ? [words.slice(0, half).join(" "), words.slice(half).join(" ")] : [nm];
              return (
                <text key={"t" + id} x={x} y={y + 25} textAnchor="middle" pointerEvents="none"
                      style={{ fontSize: 10.5, fontWeight: 700, paintOrder: "stroke", stroke: "#fff", strokeWidth: 3, strokeLinejoin: "round", letterSpacing: "-0.01em" }} fill="#1A1A18">
                  {lines.map((t, i) => <tspan key={i} x={x} dy={i ? 11 : 0}>{t}</tspan>)}
                </text>
              );
            })}
          </svg>
        </div>
        </div>

        {sel && map.hexes[sel] && (
          <div className="text-[13px] text-[#3A3A36] bg-white rounded-lg border border-[#E2E1DB] px-3 py-2 flex flex-wrap items-center gap-x-2">
            <b>{map.names[sel] || "This hex"}</b>
            <span>· nearest station {selCost?.d === null ? "none yet" : `${selCost?.d} hex${selCost?.d === 1 ? "" : "es"} away`}</span>
            <span>· a {lineOf(activeLine)?.name} station here costs <b className="tabular-nums">{selCost?.c} discs</b>
              {" "}({burnCount(state, selCost?.c || 0)} destroyed, {(selCost?.c || 0) - burnCount(state, selCost?.c || 0)} back to the bag)</span>
            <button onClick={() => setSel(null)} className="ml-auto text-[#6B6B66] underline">clear</button>
          </div>
        )}
      </main>

      {/* ── turn panel + sidebar ──────────────────────────── */}
      <aside className="w-full lg:w-[420px] shrink-0 bg-white border-t lg:border-t-0 lg:border-l border-[#E2E1DB] flex flex-col lg:h-[calc(100vh-48px)]">
        <section className="p-4 border-b border-[#E2E1DB]">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-[#6B6B66]">
            Round {state.turn.round} of {S.roundLimit}
            {over && <span className="px-1.5 py-0.5 rounded bg-[#111] text-white normal-case tracking-normal">Game over</span>}
            {S.strict && <span className="px-1.5 py-0.5 rounded bg-[#E9F3EC] text-[#1E6B36] normal-case tracking-normal">Rules on</span>}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <h2 className="text-[22px] font-bold leading-tight truncate">{myTurn ? "Your turn" : `${cur?.name}'s turn`}</h2>
            {seat !== null && seat !== undefined && !myTurn && <span className="text-[12px] px-2 py-0.5 rounded-full bg-[#FFF3D6] text-[#8A5A00] font-semibold shrink-0">you&rsquo;re {viewer?.name}</span>}
            <span className="ml-auto flex items-center gap-1 shrink-0" title="Action points — click to adjust">
              {Array.from({ length: S.apPerTurn }).map((_, i) => (
                <button key={i} onClick={() => commit((s) => { s.turn.ap = i < state.turn.ap ? i : i + 1; })}
                        className="w-4 h-4 rounded-full border-2 border-[#111]" style={{ background: i < state.turn.ap ? "#111" : "transparent" }} />
              ))}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <button onClick={drawDiscs} className={btn}>Draw {S.drawCount}</button>
            <button onClick={callDividends} disabled={S.strict && state.turn.usedSlot} className={btn}>Dividends</button>
            <button onClick={endTurn} className="h-10 rounded-lg bg-[#111] text-white font-semibold text-[14px] hover:bg-black">End turn</button>
          </div>
          <div className="flex items-center gap-3 mt-2 text-[13px]">
            <button onClick={undo} disabled={!T.canUndo} className="text-[#3A3A36] underline disabled:no-underline disabled:text-[#B5B4AD]">↶ Undo my move</button>
            <button onClick={() => setShowTally(true)} className="text-[#3A3A36] underline">Tally</button>
            <span className="ml-auto text-[12px] text-[#6B6B66] tabular-nums" title="Discs in the bag · on the board · destroyed">
              bag {state.bag.length} · board {state.onboard.length} · gone {state.burned.length}
            </span>
          </div>

          {watch.length > 0 && (
            <div className="mt-3 text-[13px] space-y-1">
              {watch.map((w) => (
                <div key={`${w.a}-${w.b}`} className="flex items-center gap-1.5 flex-wrap text-[#3A3A36]">
                  <span className="text-[#D93025] font-bold">⚡</span><Bullet lid={w.a} size={18} /><Bullet lid={w.b} size={18} />
                  <span>{lineOf(w.a)?.name} ({w.sa}) and {lineOf(w.b)?.name} ({w.sb}) are one track apart{w.ready ? ": the next track there merges them" : `: a merge needs ${S.mergeAt} stations each`}</span>
                </div>
              ))}
            </div>
          )}

          {S.goals && state.goals && (
            <div className="mt-3 text-[13px]">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-[#6B6B66] mb-1">Landmark goals · ${S.goalBonus} to whoever completes one</div>
              {state.goals.public.map((id) => { const g = goalById(id), d = state.goals.done[id];
                return <div key={id} className={d ? "text-[#9A9A94] line-through" : ""}><span className="text-[#C99A00]">◎</span> {g.name}{d ? ` · ${lineOf(d.line)?.name}, round ${d.round}` : ""}</div>; })}
              {mySecrets ? (
                <div className="mt-1.5"><span className="text-[12px] font-semibold uppercase tracking-wide text-[#6B6B66]">Your secret routes · ${S.secretValue} each at the end</span>
                  {mySecrets.map((id) => { const g = goalById(id), ok = goalLine(state, g) !== undefined;
                    return <div key={id} className={ok ? "text-[#1E6B36]" : ""}>{ok ? "✓" : "○"} {g.name}</div>; })}
                </div>
              ) : <div className="mt-1 text-[12px] text-[#6B6B66]">Pick your seat to see your secret routes.</div>}
            </div>
          )}

          {dueMerges.map(({ a, d }) => {
            const pays = mergePayouts(state, d).filter((x) => x.bonus || x.sale);
            return (
              <div key={`${a}-${d}`} className="mt-3 rounded-lg border-2 border-[#E58A00] bg-[#FFF6DB] p-3 text-[13px]">
                <div className="flex items-center gap-1.5 font-bold text-[14px]">
                  <Bullet lid={d} size={22} /><span>→</span><Bullet lid={a} size={22} />
                  <span>{lineOf(a)?.name} meets {lineOf(d)?.name}</span>
                </div>
                <p className="mt-1 text-[#3A3A36]">
                  {lineOf(d)?.name} ({stationsOf(state, d)} stations) merges into {lineOf(a)?.name} ({stationsOf(state, a)}).{" "}
                  {pays.length ? pays.map((x) => `${x.name} gets $${x.bonus + x.sale}${x.bonus ? ` ($${x.bonus} bonus)` : ""}`).join(" · ") : "Nobody holds shares in it."}
                </p>
                <button onClick={() => runMerge(a, d)} className="mt-2 h-9 px-4 rounded-lg bg-[#111] text-white font-semibold">Merge now</button>
              </div>
            );
          })}

          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-[#6B6B66]">
                {viewer === cur ? `${cur?.name}'s hand` : "Your hand"} · {hand.length}/{S.handLimit}
              </span>
              <span className="flex gap-3 text-[12px]">
                <button onClick={() => setAdjust((a) => !a)} className="underline text-[#6B6B66]">{adjust ? "done" : "adjust"}</button>
                <button onClick={() => setReveal((r) => !r)} className="underline text-[#6B6B66]">{reveal ? "hide" : "show"}</button>
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {handBy.filter(({ n }) => n || adjust).map(({ l, n }) => (
                <span key={l.id} className="flex items-center gap-1 rounded-full bg-[#F2F1EC] pl-0.5 pr-2 h-8">
                  {reveal ? <Bullet lid={l.id} size={26} /> : <span className="w-[26px] h-[26px] rounded-full bg-[#CFCEC7]" />}
                  {adjust && <button onClick={() => commit((s2) => { const q = s2.players.find((x) => x.id === viewer.id); const ix = q.hand.indexOf(l.id); if (ix >= 0) { q.hand.splice(ix, 1); s2.bag.push(l.id); } }, `returned a ${l.name} disc`)}
                                     className="w-6 h-6 rounded-full hover:bg-white text-[16px] leading-none">−</button>}
                  <span className="text-[14px] font-bold tabular-nums w-3 text-center">{reveal ? n : "?"}</span>
                  {adjust && <button onClick={() => commit((s2) => { const q = s2.players.find((x) => x.id === viewer.id); q.hand.push(l.id); const ix = s2.bag.indexOf(l.id); if (ix >= 0) s2.bag.splice(ix, 1); }, `took a ${l.name} disc`)}
                                     className="w-6 h-6 rounded-full hover:bg-white text-[16px] leading-none">+</button>}
                </span>
              ))}
              {!hand.length && !adjust && <span className="text-[13px] text-[#6B6B66]">Empty. Press Draw, or adjust.</span>}
            </div>
          </div>

          {room && (state.log || []).length > 0 && (
            <div className="mt-4 text-[13px] space-y-1">
              {(state.log || []).slice(0, 3).map((l, i) => (
                <div key={i} className={`flex gap-1.5 ${i < changed.log ? "" : "text-[#6B6B66]"}`}>
                  <span className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${i < changed.log ? "bg-[#E58A00]" : "bg-transparent"}`} />
                  <span className="min-w-0"><b>{l.who}</b> {l.note} <span className="text-[#9A9A94]">{ago(l.t)}</span></span>
                </div>
              ))}
              {changed.hexes.size > 0 && (
                <div className="text-[12px] text-[#8A5A00]">Changes since your last move are outlined in amber. <button onClick={T.clearSince} className="underline">Clear</button></div>
              )}
            </div>
          )}
        </section>

        <nav className="flex border-b border-[#E2E1DB] px-2 shrink-0">
          {[["lines", "Lines"], ["investors", "Investors"], ["zones", "Zones"], ["log", "Log"]].map(([k, l]) => (
            <button key={k} onClick={() => setSide(k)}
                    className={`px-3 py-2.5 text-[14px] font-semibold border-b-[3px] -mb-px ${side === k ? "border-[#111] text-[#111]" : "border-transparent text-[#6B6B66] hover:text-[#111]"}`}>
              {l}{k === "log" && changed.log > 0 && <span className="ml-1 inline-block min-w-[18px] px-1 rounded-full bg-[#E58A00] text-white text-[11px]">{changed.log}</span>}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-h-0 overflow-auto p-4">
          {side === "lines" && (
            <>
              <table className="w-full text-[13px] tabular-nums">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[#6B6B66]">
                    <th className="text-left font-semibold pb-2">Line</th>
                    <th className="text-right font-semibold pb-2" title="Stations">Stn</th>
                    <th className="text-right font-semibold pb-2" title="Zones reached">Zn</th>
                    <th className="text-right font-semibold pb-2" title="Dividend per share">Div</th>
                    <th className="text-left font-semibold pb-2 pl-2" title="Biggest holder (majority bonus) / second biggest (minority)">Leads</th>
                    <th className="text-right font-semibold pb-2 pr-1">Buy</th>
                  </tr>
                </thead>
                <tbody>
                  {live.map((l) => {
                    const rc = reach[l.id], isAcq = acquirer?.id === l.id;
                    const noBuy = S.strict && (handCount(cur, l.id) < 1 || (cur?.cash ?? 0) < rc.price || rc.left <= 0 || state.turn.invests >= S.investPerTurn);
                    const noWild = S.strict && ((cur?.hand || []).length < S.wildCost || (cur?.cash ?? 0) < rc.price || rc.left <= 0 || state.turn.invests >= S.investPerTurn);
                    return (
                      <tr key={l.id} className="border-t border-[#EEEDE8]">
                        <td className="py-2">
                          <span className="flex items-center gap-2">
                            <Bullet lid={l.id} size={24} />
                            <span className="font-semibold">{l.name}</span>
                            {S.safeAt > 0 && rc.stations >= S.safeAt && <span className="text-[10px] px-1.5 rounded bg-[#1E6B36] text-white font-semibold" title={`${S.safeAt}+ stations: can't be absorbed`}>SAFE</span>}
                            {S.safeAt > 0 && rc.stations < S.safeAt && rc.stations >= S.safeAt - 2 && <span className="text-[10px] px-1.5 rounded bg-[#E9F3EC] text-[#1E6B36] font-semibold" title={`${S.safeAt - rc.stations} more station${S.safeAt - rc.stations > 1 ? "s" : ""} and it can't be absorbed`}>SAFE IN {S.safeAt - rc.stations}</span>}
                          </span>
                        </td>
                        <td className="text-right">{rc.stations}</td>
                        <td className="text-right">{rc.zones.length}</td>
                        <td className="text-right font-bold">${rc.per}</td>
                        <td className="text-left pl-2 text-[12px] leading-tight">{(() => { const h = holders(state, l.id);
                          return h.major.length ? <><b>{h.major.map((x) => x.name).join(" = ")}</b> <span className="text-[#6B6B66]">{h.major[0].n}</span>{h.minor.length ? <span className="text-[#6B6B66]"><br />{h.minor.map((x) => x.name).join(" = ")} {h.minor[0].n}</span> : null}</> : <span className="text-[#9A9A94]">nobody</span>; })()}</td>
                        <td className="text-right pl-2">
                          <span className="inline-flex gap-1">
                            <button disabled={noBuy} onClick={() => invest(l.id, false)} title={`1 ${l.name} disc + $${rc.price}`}
                                    className="h-8 min-w-[46px] px-2 rounded-md border border-[#CFCEC7] font-semibold hover:bg-[#F2F1EC] disabled:opacity-30">${rc.price}</button>
                            <button disabled={noWild} onClick={() => invest(l.id, true)} title={`${S.wildCost} discs of any colour + $${rc.price}`}
                                    className="h-8 px-2 rounded-md border border-[#CFCEC7] text-[12px] hover:bg-[#F2F1EC] disabled:opacity-30">Wild</button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[12px] text-[#6B6B66] mt-2">
                Stn stations · Zn zones reached · Div dividend per share · Left shares unsold. The price button buys with one disc of that line; Wild uses {S.wildCost} of any colour.
                Invests this turn: {state.turn.invests}/{S.investPerTurn}.
              </p>

              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#6B6B66] mt-6 mb-2">Merges</h3>
              <p className="text-[13px] text-[#6B6B66] mb-2">
                When two lines meet and both have {S.mergeAt} or more stations, the line with more stations absorbs the other
                {S.safeAt ? <> (a line with {S.safeAt}+ stations is safe and can&rsquo;t be absorbed)</> : null}. The absorbed line&rsquo;s biggest
                holder gets {S.majBonus}× its base price, the second biggest {S.minBonus}×, then every holder sells those shares at the base price.
                Its track, stations and discs become the acquirer&rsquo;s.
              </p>
              {dueMerges.length > 0 && <p className="text-[13px] font-semibold text-[#8A5A00] mb-2">A merge is due. See the turn panel.</p>}
              {(state.mergers || []).length > 0 && (
                <div className="text-[13px] space-y-1 mb-3">
                  {(state.mergers || []).map((m, i) => (
                    <div key={i} className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[#6B6B66]">Round {m.round}:</span><Bullet lid={m.d} size={18} /><span>→</span><Bullet lid={m.a} size={18} />
                      <span className="text-[#6B6B66]">{lineOf(m.d)?.name} into {lineOf(m.a)?.name}</span>
                      {m.pays?.length > 0 && <span className="text-[#6B6B66]">· {m.pays.map((x) => `${state.players.find((p) => p.id === x.id)?.name || "?"} $${x.bonus + x.sale}`).join(", ")}</span>}
                    </div>
                  ))}
                </div>
              )}
              <details className="text-[13px]">
                <summary className="cursor-pointer text-[#6B6B66]">Merge two lines by hand</summary>
                <div className="flex items-center gap-2 mt-2">
                  <select value={mergeFrom} onChange={(e) => setMergeFrom(Number(e.target.value))} className="h-9 flex-1 min-w-0 rounded-md border border-[#CFCEC7] bg-white px-2">
                    {live.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <span className="text-[#6B6B66]">into</span>
                  <select value={mergeTo} onChange={(e) => setMergeTo(Number(e.target.value))} className="h-9 flex-1 min-w-0 rounded-md border border-[#CFCEC7] bg-white px-2">
                    {live.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <button onClick={() => { if (mergeFrom !== mergeTo && confirm(`Merge ${lineOf(mergeFrom)?.name} into ${lineOf(mergeTo)?.name}? Bonuses are paid and its shares are sold.`)) doMerge(); }}
                          className="h-9 px-3 rounded-md bg-[#111] text-white font-semibold">Merge</button>
                </div>
              </details>
            </>
          )}

          {side === "investors" && (
            <div className="space-y-3">
              {state.players.map((p, idx) => {
                const div = Object.entries(p.shares || {}).reduce((a, [lid, n]) => a + n * (reach[lid]?.per || 0), 0);
                const port = Object.entries(p.shares || {}).reduce((a, [lid, n]) => a + n * (reach[lid]?.price || 0), 0);
                return (
                  <div key={p.id} className={`rounded-xl border p-3 ${p.id === me ? "border-[#111] border-2" : "border-[#E2E1DB]"}`}>
                    <div className="flex items-center gap-2">
                      <input value={p.name} onChange={(e) => edit((s) => { s.players[idx].name = e.target.value; })}
                             className="flex-1 min-w-0 font-bold text-[16px] bg-transparent focus:outline-none focus:bg-[#F2F1EC] rounded px-1 -mx-1" />
                      {seat === p.id && <span className="text-[11px] px-1.5 py-0.5 rounded bg-[#F2F1EC] font-semibold">you</span>}
                      <span className="flex items-center text-[16px] font-bold tabular-nums">
                        $<input type="number" step={10} value={p.cash} onChange={(e) => edit((s2) => { s2.players[idx].cash = Number(e.target.value) || 0; })}
                                className="w-16 bg-transparent text-right focus:outline-none focus:bg-[#F2F1EC] rounded" />
                      </span>
                      {p.id === me
                        ? <span className="text-[11px] px-2 py-1 rounded-md bg-[#111] text-white font-semibold">Active</span>
                        : <button onClick={() => commit((s) => { s.turn.active = p.id; }, `made ${p.name} active`)} className="text-[11px] px-2 py-1 rounded-md border border-[#CFCEC7] font-semibold hover:bg-[#F2F1EC]">Make active</button>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {live.map((l) => {
                        const n = (p.shares || {})[l.id] || 0;
                        return (
                          <span key={l.id} className={`flex items-center rounded-full h-8 pl-0.5 pr-0.5 ${n ? "bg-[#F2F1EC]" : "bg-[#F8F8F5] opacity-60 hover:opacity-100"}`}>
                            <Bullet lid={l.id} size={24} />
                            <button onClick={() => commit((s) => { const q = s.players.find((x) => x.id === p.id); q.shares[l.id] = Math.max(0, (q.shares[l.id] || 0) - 1); s.sold[l.id] = Math.max(0, (s.sold[l.id] || 0) - 1); }, `took a ${l.name} share from ${p.name}`)}
                                    className="w-6 h-7 text-[16px] leading-none hover:bg-white rounded-full">−</button>
                            <span className="text-[13px] font-bold tabular-nums w-3 text-center">{n}</span>
                            <button onClick={() => commit((s) => { const q = s.players.find((x) => x.id === p.id); q.shares[l.id] = (q.shares[l.id] || 0) + 1; s.sold[l.id] = (s.sold[l.id] || 0) + 1; }, `gave ${p.name} a ${l.name} share`)}
                                    className="w-6 h-7 text-[16px] leading-none hover:bg-white rounded-full">+</button>
                          </span>
                        );
                      })}
                    </div>
                    <div className="mt-2 text-[12px] text-[#6B6B66] tabular-nums">
                      {(p.hand || []).length} discs · dividends ${div} · shares ${score.find((r) => r.id === p.id)?.shares ?? 0}
                      {S.endBonuses ? ` · bonuses $${score.find((r) => r.id === p.id)?.bonuses ?? 0}` : ""} · <b className="text-[#111]">score ${(score.find((r) => r.id === p.id)?.total ?? 0) - (S.goals && p.id !== seat && !over ? (score.find((r) => r.id === p.id)?.routes ?? 0) : 0)}{S.goals && p.id !== seat && !over ? "+" : ""}</b>
                    </div>
                  </div>
                );
              })}
              <button onClick={() => commit((s) => { const ids = s.players.map((p) => p.id); let i = 0; while (ids.includes(i)) i++;
                        const fresh = untouched(s), n2 = s.players.length + 1;
                        const q = v2Player(i, s.settings, n2); q.cash = startingCash(s.settings, s.players.length, n2);
                        for (let n = 0; n < s.settings.startingHand && s.bag.length; n++) q.hand.push(s.bag.pop()); s.players.push(q);
                        // before anyone has acted, re-deal starting cash so seat order sets it (4+ players: $60/$70/$80/$90)
                        if (fresh) s.players.forEach((p, k) => { p.cash = startingCash(s.settings, k, n2); });
                      }, "added an investor")}
                      className={btn + " w-full"}>+ Add investor</button>
            </div>
          )}

          {side === "zones" && (
            <div className="space-y-1.5 text-[14px]">
              {ZONES.map((z, zi) => {
                const ls = LINES.filter((l) => (reach[l.id]?.zones || []).includes(zi));
                return (
                  <div key={z} className={`flex items-center gap-2.5 ${ls.length ? "" : "text-[#9A9A94]"}`}>
                    <span className="w-4 h-4 rounded shrink-0" style={{ background: ZONE_COLORS[zi] }} />
                    <span className="flex-1 truncate">{z}</span>
                    {ls.length ? <span className="flex gap-1">{ls.map((l) => <Bullet key={l.id} lid={l.id} size={20} />)}</span>
                               : <span className="text-[12px] italic">unreached</span>}
                  </div>
                );
              })}
            </div>
          )}

          {side === "log" && (
            <div className="space-y-1.5 text-[13px]">
              {!(state.log || []).length && <p className="text-[#6B6B66]">Nothing yet.</p>}
              {(state.log || []).map((l, i) => (
                <div key={i} className={`flex gap-1.5 ${i < changed.log ? "" : "text-[#3A3A36]"}`}>
                  <span className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${i < changed.log ? "bg-[#E58A00]" : "bg-transparent"}`} />
                  <span className="min-w-0"><b>{l.who}</b> {l.note} <span className="text-[#9A9A94]">{ago(l.t)}</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
