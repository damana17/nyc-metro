/*  useTable — one shared game state, kept in step across browsers.
 *
 *  A move is a FUNCTION (mut) over the state, not a finished state. Moves wait in
 *  a queue; the writer applies every queued move to the last state the server
 *  confirmed and saves the result conditionally ("only if the table is still at
 *  v41"). If somebody else saved first, the write is refused, the writer re-reads
 *  the table and replays the same moves on top of what they did. Nobody's move
 *  is lost and nobody ends up looking at a different board.
 *
 *  The screen always shows: confirmed server state + my queued moves.
 *
 *  Undo only takes back YOUR last save. If others have moved since, it asks first,
 *  because restoring your old board would erase their moves too.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { storage, localStore, backend } from "./storage";

const clone = (o) => JSON.parse(JSON.stringify(o));
export const cleanCode = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);

const GAME = { i: "influence", c: "contracts" };
/* ?t=code belongs to whichever game ?g= names (V2 when absent), so a V2 invite doesn't open a V1 table too */
const urlRoom = (ns) => {
  try {
    const q = new URLSearchParams(window.location.search);
    return (q.get("g") || "influence") === GAME[ns] ? cleanCode(q.get("t")) : "";
  } catch (e) { return ""; }
};
const setUrlRoom = (ns, code) => {
  try {
    const u = new URL(window.location.href);
    if (code) { u.searchParams.set("t", code); u.searchParams.set("g", GAME[ns]); }
    else if ((u.searchParams.get("g") || "influence") === GAME[ns]) u.searchParams.delete("t");
    window.history.replaceState(null, "", u.toString());
  } catch (e) { /* ignore */ }
};
const lsGet = (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v === null || v === undefined) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

export function shareLink(room, game) {
  try {
    const u = new URL(window.location.href);
    u.search = "";
    u.searchParams.set("t", room);
    if (game && game !== "influence") u.searchParams.set("g", game);
    return u.toString();
  } catch (e) { return ""; }
}

export function useTable(ns, makeFresh, { finish, who } = {}) {
  const [room, setRoom] = useState(() => urlRoom(ns) || cleanCode(lsGet(`nycmetro:room:${ns}`)));
  const key = room ? `nycmetro${ns}${room}` : `nycmetro${ns}:solo`;
  const store = room ? storage : localStore;

  const [state, setState] = useState(makeFresh);
  const [since, setSince] = useState(null);           // the board as it stood after my last move
  const [diag, setDiag] = useState({ link: "", err: "", note: "", at: "", conflicts: 0, pending: 0 });
  const [loaded, setLoaded] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  const server = useRef({ state: null, v: null });   // last state the server confirmed
  const queue = useRef([]);
  const undoStack = useRef([]);
  const writing = useRef(false);
  const keyRef = useRef(key); keyRef.current = key;
  const storeRef = useRef(store); storeRef.current = store;
  const stateRef = useRef(state); stateRef.current = state;
  const finishRef = useRef(finish); finishRef.current = finish;
  const whoRef = useRef(who); whoRef.current = who;

  const apply = useCallback((base, ops) => {
    let n = clone(base);
    for (const op of ops) {
      const r = op.mut(n);
      if (r && typeof r === "object" && r !== n) n = clone(r);   // a move may hand back a whole new board; never share it
      if (finishRef.current) finishRef.current(n);
      if (op.note) n.log = [{ who: op.who, note: op.note, t: op.t }, ...(n.log || [])].slice(0, 80);
    }
    return n;
  }, []);

  const render = useCallback(() => {
    const s = server.current.state;
    if (!s) return;
    const view = queue.current.length ? apply(s, queue.current) : s;
    stateRef.current = view;
    setState(view);
    setDiag((d) => ({ ...d, pending: queue.current.length }));
  }, [apply]);

  const stamp = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

  /* read the table; returns false if the key changed underneath us */
  const load = useCallback(async () => {
    const k = keyRef.current;
    let res;
    try { res = await storeRef.current.get(k); }
    catch (e) { setDiag((d) => ({ ...d, err: String(e?.message || e) })); return true; }
    if (k !== keyRef.current) return false;
    if (!res) {
      if (server.current.v === null && !server.current.state) server.current = { state: stateRef.current, v: null };
      return true;
    }
    if (server.current.v !== null && res.v < server.current.v) return true;   // a stale read; ignore
    let parsed;
    try { parsed = JSON.parse(res.value); }
    catch (e) { setDiag((d) => ({ ...d, err: "table holds unreadable data" })); return true; }
    const changed = res.v !== server.current.v;
    server.current = { state: { ...parsed, v: res.v }, v: res.v };
    if (changed) render();
    setDiag((d) => ({ ...d, err: "", at: stamp() }));
    return true;
  }, [render]);

  const flush = useCallback(async () => {
    if (writing.current) return;
    if (!queue.current.length && server.current.v !== null) return;
    if (!server.current.state) return;
    writing.current = true;
    const k = keyRef.current;
    try {
      for (let tries = 0; tries < 10; tries++) {
        // an undo is only valid against the exact version it was asked for
        const stale = queue.current.filter((o) => o.expectV !== undefined && o.expectV !== server.current.v);
        if (stale.length) {
          queue.current = queue.current.filter((o) => !stale.includes(o));
          setDiag((d) => ({ ...d, note: "undo cancelled — someone moved at the same moment" }));
          render();
        }
        if (!queue.current.length && server.current.v !== null) break;
        const ops = queue.current.slice();
        const base = server.current.state, prevV = server.current.v;
        const v = (prevV ?? 0) + 1;
        const next = apply(base, ops); next.v = v;
        const res = await storeRef.current.put(k, JSON.stringify(next), v, prevV);
        if (k !== keyRef.current) return;
        if (res.ok) {
          server.current = { state: next, v };
          queue.current.splice(0, ops.length);
          const real = ops.filter((o) => !o.quiet && !o.isUndo);
          if (real.length && prevV !== null) {
            undoStack.current = [...undoStack.current, { before: base, vAfter: v, notes: real.map((o) => o.note).filter(Boolean) }].slice(-40);
          } else if (ops.every((o) => o.quiet) && undoStack.current.length) {
            const top = undoStack.current[undoStack.current.length - 1];
            if (top.vAfter === prevV) top.vAfter = v;      // my own typing doesn't block my undo
          }
          setCanUndo(undoStack.current.length > 0);
          setDiag((d) => ({ ...d, err: "", at: stamp() }));
          render();
          tries = -1;
          if (!queue.current.length) break;
        } else {
          setDiag((d) => ({ ...d, conflicts: d.conflicts + 1 }));
          if (!(await load())) return;
        }
      }
    } catch (e) {
      setDiag((d) => ({ ...d, err: "save failed: " + (e?.message || e) + " — retrying" }));
      setTimeout(() => flush(), 3000);
    } finally { writing.current = false; }
    if (queue.current.length && k === keyRef.current) setTimeout(() => flush(), 0);
  }, [apply, load, render]);

  /* (re)connect whenever the table changes */
  useEffect(() => {
    let alive = true;
    server.current = { state: null, v: null };
    queue.current = []; undoStack.current = []; setCanUndo(false);
    setLoaded(false);
    setDiag({ link: room ? (backend === "supabase" ? "connecting" : "this browser only") : "", err: "", note: "", at: "", conflicts: 0, pending: 0 });
    (async () => {
      await load();
      if (!alive) return;
      if (server.current.v === null) {                 // empty table: publish the board on screen
        server.current = { state: stateRef.current, v: null };
        await flush();
      }
      if (!alive) return;
      setSince(server.current.state);
      setLoaded(true);
    })();
    if (!room) return () => { alive = false; };
    const unsub = storeRef.current.subscribe(key, () => { load().then(() => flush()); },
      (s) => setDiag((d) => ({ ...d, link: s })));
    const t = setInterval(() => { load().then(() => flush()); }, backend === "supabase" ? 5000 : 2500);
    const vis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; unsub(); clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [key]); // eslint-disable-line

  const commit = useCallback((mut, note, opts = {}) => {
    const op = { mut, note, quiet: !!opts.quiet, t: Date.now(), who: whoRef.current ? whoRef.current(stateRef.current) : "" };
    queue.current.push(op);
    render();
    if (!opts.quiet) setSince(stateRef.current);
    flush();
  }, [render, flush]);

  const undo = useCallback(() => {
    if (writing.current || queue.current.length) return { ok: false, why: "still saving — try again in a moment" };
    const rec = undoStack.current[undoStack.current.length - 1];
    if (!rec) return { ok: false, why: "nothing of yours to undo" };
    const later = (server.current.v ?? 0) - rec.vAfter;
    if (later > 0 && !window.confirm(`${later} change${later > 1 ? "s have" : " has"} been made by others since your last move. Undoing will erase ${later > 1 ? "them" : "it"} too. Undo anyway?`)) return { ok: false };
    undoStack.current = undoStack.current.slice(0, -1);
    setCanUndo(undoStack.current.length > 0);
    const back = clone(rec.before);
    queue.current.push({ mut: () => back, note: `undid ${rec.notes.length ? "“" + rec.notes.join(", ") + "”" : "a change"}`,
                         isUndo: true, expectV: server.current.v, t: Date.now(), who: whoRef.current ? whoRef.current(stateRef.current) : "" });
    render(); setSince(stateRef.current); flush();
    return { ok: true };
  }, [render, flush]);

  const join = useCallback((code) => {
    const c = cleanCode(code);
    setUrlRoom(ns, c);
    lsSet(`nycmetro:room:${ns}`, c || null);
    setRoom(c);
  }, [ns]);

  const seatKey = `nycmetro:seat:${key}`;
  const readSeat = () => { const v = lsGet(seatKey); return v === null ? undefined : v === "all" ? null : Number(v); };
  const [seat, setSeatState] = useState(readSeat);
  useEffect(() => { setSeatState(readSeat()); }, [seatKey]); // eslint-disable-line
  const setSeat = useCallback((s) => { lsSet(seatKey, s === undefined ? null : s === null ? "all" : String(s)); setSeatState(s); }, [seatKey]);

  return { state, room, join, commit, undo, canUndo, diag, loaded, since, clearSince: () => setSince(stateRef.current), seat, setSeat };
}
