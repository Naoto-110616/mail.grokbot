# Grokbot Mail setup

The setup skill is coming next. It is not in this repo yet.

Until that skill lands, use the README and `docs/bot-setup.md`. The bot delivers mail with `POST /api/ingest` and reports sends with `POST /api/outbox/<clientSendId>/status`. Both routes use `Authorization: Bearer` and the ingest token. The bot keeps that token in `~/.config/grokbot-mail/` with chmod 600 and never prints it.
