# Grokbot Mail

Grokbot Mail is a private mailbox for one Grok Bot. The bot delivers mail with `POST /api/ingest`. This app does not speak IMAP or SMTP. Sending a reply wakes the bot, and the message goes out only after the person approves it in Grok Bot.

Each install is its own copy. Nothing is shared between copies.

## Screenshots

Add pictures of your own mailbox here after you deploy. This template does not ship screenshots.

## Install

Use a new Vercel project that you own. The repository does not name a Vercel project, team, or deployment URL.

1. Import this Git repository into a new Vercel project. Leave the team and project on your own account. The public URL will be `https://<your-project>.vercel.app`, or a domain you attach.
2. Set the environment variables below in the Vercel project. Do not commit them.
3. Deploy. The build command is `npm run build`. `vercel.json` already sets the install command. The build applies database migrations when `DATABASE_URL` is set.

### Environment

| Variable | Role |
| --- | --- |
| `APP_PASSWORD` | Site password. With no database hash stored yet, this is the password. |
| `SESSION_SECRET` | Signs the session cookie. Sign-in stays closed until this is set. |
| `INGEST_TOKEN` | Bearer token for `POST /api/ingest` and `GET /api/ingest/state`. If it is unset, those routes return 503 and store nothing. |
| `DATABASE_URL` | Postgres connection string. Recommended on Vercel so mail survives a new instance. When it is unset, migrations skip and the app uses an in-memory database. |
| `DATABASE_URL_UNPOOLED` | Optional direct Postgres URL. Migrations prefer it over `DATABASE_URL`. |
| `SESSION_VERSION` | Optional non-negative integer. Missing or invalid values use `1`. Raise it to revoke existing cookies. |

Give the bot the deployment URL and the same `INGEST_TOKEN`. The bot recipe is `docs/skill/SKILL.md`.

Check-mail and send still wake the bot through a webhook. Put that on the server only, in `data/config.json` (gitignored):

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

The browser never receives the webhook URL or the key. An ingest `account` item replaces the address, display name, and aliases when the bot sends one.

### Self-host

Install Node.js and npm, then:

```sh
npm install
export APP_PASSWORD="replace-me"
export SESSION_SECRET="replace-me"
export INGEST_TOKEN="replace-me"
# export DATABASE_URL="postgres://user:pass@host/mail"
npm run dev
```

`npm run dev` listens on `0.0.0.0:8080`. The production build targets Vercel. `npm run build` followed by `npm run preview` serves that build on `127.0.0.1:8081`.

## Ingest API

Full item shapes and the bot recipe also live in `docs/INGEST.md` and `docs/skill/SKILL.md`.

`POST /api/ingest` and `GET /api/ingest/state` expect:

```http
Authorization: Bearer <INGEST_TOKEN>
```

The comparison is constant time. A missing or wrong token is `401` with `{ "error": "unauthorized" }`. An unset or blank `INGEST_TOKEN` is `503` with `{ "error": "unavailable" }`, before the body is read and before the database is opened. These paths are outside the site-password cookie.

### `POST /api/ingest`

The body is JSON:

```json
{ "items": [] }
```

At most 200 items and 5MB. A larger body is `413` with `{ "error": "too large" }`. Invalid JSON, or a body that is not an object with an `items` array, is `400` with `{ "error": "invalid" }`. The wrong method is `405`.

A successful write is:

```json
{ "accepted": 0, "skipped": 0 }
```

`accepted` is how many items were stored. `skipped` counts items that were not stored. Unknown or invalid items are skipped. A `thread` item is always skipped. An attachment whose `path` is absolute, contains `..`, or contains a NUL byte is skipped. An empty path is kept as metadata with no file. A write failure is `503` with `{ "error": "unavailable" }`. The app does not log the body or the token.

`kind` is one of `account`, `thread`, `message`, `attachment`, or `send-result`.

**account.** The latest valid account wins. Fields: `address`, `displayName`, `aliases` (each alias has `email`, `tag`, and `name`).

**thread.** Hint only. Fields: `id`, `messageIds`. It is not stored and does not decide which messages share a thread.

**message.** Stored fields: `id`, `messageId`, `inReplyTo`, `references`, `deliveredTo`, `account`, `from`, `to`, `cc`, `bcc`, `subject`, `body` (or `text`), `date`, `unread`, `attachments`, `clientSendId`, `threadHint`, `direction`. `html` is ignored. `from` is required. `id` or `messageId` is required. Addresses are `{ "name", "email" }` or a string. Attachment objects on the message are `{ "id", "filename", "mime", "bytes", "path" }`. Bytes stay with the bot.

`date` is ISO-8601. Omitted `unread` defaults to true, and `unread` is written only on insert. Posting the same `id` or `messageId` again updates the content and leaves `unread` as stored. Omitted `threadHint` and `direction` on an update keep the stored values. Star, snooze, labels, folder, and trash are not changed by ingest.

`direction` is `inbound` or `outbound`. Any other value is stored as empty. For display, a missing direction is inbound unless `from` is the account address, which is treated as outbound. Outbound mail is shown as sent by the mailbox owner and listed in Sent.

Messages group by `threadHint` first. A missing or empty hint falls back to In-Reply-To and References, then one normalized subject.

**attachment.** Metadata for a file sent apart from the message. Fields: `id`, `messageId`, `filename`, `mime`, `bytes`, `path`. `filename` is required. The path is a relative location the bot keeps.

**send-result.** Outcome of a reply. Fields: `clientSendId` (required), `status`, `replyToMessageId`, `sentMessageId`, `error`. `pending` and `waiting` leave the thread on "Waiting for approval in Grok Bot". `failed`, `rejected`, and `error` mark it failed. Any other status, including `sent` and `approved`, marks it sent. Do not post a send-result only because a draft was created.

Example:

```json
{
  "items": [
    {
      "kind": "account",
      "address": "you@example.test",
      "displayName": "You",
      "aliases": [{ "email": "you@example.test", "tag": null, "name": "You" }]
    },
    {
      "kind": "message",
      "id": "msg_a",
      "messageId": "<a@example.test>",
      "inReplyTo": null,
      "references": [],
      "deliveredTo": "you@example.test",
      "account": "primary",
      "from": { "name": "Ada", "email": "ada@example.test" },
      "to": [{ "name": "You", "email": "you@example.test" }],
      "cc": [],
      "bcc": [],
      "subject": "Quarterly notes",
      "threadHint": "batch-1",
      "direction": "inbound",
      "body": "Notes for the quarter.",
      "date": "2026-10-01T15:00:00Z",
      "unread": true,
      "attachments": []
    }
  ]
}
```

### `GET /api/ingest/state`

Same bearer token. The response is the newest stored message date and the row counts:

```json
{
  "newest": "2026-10-01T15:00:00Z",
  "counts": { "messages": 1, "attachments": 1, "accounts": 1, "sendResults": 1 }
}
```

`newest` is `null` when no message date parses. Use it as the cursor for the next sync. The wrong method is `405`.

## Security

This template ships no keys. There is no database URL, ingest token, site password, session secret, or Vercel project id in the tracked tree. Set those in the host environment. `.env` and `.env.*` are gitignored. Do not commit them, and do not commit a `.vercel/` directory.
