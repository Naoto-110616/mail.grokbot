-- When the person marked a thread done. Null means the archive location
-- came from somewhere else (for example a thread that is only outbound).
alter table mail_thread_state add column if not exists done_at text;
