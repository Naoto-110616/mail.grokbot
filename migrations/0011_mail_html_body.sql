-- Optional HTML from the ingest field `html`, stored as mail_message.html_body.
-- At most 1 MiB (1048576 UTF-8 bytes) per message. Over that cap the message
-- is still stored and this column is left unchanged. Null means no HTML;
-- the reader uses the plain body.

alter table mail_message add column if not exists html_body text;
