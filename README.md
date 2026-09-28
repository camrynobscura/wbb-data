# wnba-data

The data service behind **[WNBA Arc](https://github.com/camrynobscura/wnba-arc)**. It ingests every
WNBA player's season history from ESPN, stores it in Postgres, computes league and position
averages, spreads and ranks, and serves them through a small read-only Express API.

**The architecture, schema, ranking rules and daily refresh are written up in the
[WNBA Arc README](https://github.com/camrynobscura/wnba-arc#architecture).** This page covers the code
layout and how to run it.

**Live API:** [`https://wnba-data-api.onrender.com`](https://wnba-data-api.onrender.com)

## Layout

| Path | What's there |
| --- | --- |
| `src/espn/` | The ESPN client (retries with backoff, its own User-Agent) and the parsers, unit-tested |
| `src/db/` | Ingest and upserts, league and position averages, each team's games per season, the run audit |
| `src/stats/` | Usage % and assist %, computed from team totals |
| `src/api/` | The Express server and its SQL queries |
| `src/notify/` | Change alerts for the daily refresh (Telegram or Discord) |
| `scripts/` | Command-line entry points for everything below |
| `migrations/` | Plain SQL, applied in order by `npm run migrate` |
| `.github/workflows/nightly-refresh.yml` | The daily refresh (GitHub Actions) |

## Running locally

Requires Node 20+ and a Postgres database.

```bash
npm install
cp .env.example .env                  # set DATABASE_URL to your Postgres connection string

npm run migrate                       # create or upgrade the schema
npx tsx scripts/scrape.ts --all       # every player since 1997 (no flag: the last 3 seasons)
npx tsx scripts/backfill-roles.ts     # minutes, usage % and assist %
npx tsx scripts/seed-team-eras.ts     # era-accurate team names
npx tsx scripts/compute-league.ts     # league averages, from season lengths
npx tsx scripts/fill-team-games.ts    # each team's games per season
npx tsx scripts/compute-league.ts     # again, now counting each team's own games
npx tsx scripts/compute-positions.ts  # position averages

npm run serve                         # the API on http://localhost:3001
```

The daily job is `npx tsx scripts/refresh-current.ts`: the current season only, since past seasons
never change. Every write is an idempotent upsert, so any script can be rerun safely.

```bash
npm test            # unit tests (58)
npm run typecheck   # tsc --noEmit
npm run serve:watch # the API, restarting on change
```

## Environment

| Variable | Used by | |
| --- | --- | --- |
| `DATABASE_URL` | everything | Required. A Postgres connection string. |
| `TELEGRAM_URL`, `DISCORD_WEBHOOK_URL` | the daily refresh | Optional. Where change alerts go; without either, alerts are only logged. |
| `CORS_ORIGIN` | the API | Production only: the frontend's origin. Unset, any localhost port is allowed. |
| `PORT` | the API | Defaults to 3001. |

Scraped data is a runtime artifact and is never committed. Stats come from ESPN's public stats
endpoints.
