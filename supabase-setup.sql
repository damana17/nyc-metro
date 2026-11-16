-- Run this once in the Supabase SQL editor (Database > SQL Editor > New query > paste > Run).
-- One row per table code; the whole game state lives in `value` as JSON text.
-- `v` is the version number every save checks, so two players moving at once can't overwrite each other.

create table if not exists boards (
  id          text primary key,
  value       text not null,
  v           bigint not null default 0,
  updated_at  timestamptz default now()
);
alter table boards add column if not exists v bigint not null default 0;

alter table boards enable row level security;

-- Anyone with the anon key can read and write any board.
-- That is intentional for a playtest tool: no accounts, just table codes.
-- Do NOT put anything private in here.
drop policy if exists "anon read"   on boards;
drop policy if exists "anon insert" on boards;
drop policy if exists "anon update" on boards;
create policy "anon read"   on boards for select using (true);
create policy "anon insert" on boards for insert with check (true);
create policy "anon update" on boards for update using (true) with check (true);

-- Push changes to open browsers instantly (Realtime) instead of waiting for the next poll.
do $$ begin
  alter publication supabase_realtime add table boards;
exception when duplicate_object then null; end $$;
