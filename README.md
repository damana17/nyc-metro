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

## Deploy (GitHub Pages)

Every push to `main` builds and publishes to **https://damana17.github.io/nyc-metro/** via `.github/workflows/pages.yml`.

For multiplayer, add two repository **Variables** (Settings → Secrets and variables → Actions → Variables tab): `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Vite bakes them in at build time, so re-run the workflow (Actions → Deploy to GitHub Pages → Run workflow) after setting them. The anon key is public by design; it ends up in the page either way.

`netlify.toml` is still here if you ever move it to Netlify.

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

`src/lib/sync.js` (`useTable`) keeps one shared state per table. A move is a function over the state; moves are queued and saved with a **conditional write** ("only if the table is still at v41"). If another player saved first, the write is refused, the table is re-read and the same moves are replayed on top, so simultaneous moves are both kept. With Supabase, changes arrive over Realtime; a 5-second poll is the fallback.

- **Invite link:** `?t=<code>` joins a table (`&g=contracts` for V1). The last table and your seat are remembered in this browser.
- **Seat:** joining asks which player you are; the log records moves under that name.
- **Changes since your last move** are outlined on the board and marked in the Latest strip and Log.
- **Undo my move** takes back only your own last save, and asks first if others have moved since.
- **Tally** ranks players by cash plus shares at current price (shown automatically once the round limit passes).

---

## Known gaps

- **Merges are prompted, not forced.** When two lines meet and both have enough stations (Tuning: 4 by default; safe from 8), the turn panel shows the merge with each player's payout and a Merge now button. Nothing merges until someone presses it. The rule lives in `pendingMerges`/`applyMerge` in `src/lib/game.jsx` and is cross-checked against the simulator.
- **Hands are not hidden.** Everyone sees the seated player's discs.
- **End-of-game scoring is cash + shares only.** Merger bonuses are not included in the tally.
- **V1 is frozen.** It reflects the earlier design and hasn't been updated since the direction changed.
