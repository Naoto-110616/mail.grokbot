# Grokbot Mail

Grokbot Mail is a mailbox screen for one person and one bot. The bot delivers mail with `POST /api/ingest`. This app does not speak IMAP or SMTP. A send is stored, then the app wakes the bot. The message goes out only after the person approves it there.

With no `DATABASE_URL`, or with `GBM_DEMO=1`, the app shows invented mail at `you@example.com`. Nothing in that mailbox was sent or received. Set `GBM_DEMO=0` to use a database instead (embedded PGLite when `DATABASE_URL` is unset). A site password still locks the sample inbox.

## Deploy on Vercel with Neon

Neon is required for real mail. Without a Neon database, the app shows sample mail only.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FPhillipHolland%2Fmail.grokbot&env=GBM_SITE_PASSWORD,GBM_SESSION_SECRET,GBM_INGEST_TOKEN,GBM_INBOX_ADDRESS,GBM_OWNER_NAME,GBM_TAGS&envDescription=GBM_SITE_PASSWORD%20locks%20the%20site.%20GBM_SESSION_SECRET%20signs%20the%20session%20cookie.%20GBM_INGEST_TOKEN%20is%20the%20bearer%20token%20for%20ingest%20and%20the%20outbox.%20GBM_INBOX_ADDRESS%20is%20the%20mailbox%20address.%20GBM_OWNER_NAME%20is%20the%20name%20on%20sent%20mail.%20GBM_TAGS%20lists%20plus-tags%20such%20as%20ops%2Cbooks%3AReading.&envLink=https%3A%2F%2Fgithub.com%2FPhillipHolland%2Fmail.grokbot%23deploy-on-vercel-with-neon&project-name=grokbot-mail&repository-name=grokbot-mail&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%7D%5D)

The button clones this repo and asks for these variables. It also adds Neon. Neon sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct). Migrations prefer the direct string. Do not commit either string. Skipping Neon leaves the deployed app on sample mail only.

| Variable             | Description                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| `GBM_SITE_PASSWORD`  | Password that locks the mailbox.                                                   |
| `GBM_SESSION_SECRET` | Secret that signs the session cookie.                                              |
| `GBM_INGEST_TOKEN`   | Bearer token for ingest and the outbox routes.                                    |
| `GBM_INBOX_ADDRESS`  | Mailbox address, such as `you@example.com`.                                        |
| `GBM_OWNER_NAME`     | Name shown for that mailbox.                                                       |
| `GBM_TAGS`           | Plus-tags, comma-separated. A label may follow a colon, as in `ops,books:Reading`. |

To deploy without the button:

1. Import this repo into a Vercel project you own.
2. Create a Neon Postgres database. Put its pooled connection string in `DATABASE_URL`. Put the direct string in `DATABASE_URL_UNPOOLED` so migrations can run. The provider includes the credentials in that string. Do not commit it.
3. Set the variables above in the Vercel project. Names and placeholders are in `.env.example`.
4. The build command is `npm run build`. Migrations run during the build when `DATABASE_URL` is set.

Leave `GBM_DEMO` unset on a real mailbox. `GBM_DEMO=1` replaces it with the sample inbox and does not write to Postgres.

## Environment

Older names still work. When both are set, the `GBM_` name wins.

| Variable                                          | Role                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GBM_SITE_PASSWORD` or `APP_PASSWORD`             | Site password. Unset, in demo mode, leaves the sample inbox open.                                                        |
| `GBM_SESSION_SECRET` or `SESSION_SECRET`          | Signs the session cookie. Required once a password is set.                                                               |
| `GBM_INGEST_TOKEN` or `INGEST_TOKEN`              | Bearer token for ingest and the bot outbox routes. Unset returns 503 and stores nothing.                                 |
| `DATABASE_URL`                                    | Postgres connection string. Unset, and `GBM_DEMO` unset, selects sample mail.                                            |
| `DATABASE_URL_UNPOOLED`                           | Optional direct Postgres URL. Migrations prefer it.                                                                      |
| `SESSION_VERSION`                                 | Optional non-negative integer. Missing or invalid values use `1`. Raise it to revoke cookies.                            |
| `GBM_OWNER_NAME`, `GBM_INBOX_ADDRESS`, `GBM_TAGS` | Optional identity. Unset keeps the account the bot ingests, then the neutral default. `GBM_TAGS` is `ops,books:Reading`. |
| `GBM_DEMO`                                        | `1` forces sample mail even when `DATABASE_URL` is set. `0` uses the database.                                           |

The default signature is the display name and address from that identity. Webhook URL and key are saved in Settings, not in env. The key is write-only.

Bot scripts also read `GBM_APP_ORIGIN`, `GBM_INGEST_URL`, `GBM_INGEST_PATH`, and `GBM_INGEST_FILE`. The token stays in the environment and is never written to a file.

### Self-host

Install Node.js and npm, then:

```sh
npm install
npm run dev
```

`npm run dev` listens on `0.0.0.0:8080`. With no database URL this is sample mail. For a local database, set `GBM_DEMO=0`.

```sh
npm run build
npm run preview
```

`npm run preview` serves the production build on `127.0.0.1:8081`.

## Bot

The app exposes ingest and the outbox. The bot speaks to the mail provider. Shapes are in `docs/INGEST.md` and `docs/bot-setup.md`. The setup skill is coming next. `docs/skill/SKILL.md` is only a draft recipe.

**Ingest.** `POST /api/ingest` with `Authorization: Bearer` and the ingest token. The body is `{ "items": [] }`, at most 200 items and 5 MB. `html` is a string, at most 1 MiB (1,048,576 UTF-8 bytes). `attachments[].content` is standard base64, at most 1 MiB decoded, and it is kept only when the attachment id matches. `headers` may be a `{ "name", "value" }` list. `GET /api/ingest/state` returns `{ "newest", "counts" }`. These routes are outside the site-password cookie. A wrong token is 401. An unset token is 503.

**Outbox webhook.** On send, the app POSTs `{ "action": "send", "clientSendId" }` to the webhook saved in Settings. That body has no subject and no message text. The bot reads `GET /api/outbox?status=queued` and reports what happened with `POST /api/outbox/:id/status`. Check mail POSTs `{ "action": "sync", "after" }`. A wake that does not return HTTP 200 is retried after 0s, 30s, 2m, 10m, and 1h, on the next request that loads the mailbox or calls ingest or outbox. The app has no cron.

**Live delivery.** The bot should listen for new mail and `POST` it to ingest as it arrives. The app does not open that listener.

**Daily catch-up.** The bot should sweep once a day for mail the live listener missed, then `POST` it to ingest. The app does not run that sweep. The sample outbox row is not listed by `GET /api/outbox` and is not delivered.

```sh
node bot/convert-ingest.mjs message.eml > items.json
node bot/push-ingest.mjs items.json
```

`convert-ingest.mjs` reads a raw message or JSON and writes ingest items. It keeps `deliveredTo` and `account` on each message, including a `Delivered-To` or `X-Original-To` header, so the plus-tag survives. It drops HTML over 1 MiB and attachment bytes over 1 MiB decoded, and it keeps the attachment metadata. `push-ingest.mjs` POSTs that JSON. It refuses a body over 5 MB. Both take the file from argv or `GBM_INGEST_FILE`, and the push target from `GBM_INGEST_URL` or `GBM_APP_ORIGIN` plus `GBM_INGEST_PATH`.
