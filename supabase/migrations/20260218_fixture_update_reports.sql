create table if not exists public.app_fixture_update_reports (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  source text not null,
  status text not null default 'success',
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  duration_ms integer not null default 0,
  payload jsonb null,
  error text null,
  created_at timestamptz not null default now()
);

create index if not exists app_fixture_update_reports_created_idx
  on public.app_fixture_update_reports (created_at desc);

create index if not exists app_fixture_update_reports_job_created_idx
  on public.app_fixture_update_reports (job_name, created_at desc);

create index if not exists app_fixture_update_reports_status_created_idx
  on public.app_fixture_update_reports (status, created_at desc);

alter table public.app_fixture_update_reports enable row level security;

create policy "app_fixture_update_reports_read"
  on public.app_fixture_update_reports
  for select
  using (true);

create policy "app_fixture_update_reports_insert"
  on public.app_fixture_update_reports
  for insert
  with check (true);
