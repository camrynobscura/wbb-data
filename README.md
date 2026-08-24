# wnba-data

The data layer behind **WNBA Arc** — it collects WNBA player histories, computes advanced
stats from the box score, stores everything in Postgres, and serves it over a small
read-only API.

**Live API:** [`https://wnba-data-api.onrender.com`](https://wnba-data-api.onrender.com) — Express
on Render's free tier over Postgres on Supabase, kept warm by a 5-minute uptime ping. Hardened with
`helmet`, per-IP rate limiting, connection-pool timeouts, and strict CORS to the frontend origin.

## What it does

- **Ingests** player season histories from ESPN's stats data — identity, per-season box-score
  totals, minutes, and team history.
- **Derives** efficiency and role stats from the raw box score: true shooting %, effective
  FG%, turnover %, 3-point-attempt rate, and free-throw rate (as Postgres *generated columns*,
  so they can't drift from their inputs), plus usage % and assist % computed from team totals.
- **Aggregates** per-year league averages and schedule lengths — used downstream as baselines
  and as the small-sample denominator.
- **Serves** it through a read-only Express API that returns the frontend's shape.

## Architecture

```
ESPN JSON  →  scraper / adapter  →  Postgres (Supabase)  →  read-only Express API  →  WNBA Arc
```

The query and shaping logic is framework-agnostic (plain functions over a `pg` pool), so the
HTTP layer is a thin wrapper and the database stays a private implementation detail behind the
API. The API's JSON contract is the only cross-repo boundary.

## Data model

One row per player-season is the core grain. Highlights:

- **Stable identity** — a surrogate primary key plus ESPN's id as an external key. Never keyed
  on name (last names collide).
- **Era-accurate team names** — franchise identity is kept separate from naming eras, so a
  historical season shows the team's name *at the time* (e.g. San Antonio Stars, not Las Vegas
  Aces) via a year-range join.
- **Trades** — a canonical season total row, with per-team stints preserved separately.
- **Missed seasons** are inferred from year gaps at read time, never stored as synthetic rows.
- **Small-sample seasons** are flagged by games played against that year's schedule.
- Counting stats are stored as integer season totals (exact); rates and derived stats as
  `numeric` (never float, to avoid rounding drift).

## API

Read-only, JSON:

| Endpoint | Returns |
| --- | --- |
| `GET /players` | the player list (id, name, team, position) |
| `GET /players/:id` | one player + full regular-season history |
| `GET /league` | per-year league averages + schedule lengths |

## Stack

- **Node + TypeScript**
- **Express 5** read API, **raw `pg`** (explicit SQL, no ORM)
- **Postgres on Supabase**
- **Vitest** for the derived-stat and parsing unit tests

## Running locally

Requires Node 20+ and a Postgres database.

```bash
npm install
cp .env.example .env                 # set DATABASE_URL to your Postgres connection string

npm run migrate                      # create / upgrade the schema (migrations/)
npx tsx scripts/scrape.ts            # discover + ingest players and seasons from ESPN
npx tsx scripts/seed-team-eras.ts    # era-accurate team names
npx tsx scripts/backfill-roles.ts    # 2nd pass: minutes + usage% / assist%
npx tsx scripts/compute-league.ts    # per-year league averages

npm run serve                        # read API on http://localhost:3001
```

Other scripts:

```bash
npm test           # unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run serve:watch
```

## Data source & scope

Player stats come from ESPN's public stats endpoints. Efficiency stats are computed from
box-score totals rather than trusting precomputed values, so they stay internally consistent.
A few stats are intentionally left out because they can't be sourced reliably: rebound
percentages need opponent data ESPN doesn't publish, and all-in-one impact metrics (PER, Win
Shares, BPM, VORP) can't be derived from a box score. Scraped data is treated as a runtime
artifact and kept out of version control.
