-- One row for this copy of the site.
-- password_hash is a scrypt string. Once it is set, it replaces APP_PASSWORD.
-- session_version increments whenever the password changes, so older cookies stop working.

create table if not exists site_security (
  id text primary key,
  password_hash text,
  session_version integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into site_security (id, password_hash, session_version)
values ('site', null, 0)
on conflict (id) do nothing;
