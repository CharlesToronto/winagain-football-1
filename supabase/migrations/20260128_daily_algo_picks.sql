create table if not exists public.daily_algo_picks (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  fixture_id bigint not null,
  fixture_date_utc timestamptz null,
  league_id bigint null,
  season int null,
  competition_name text null,
  team_id bigint null,
  side text null,
  pick text null,
  market text null,
  probability numeric null,
  hit_rate numeric null,
  coverage numeric null,
  picks_count int null,
  evaluated_count int null,
  odd numeric null,
  odds_bookmaker_id int null,
  meets_algo_criteria boolean null,
  meets_odds boolean null,
  meets_criteria boolean null,
  status text default 'pending',
  hit boolean null,
  goals_home int null,
  goals_away int null,
  home_id bigint null,
  away_id bigint null,
  home_name text null,
  away_name text null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  resolved_at timestamptz null
);

create unique index if not exists daily_algo_picks_unique
  on public.daily_algo_picks (snapshot_date, fixture_id, team_id, pick);

alter table public.daily_algo_picks enable row level security;

create policy "daily_algo_picks_read"
  on public.daily_algo_picks
  for select
  using (true);

create policy "daily_algo_picks_insert"
  on public.daily_algo_picks
  for insert
  with check (true);

create policy "daily_algo_picks_update"
  on public.daily_algo_picks
  for update
  using (true);
