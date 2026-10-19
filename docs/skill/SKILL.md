# Grokbot Mail setup

## Easiest way: install the Grokbot Mail bot template

Install the [Grokbot Mail bot template](https://x.ai/bot/vHWtUqHtdpfhnwTFOfEVT). A new bot asks for your inbox, +tags, display name, and Vercel account, then deploys your own copy and wires the routines. The Deploy with Vercel button in the README is the manual path.

Use the README and `docs/bot-setup.md` for the routes. The bot delivers mail with `POST /api/ingest` and reports sends with `POST /api/outbox/<clientSendId>/status`. Both routes use `Authorization: Bearer` and the ingest token. The bot keeps that token in `~/.config/grokbot-mail/` with chmod 600 and never prints it.
