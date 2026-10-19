-- Additive. Existing rows stay null and keep header, then subject, grouping.
alter table mail_message add column if not exists thread_hint text;
