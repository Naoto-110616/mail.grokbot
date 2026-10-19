-- Additive. Null means inbound. Existing rows stay inbound.
alter table mail_message add column if not exists direction text;
