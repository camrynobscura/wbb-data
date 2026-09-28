-- 009 — the views read with the permissions of whoever queries them, not their owner's.
-- By default a view runs as its owner (postgres here), and the owner bypasses row-level security —
-- so any role allowed to SELECT a view reads around the RLS on the tables under it. On Supabase,
-- whose built-in API roles (anon, authenticated) are granted everything by default, anon saw 0
-- rows of `players` but 1,218 through player_current_team and 4,923 through
-- player_season_team_games (measured 2026-09-28; security review S8). With security_invoker the
-- tables' own permissions and RLS apply to the caller. Nothing we run changes: the API and the
-- scripts connect as the tables' owner. Needs Postgres 15+.

ALTER VIEW player_current_team SET (security_invoker = true);
ALTER VIEW player_season_team_games SET (security_invoker = true);
