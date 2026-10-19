# Mail on this box

Each person runs their own copy. Nothing is shared between copies. This app does not speak IMAP or SMTP.

The bot delivers mail with `POST /api/ingest` and reads sends with `GET /api/outbox`. Shapes and the send bridge are in the README, `docs/INGEST.md`, and `docs/bot-setup.md`.

The setup skill is coming next. It is not in this repo yet.
