-- Versioned document snapshots supplement, but must not be summed with, corpus facts.
create schema dvns_snapshots;
revoke all on schema dvns_snapshots from public, anon, authenticated;
create table dvns_snapshots.registries (
  code_sha text primary key check (code_sha ~ '^[0-9a-f]{40}$'),
  registry_sha256 text not null check (registry_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null
);
create table dvns_snapshots.files (
  code_sha text not null references dvns_snapshots.registries(code_sha),
  path text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_bytes bigint not null check (source_bytes >= 0),
  group_ids text[] not null,
  disposition text not null check (disposition in ('json-document','corpus-chunk','manifest-only')),
  primary key (code_sha,path)
);
create table dvns_snapshots.documents (
  code_sha text not null,
  path text not null,
  payload jsonb not null,
  verified_at timestamptz not null default now(),
  primary key (code_sha,path),
  foreign key (code_sha,path) references dvns_snapshots.files(code_sha,path)
);
alter table dvns_snapshots.registries enable row level security;
alter table dvns_snapshots.files enable row level security;
alter table dvns_snapshots.documents enable row level security;
revoke all on all tables in schema dvns_snapshots from public, anon, authenticated;
comment on table dvns_snapshots.files is 'All generated files are inventoried. manifest-only means bytes are not stored in this database.';
comment on table dvns_snapshots.documents is 'Original JSON document values; not additional additive facts. Precision verified with Decimal readback.';
