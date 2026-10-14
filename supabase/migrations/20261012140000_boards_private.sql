-- DVNS Boards: ricette utente (non fatti). Solo service_role dal server Next.
-- Esporre lo schema `boards_private` in PostgREST (Dashboard → API → Exposed schemas).

create schema if not exists boards_private;
revoke all on schema boards_private from public, anon, authenticated;
grant usage on schema boards_private to service_role;

create table boards_private.profiles (
  user_id text primary key check (user_id ~ '^[0-9a-f-]{8,64}$'),
  email text not null check (position('@' in email) > 1),
  privacy_accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table boards_private.profiles enable row level security;
revoke all on boards_private.profiles from public, anon, authenticated;
grant select, insert, update, delete on boards_private.profiles to service_role;

create table boards_private.boards (
  id text primary key check (id ~ '^board_[a-z0-9_]+$'),
  owner_id text not null references boards_private.profiles (user_id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  category text not null default 'Generale' check (char_length(trim(category)) between 1 and 48),
  document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index boards_owner_updated_idx on boards_private.boards (owner_id, updated_at desc);
alter table boards_private.boards enable row level security;
revoke all on boards_private.boards from public, anon, authenticated;
grant select, insert, update, delete on boards_private.boards to service_role;

create table boards_private.shares (
  token text primary key check (token ~ '^[a-zA-Z0-9_-]{24,64}$'),
  board_id text not null references boards_private.boards (id) on delete cascade,
  owner_id text not null references boards_private.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index shares_board_idx on boards_private.shares (board_id) where revoked_at is null;
alter table boards_private.shares enable row level security;
revoke all on boards_private.shares from public, anon, authenticated;
grant select, insert, update, delete on boards_private.shares to service_role;
