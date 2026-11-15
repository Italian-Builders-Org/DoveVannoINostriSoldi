-- DVNS corpus only. Do not apply assistant/boards migrations to this shared project.
create schema dvns_metadata;
create schema dvns_corpus;
revoke all on schema dvns_metadata, dvns_corpus from public, anon, authenticated;

create table dvns_metadata.snapshots (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  code_sha text not null check (code_sha ~ '^[0-9a-f]{40}$'),
  catalog_sha256 text not null check (catalog_sha256 ~ '^[0-9a-f]{64}$'),
  release_proof jsonb not null,
  imported_at timestamptz not null default now()
);
create table dvns_metadata.datasets (
  snapshot_id text not null references dvns_metadata.snapshots(id),
  id text not null,
  title text not null,
  domain text not null,
  publication text not null check (publication in ('rows','source-index','catalog-only','derived-only')),
  expected_public_rows bigint not null check (expected_public_rows >= 0),
  metadata jsonb not null,
  receipt jsonb not null,
  primary key (snapshot_id, id),
  check (publication in ('rows','source-index') or expected_public_rows = 0)
);
-- JSONB preserves the original string-valued cells, redactions and evidence.
-- Row ordinal is release-relative; opaque row IDs are not global identities.
create table dvns_corpus.rows (
  snapshot_id text not null,
  dataset_id text not null,
  ordinal bigint not null check (ordinal > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (snapshot_id, dataset_id, ordinal),
  foreign key (snapshot_id, dataset_id) references dvns_metadata.datasets(snapshot_id, id)
);
create table dvns_metadata.imports (
  snapshot_id text not null,
  dataset_id text not null,
  rows_sha256 text not null check (rows_sha256 ~ '^[0-9a-f]{64}$'),
  verified_rows bigint not null check (verified_rows > 0),
  verified_at timestamptz not null default now(),
  primary key (snapshot_id, dataset_id),
  foreign key (snapshot_id, dataset_id) references dvns_metadata.datasets(snapshot_id, id)
);
alter table dvns_metadata.snapshots enable row level security;
alter table dvns_metadata.datasets enable row level security;
alter table dvns_metadata.imports enable row level security;
alter table dvns_corpus.rows enable row level security;
revoke all on all tables in schema dvns_metadata, dvns_corpus from public, anon, authenticated;
-- No API grants, no public policies, no SECURITY DEFINER functions.
comment on schema dvns_metadata is 'Private DVNS snapshot catalog and import receipts; not an exposed Data API schema.';
comment on schema dvns_corpus is 'Private faithful corpus projection; website reader remains unchanged.';
