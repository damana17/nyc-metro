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

## Playtest features

- **Starting cash by seat**: with 4 or more players each later seat starts with $10 more ($60/$70/$80/$90). In simulation that took the 4th seat from 7% of wins to 26%. With 3 players everyone starts with $60, because the same bonus there overshoots. Adding the 4th investor before anyone has bought a share re-deals the cash.
- **Turn order** (Tuning): rotate (default: the start player moves one seat left each round), snake, or fixed. With **1 share per turn** (default) this was the fairest combination in simulation once merges were in: 37 / 30 / 34 win rate by seat at 3 players. At 4 players the last seat is still weak.
- **Score**: the Tally is the final score. Shares count at their **base price** (without the per-sale step, which used to let you score by buying anything), plus **end-of-game holder bonuses** on every line still running, plus **secret routes**.
- **Merge watch**: the Lines table shows who leads each line (majority / minority), a SAFE IN n tag as a line nears the safe size, and ⚡ marks hexes where one more track would make two lines touch.
- **Landmark goals**: three public goals (the first line to link two landmarks pays $30 to the player who completed it and raises that line's base price by $5) and two secret routes per player ($30 each at the end). Pick a seat to see yours. Rivals' routes are hidden on screen but are in the shared game state: honour system.
- **City events deck** (Tuning, on by default): one card per round, shown in the turn panel with the next card beneath it. Fifteen cards: a quiet year (3), the IRT opens (2: stations cost 1 disc less), ridership boom (2: Midtown lines pay $1 more a share), transit strike (2: one line pays nothing), the Great Depression (dividends halved), Robert Moses (no new Queens stations for two rounds), the 1975 fiscal crisis (base prices -$5), a bond issue (+$20 each), city expansion (everyone draws 2) and a station fire (the biggest line loses a station). In simulation it kept games open later (the eventual winner led at round 10 in 61% of games, against 67% without). Games saved before this update get the deck from Tuning → Reset to recommended defaults.
- **Game record**: ⋯ → Download game record saves every move and the board each turn. Put the files in one folder and run `node sim/.build/replay.mjs <folder>` (after bundling, see `sim/`) to compare the table's play with the bots'.

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
