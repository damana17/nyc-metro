# NYC Metro — playtest board

A digital playtest tool for NYC Metro, a hex-map subway game by Andrew Daman and Ken Kuhn.

Two designs live side by side behind a toggle at the top of the page:

- **V1 · Contracts** — players are corporations. Contract market, player charters, cars and ridership, share ladder.
- **V2 · Influence** — players are investors. Seven neutral lines, influence discs, stations, zones, dividends.

It is deliberately a **sandbox, not a rules engine**. By default nothing is enforced: place any track anywhere, put stations where you like, add and remove discs and cash by hand. A "enforce rules" toggle turns the full rules engine on when you want to test with it.

---

## Run it locally

```bash
npm install
npm run dev
```

Open the URL it prints. That's it — it works immediately with no configuration.

## Multiplayer

Out of the box the app stores game state in `localStorage`, which means a "table" is shared only between tabs on the same machine. Good enough for development, useless for playing with someone else.

For real multiplayer you need a shared store. The app talks to one through a single small adapter (`src/lib/storage.js`), so swapping backends means rewriting that one file.

**Supabase** is wired up already and has a free tier that is enormously more than this needs:

1. Create a project at supabase.com.
2. Open the SQL editor and run `supabase-setup.sql` from this repo.
3. Copy `.env.example` to `.env` and fill in your project URL and anon key.
4. Restart `npm run dev`.

Now any two browsers that join the same **table code** share a board.

> The Supabase policy in `supabase-setup.sql` lets anyone with the anon key read and write any board. That is intentional — no accounts, just table codes. Don't put anything private in there.

## Deploy to Netlify

`netlify.toml` is included and configured. Connect the repo, and Netlify will run `npm run build` and publish `dist`. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Site settings → Environment variables** — Vite inlines them at build time, so you must redeploy after changing them.

---

## How it's laid out

```
src/
  App.jsx                     the version toggle and page shell
  lib/
    game.jsx                  board data, hex geometry, pure game helpers,
                              the sync hook, shared UI atoms
    storage.js                the only file that knows about a backend
  components/
    GameContracts.jsx         V1
    GameInfluence.jsx         V2
```

`game.jsx` is the shared module: the digitised map (hexes, rivers, no-cross edges, 15 named zones), pointy-top hex maths, and the pure functions both games use — line networks, link counting, station costs, share prices.

### The map

Pointy-top hexes in odd-r offset, 13 columns by 14 rows, traced from the physical board. Rivers and no-crossing edges sit on hex edges. Zones were derived geographically: rivers act as walls and a flood fill separates the real landmasses, then each borough is subdivided along its own long axis.

### Sync

`useRoom` in `game.jsx` polls the store every two seconds and pushes on every change, with last-write-wins. Each version namespaces its own key, so a V1 table and a V2 table with the same code don't collide. The Sync bar at the top of V2 reports what the layer is actually doing — read and write counts, the version in the shared table, and the last error verbatim.

---

## Known gaps

- **The merge is not implemented.** Simulation settled on a threshold of four stations on both lines, the line with more stations acquiring, and Acquire-style majority/minority bonuses at roughly 5×/2× share price. None of that is coded — there's a manual merge control that moves track, stations and shares across, and no payout.
- **Hands are not hidden.** Everyone sees the seated player's discs. V2's design calls for hidden hands, which needs a backend that can hold per-player secret state.
- **No end-of-game scoring.** The round limit shows GAME OVER but doesn't stop play or total anything.
- **V1 is frozen.** It reflects the earlier design and hasn't been updated since the direction changed.
