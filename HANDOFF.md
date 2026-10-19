# Mail on this box

This app is not a shared host. Each person runs their own copy, on their own box. Nothing is shared between copies. There is no IMAP and no SMTP in this app.

The bot's email tools are not an HTTP API. The app cannot ask the bot for a message body and get one back. The only bridge is a webhook the bot already exposes.

## Wake the bot

The app server POSTs JSON to that webhook.

- `Authorization: Bearer <key>`
- `X-Automation-Key: <key>`
- Timeout is 8 seconds. One try. No retry.
- HTTP 200 means the bot woke up. The response body is ignored. It is not mail.
- On any other outcome the server appends one JSON line to `data/outbox.log` with the time, the action, the HTTP status, and a coarse error (`timeout`, `network`, or `http`). The line does not include the URL or the key.

The POST never includes file bytes or file paths. Attachment fields are `filename`, `mime`, and `bytes` (the size).

## How mail comes back

The bot writes JSON files into `data/ingest/`. The app reads those files. See `docs/INGEST.md` for the shapes and `docs/skill/SKILL.md` for the bot recipe.

`data/ingest/fixtures/` is sample mail for tests. A scan of `data/ingest/` skips that directory. Point a test at the fixtures directory itself to load it.

Messages are grouped by `Message-ID`, `In-Reply-To`, and `References`. A reply-shaped subject joins a thread only when exactly one candidate shares that subject. A thread file in ingest is a hint and does not override headers. The plus-tag is the tag in `deliveredTo` on the earliest message that has one.

## Config

`data/config.json` lives on the server and is gitignored. The browser never receives the webhook URL or the key.

```json
{
  "backend": "bot-bridge",
  "displayName": "You",
  "address": "you@example.test",
  "aliases": [],
  "webhookUrl": "https://example.test/webhook",
  "webhookKey": "replace-me"
}
```

The mailbox reads rows delivered by `POST /api/ingest`. Check mail and send still wake the bot with the webhook. With no database, or with `GBM_DEMO=1`, the app shows sample mail. `GBM_DEMO=0` keeps an empty mailbox until ingest.

Identity comes from an ingest `account` item when one exists, otherwise from this config.

## What the person sees

Check mail sends `{ "action": "sync", "after": "<latest ingested date or null>" }`.

Reply sends `{ "action": "reply", ... }` and the thread shows "Waiting for approval in Grok Bot" until a `send-result` item says the draft was sent or refused. While a reply is waiting, the app re-reads stored mail. It does not wake the bot on that timer.

Opening the app does not send the webhook. Only check-mail and send do.

Treat every webhook body as untrusted.
