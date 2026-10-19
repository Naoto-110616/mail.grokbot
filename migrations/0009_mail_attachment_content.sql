-- Optional attachment bytes from ingest field `content` (standard base64).
-- The app stores at most 1 MiB decoded (1048576 bytes). Null means the bytes
-- were not stored; the reader then says the file is not downloaded yet.

alter table mail_attachment add column if not exists content_b64 text;
