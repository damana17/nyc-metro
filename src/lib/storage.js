/*  Sync layer — the only file that knows about a backend.
 *
 *   • Supabase — real multiplayer, when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 *     are set at build time. Changes arrive over Realtime the moment they're saved.
 *   • localStorage — the fallback. A "table" is shared only between tabs of one
 *     browser, which is enough to test the sync logic but not to play remotely.
 *
 *  Every write is CONDITIONAL: put(key, value, v, prevV) only succeeds if the
 *  stored row is still at prevV (or, with prevV === null, if there is no row yet).
 *  Otherwise it reports a conflict, and the caller re-reads and replays its move.
 *  That is what stops two players acting at once from silently overwriting
 *  each other.
 *
 *    get(key)                    -> { value, v } | null
 *    put(key, value, v, prevV)   -> { ok: true } | { ok: false, conflict: true }
 *    subscribe(key, onChange)    -> unsubscribe()   (onChange takes no args; re-read)
 */
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TABLE = import.meta.env.VITE_SUPABASE_TABLE || "boards";

export const backend = URL && KEY ? "supabase" : "local";

/* ── Supabase ─────────────────────────────────────────────────────────── */
function makeSupabase() {
  const db = createClient(URL, KEY, { auth: { persistSession: false } });
  return {
    async get(key) {
      const { data, error } = await db.from(TABLE).select("value,v").eq("id", key).maybeSingle();
      if (error) throw new Error(`read failed: ${error.message}`);
      return data ? { value: data.value, v: Number(data.v) || 0 } : null;
    },
    async put(key, value, v, prevV) {
      const updated_at = new Date().toISOString();
      if (prevV === null) {
        const { error } = await db.from(TABLE).insert({ id: key, value, v, updated_at });
        if (!error) return { ok: true };
        if (error.code === "23505") return { ok: false, conflict: true };   // someone created it first
        throw new Error(`write failed: ${error.message}`);
      }
      const { data, error } = await db.from(TABLE).update({ value, v, updated_at })
        .eq("id", key).eq("v", prevV).select("v");
      if (error) throw new Error(`write failed: ${error.message}`);
      return data && data.length ? { ok: true } : { ok: false, conflict: true };
    },
    subscribe(key, onChange, onStatus) {
      const ch = db.channel("t:" + key)
        .on("postgres_changes", { event: "*", schema: "public", table: TABLE, filter: `id=eq.${key}` }, () => onChange())
        .subscribe((s) => onStatus && onStatus(s === "SUBSCRIBED" ? "live" : s.toLowerCase()));
      return () => { db.removeChannel(ch); };
    },
  };
}

/* ── localStorage ─────────────────────────────────────────────────────── */
const local = {
  async get(key) {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    try {
      const o = JSON.parse(raw);
      if (o && typeof o.value === "string") return { value: o.value, v: Number(o.v) || 0 };
    } catch (e) { /* fall through */ }
    return { value: raw, v: 0 };                     // written by the old build
  },
  async put(key, value, v, prevV) {
    const cur = await local.get(key);
    if (prevV === null ? cur !== null : !cur || cur.v !== prevV) return { ok: false, conflict: true };
    window.localStorage.setItem(key, JSON.stringify({ value, v }));
    return { ok: true };
  },
  subscribe(key, onChange, onStatus) {
    const h = (e) => { if (e.key === key) onChange(); };
    window.addEventListener("storage", h);
    onStatus && onStatus("this browser only");
    return () => window.removeEventListener("storage", h);
  },
};

export const storage = backend === "supabase" ? makeSupabase() : local;
export const localStore = local;
