-- Optional per-bucket limit for zip batch uploads (compressed size and total
-- uncompressed size). Defaults to 1 GiB.
alter table cos_buckets add column if not exists max_archive_bytes bigint not null default 1073741824;
