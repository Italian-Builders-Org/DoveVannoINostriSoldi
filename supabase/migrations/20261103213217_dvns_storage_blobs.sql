-- Content-addressed private archive; original files may span several small objects.
create table dvns_snapshots.blobs (
  source_sha256 text primary key check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_bytes bigint not null check (source_bytes >= 0),
  bucket text not null check (bucket = 'dvns-snapshots'),
  parts jsonb not null check (jsonb_typeof(parts) = 'array'),
  verified_at timestamptz not null default now()
);
alter table dvns_snapshots.blobs enable row level security;
revoke all on dvns_snapshots.blobs from public, anon, authenticated;
comment on table dvns_snapshots.blobs is 'Ordered parts verified by downloading bytes from a private bucket. Not an independent backup or WORM guarantee.';
