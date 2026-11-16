/*  Sync layer.
 *
 *  Two backends, chosen automatically:
 *
 *   • Supabase — real multiplayer. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 *     in .env and every browser that joins the same table code shares a board.
 *
 *   • localStorage — the fallback when those aren't set. The app works fully,
 *     but a "table" is only shared between tabs on the same machine. Fine for
 *     solo development; useless for playing with someone else.
 *
 *  The game code only ever calls storage.get(key) and storage.set(key, value),
 *  so swapping in Firebase, PartyKit or your own server means rewriting this
 *  file and nothing else.
 */

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TABLE = import.meta.env.VITE_SUPABASE_TABLE || "boards";

export const backend = URL && KEY ? "supabase" : "local";

/* ── Supabase via plain REST, so there's no client library to install ────── */
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates,return=minimal",
};

const supabase = {
  async get(key) {
    const r = await fetch(`${URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(key)}&select=value`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!r.ok) throw new Error(`read failed: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    return rows.length ? { key, value: rows[0].value } : null;
  },
  async set(key, value) {
    const r = await fetch(`${URL}/rest/v1/${TABLE}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: key, value, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`write failed: ${r.status} ${await r.text()}`);
    return { key, value };
  },
};

/* ── localStorage fallback ──────────────────────────────────────────────── */
const local = {
  async get(key) {
    const v = window.localStorage.getItem(key);
    return v === null ? null : { key, value: v };
  },
  async set(key, value) {
    window.localStorage.setItem(key, value);
    return { key, value };
  },
};

export const storage = backend === "supabase" ? supabase : local;
