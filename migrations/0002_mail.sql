-- Product state for one person's mailbox on this box.
-- Message bodies live in data/ingest/, written by the bot. These tables keep
-- read, star, snooze, labels, drafts, and outbound replies. Nothing here is
-- shared across users: each person runs their own copy of the app.

create table if not exists mail_thread_state (
  thread_id text primary key,
  location text not null default 'inbox',
  labels_json text not null default '[]',
  starred boolean not null default false,
  important boolean not null default false,
  unread boolean not null default true,
  muted boolean not null default false,
  snooze_until text,
  category text not null default 'primary'
);

create table if not exists mail_hidden (
  thread_id text primary key
);

create table if not exists mail_label (
  id text primary key,
  name text not null,
  swatch text not null
);

create table if not exists mail_filter (
  id text primary key,
  spec text not null
);

create table if not exists mail_settings (
  id text primary key,
  spec text not null
);

create table if not exists mail_outbound (
  client_send_id text primary key,
  thread_id text,
  spec text not null,
  status text not null,
  created_at text not null
);

create table if not exists mail_draft (
  thread_id text primary key,
  spec text not null,
  updated_at text not null
);
