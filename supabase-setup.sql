-- Run this once in the Supabase SQL editor.
-- One row per table code; the whole game state lives in `value` as JSON text.

create table if not exists boards (
  id          text primary key,
  value       text not null,
  updated_at  timestamptz default now()
);

alter table boards enable row level security;

-- Anyone with the anon key can read and write any board.
-- That is intentional for a playtest tool: no accounts, just table codes.
-- Do NOT put anything private in here.
create policy "anon read"   on boards for select using (true);
create policy "anon insert" on boards for insert with check (true);
create policy "anon update" on boards for update using (true) with check (true);
