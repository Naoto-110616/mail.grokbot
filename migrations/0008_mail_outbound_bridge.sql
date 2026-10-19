-- Bot send bridge columns on the existing outbound queue.
-- A row with status waiting is queued. These columns stay null until the bot reports.

alter table mail_outbound add column if not exists provider_message_id text;
alter table mail_outbound add column if not exists error text;
alter table mail_outbound add column if not exists updated_at text;
alter table mail_outbound add column if not exists reply_to_message_id text;
alter table mail_outbound add column if not exists thread_key text;
