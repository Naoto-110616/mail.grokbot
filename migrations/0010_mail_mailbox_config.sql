-- Webhook connection for this mailbox.
-- The sender key stays in this row. It is not part of mail_settings,
-- and the server does not return it to the browser.

create table if not exists mail_mailbox_config (
  id text primary key,
  spec text not null
);

-- Wake attempts. next_attempt_at is an ISO timestamp, or null when nothing is scheduled.
alter table mail_outbound add column if not exists attempt_count integer not null default 0;
alter table mail_outbound add column if not exists next_attempt_at text;
alter table mail_outbound add column if not exists last_error text;
