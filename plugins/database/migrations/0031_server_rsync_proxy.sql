alter table server_management_settings
  add column if not exists rsync_denied_flags jsonb not null
  default '["-e","--rsh","--rsync-path","--delete","--delete-before","--delete-after","--delete-during","--delete-delay","--delete-excluded","--delete-missing-args","--remove-source-files","--files-from","--password-file","--write-batch","--read-batch","--rsync-daemon","--daemon","--server","--sender","--config","--temp-dir","--log-file","--backup-dir","--link-dest","--copy-dest","--compare-dest","--filter","--exclude-from","--include-from"]'::jsonb;

alter table server_audit_log drop constraint if exists server_audit_log_kind_check;
alter table server_audit_log drop constraint if exists server_audit_log_check;
alter table server_audit_log add constraint server_audit_log_kind_check
  check (kind in ('command','upload','download','transfer'));
