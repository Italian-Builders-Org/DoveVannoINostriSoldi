-- Checkpoints commit atomically with each COPY batch; never expose through Data API.
create table dvns_metadata.chunks (
  snapshot_id text not null,
  dataset_id text not null,
  chunk_index integer not null check (chunk_index >= 0),
  compressed_sha256 text not null check (compressed_sha256 ~ '^[0-9a-f]{64}$'),
  rows_count integer not null check (rows_count between 1 and 1000),
  imported_at timestamptz not null default now(),
  primary key (snapshot_id,dataset_id,chunk_index),
  foreign key (snapshot_id,dataset_id) references dvns_metadata.datasets(snapshot_id,id)
);
alter table dvns_metadata.chunks enable row level security;
revoke all on dvns_metadata.chunks from public, anon, authenticated;
