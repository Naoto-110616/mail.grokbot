-- Mail the bot delivers through POST /api/ingest.
-- Bodies and attachment metadata live here. File bytes stay with the bot.

create table if not exists mail_account (
  id text primary key,
  address text not null,
  display_name text not null,
  aliases_json text not null,
  updated_at text not null
);

create table if not exists mail_message (
  id text primary key,
  message_id text,
  in_reply_to text,
  references_json text not null default '[]',
  delivered_to text,
  account text not null default 'primary',
  from_json text not null,
  to_json text not null default '[]',
  cc_json text not null default '[]',
  bcc_json text not null default '[]',
  subject text not null default '',
  body text not null default '',
  date text not null,
  unread boolean not null default true,
  attachments_json text not null default '[]',
  client_send_id text
);

create unique index if not exists mail_message_message_id_uidx
  on mail_message (message_id)
  where message_id is not null;

create table if not exists mail_attachment (
  id text not null,
  message_ref text not null default '',
  filename text not null,
  mime text not null,
  bytes integer not null default 0,
  path text not null default '',
  primary key (id, message_ref)
);

create table if not exists mail_send_result (
  client_send_id text primary key,
  status text not null,
  reply_to_message_id text,
  sent_message_id text,
  error text
);
