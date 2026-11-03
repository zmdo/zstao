-- Per-bucket regular expressions, one per line, for files skipped during zip
-- batch uploads. Existing buckets start with the macOS metadata defaults.
alter table cos_buckets add column if not exists archive_exclude text not null default '';

update cos_buckets
set archive_exclude = E'(^|/)__MACOSX/\n(^|/)\\.DS_Store$\n(^|/)\\._[^/]*$'
where archive_exclude = '';
