# Bot send bridge

The app owns outbound delivery. Send stores the message on `mail_outbound` and immediately POSTs a wake to the Grok Bot routine webhook. The wake body is only the send id. The bot reads the message with `GET /api/outbox` and reports what happened. The app does not poll, and it does not run a backup sweep.

When the webhook is not saved, the send stays queued and the app says `Sending…`. A failed wake stays on that same line while retries remain.

Addresses below are examples. Use the mailbox's own addresses.

Send `Authorization: Bearer <INGEST_TOKEN>` on the bot routes. The comparison is the same constant-time check as `POST /api/ingest`. A session cookie does not authorize these routes. A bearer token does not authorize the app's cancel route.

The app does not log the body or the token. Responses send `cache-control: no-store`.

## Grok Bot connection

Settings has a "Grok Bot connection" section: Webhook URL, Sender key, and auth header. Save writes one `mail_mailbox_config` row, id `config`, with `webhookUrl`, `webhookKey`, and `headerMode`. The key is not part of `mail_settings` and it is not on the public config. A read returns the URL, the header mode, and `saved` or `not set`. It does not return the key. A blank key on save keeps the stored key. An empty URL clears delivery.

`data/config.json` is only a fallback when that row is absent. On a deploy, the row is the copy that survives a new instance.

Grok Bot routine webhooks take the key in the `Authorization` header. The default mode is `bearer`, which sends `Authorization: Bearer <key>`. The other mode is `x-webhook-key`, which sends `X-Webhook-Key: <key>` instead. Exactly one of those headers is sent.

"Send test ping" POSTs `{ "action": "ping" }` to the saved URL. The screen shows the HTTP status, or "No response" when there is no status. Ping does not send mail. The bot should answer 200 and do nothing else.

## Wake

On Send the app POSTs immediately:

```json
{ "action": "send", "clientSendId": "send_1" }
```

That object has no subject, body, or addresses. `clientSendId` is `mail_outbound.client_send_id`. The bot loads the message with `GET /api/outbox?status=queued` and the ingest token. Check mail still POSTs `{ "action": "sync", "after" }`.

HTTP 200 means the routine woke. The row stays `queued` until the bot reports a status. It does not mean the message was sent.

## Retries

A wake that does not return HTTP 200 is retried. The delay before each of the five attempts is immediate, 30 seconds, 2 minutes, 10 minutes, then 1 hour. The fifth failure sets `status` to `failed`. `mail_outbound` stores `attempt_count`, `next_attempt_at`, and `last_error`.

There is no Vercel cron. A Hobby cron runs at most once per day, and a sub-daily schedule fails at deploy, so a cron cannot fire a 30-second, 2-minute, or 10-minute retry. A due row runs on the next app request that loads the mailbox, and on the next authorized ingest or outbox request, after `next_attempt_at`. Until that request arrives, nothing else posts the wake. Each request posts at most 5 due wakes. Each POST times out at 8 seconds.

## Status codes

| Status | When | Body |
| --- | --- | --- |
| 200 | The call did what it asked | A JSON array, or `{ "id", "status" }` |
| 400 | The JSON, query, or status value is not in the contract. `sent` without `providerMessageId` is `400` | `{ "error": "invalid" }` |
| 401 | The credential for that route is missing or wrong | `{ "error": "unauthorized" }` |
| 404 | That `id` is not in `mail_outbound` | `{ "error": "not found" }` |
| 405 | The method is wrong for the path | `{ "error": "method" }` and an `Allow` header |
| 409 | The id exists and this status move is not allowed | `{ "error": "conflict" }` |
| 503 | `INGEST_TOKEN` is unset or blank, or the write failed | `{ "error": "unavailable" }` |

`401` and `503` for a missing or unset token are decided before the database is opened. A cookie that would open the app still gets `401` on the bot routes. A bearer token on cancel still gets `401`.

## `GET /api/outbox?status=queued`

Bearer token. `status` must be the exact string `queued`. Any other query value, including omitting it, is `400`.

`200` is a JSON array, oldest `created_at` first, then id. A database status of `queued`, `waiting`, or `pending` is listed. `awaiting_approval`, `sent`, `declined`, `failed`, and `cancelled` are not.

Each item has exactly these fields:

```json
{
  "id": "send_1",
  "fromAddress": "you@example.com",
  "to": ["ada@example.com"],
  "cc": ["bea@example.com"],
  "subject": "Hello",
  "text": "The plain body.",
  "html": null,
  "replyTo": { "ingestId": "msg_parent", "subject": "Parent subject" }
}
```

- `id` is `mail_outbound.client_send_id`. It is the same id as `clientSendId` on the wake.
- `fromAddress`, `to`, and `cc` are email strings.
- `text` is the plain body stored with the send.
- `html` is a string only when the stored send has one. Compose leaves it `null`.
- `replyTo` is `null` when the send is not a reply. `ingestId` is the `mail_message.id` of the message being answered, not its RFC Message-ID. `subject` is that row's subject, or `""` when the row is gone.
- `bcc` is never a field. A blind copy typed in Compose is dropped and is not in this payload. The wake body has no `bcc` field either.

## `POST /api/outbox/:id/status`

Bearer token. The body is JSON:

```json
{
  "status": "awaiting_approval",
  "providerMessageId": "prov-1",
  "error": "optional"
}
```

`status` is one of `awaiting_approval`, `sent`, `declined`, `failed`, or `queued`. `cancelled`, `waiting`, `pending`, and `approved` are `400` on this route. `providerMessageId` is required when `status` is `sent` (trimmed, 1–512 characters, no NUL). Otherwise it is optional. `error` is stored up to 2000 characters. On `failed` a missing error is stored as `""`. On `declined` a missing error is stored as `null`. Other successful moves clear `error`.

`200` is `{ "id": "send_1", "status": "awaiting_approval" }`.

Unknown id is `404`. A known id with a status that this route accepts, but that the current row cannot move to, is `409`. The row is unchanged.

### Transitions

Treat a stored status of `waiting` or `pending` as `queued`.

Allowed:

- `queued` → `awaiting_approval`
- `awaiting_approval` → `sent`
- `awaiting_approval` → `declined`
- `awaiting_approval` → `failed`
- `awaiting_approval` → `queued`

Anything else on this route is `409`, including repeating the row's current status (`queued` → `queued`, `sent` → `sent`).

`queued` → `cancelled` is only `DELETE /api/outbox/:id`.

## `DELETE /api/outbox/:id`

Session cookie (`gb_session`), the same cookie that opens the app. Bearer is not accepted.

Allowed only while the row is `queued`, `waiting`, or `pending`. `200` is `{ "id": "send_1", "status": "cancelled" }`. Any other stored status is `409`. Unknown id is `404`. No session is `401`.

## Sent message

When a move to `sent` is allowed and `providerMessageId` is present, the app updates `mail_outbound.status` to `sent` and inserts one `mail_message`:

- `id` is `msg_<providerMessageId>`
- `message_id` is the provider id
- `direction` is `outbound`
- `from` is the queued From address
- `date` is the time of this request
- `bcc` is `[]`
- `client_send_id` is the outbox id
- `unread` is false

If `reply_to_message_id` matches a `mail_message.id`, the new row copies that row's `thread_hint` and sets `in_reply_to` to that row's `message_id` (and appends it to references). The sent mail then shows in that thread and in Sent.

If there is no reply row, `thread_hint` is `outbox:<client_send_id>`, which is its own thread. Sent still lists it because the direction is `outbound`.

A second `sent` for the same id is `409` and does not insert another row.

### Idempotency

Posting `POST /api/ingest` later with a message whose `id` is `msg_<providerMessageId>` updates that row. It does not create a second copy. The match is the same one ingest already uses: same `id`, or the same `message_id`.

On that update, an omitted `direction` stays `outbound`, and an omitted `threadHint` stays the hint written at send time. `unread` stays as stored.

## `send-result` through ingest

`POST /api/ingest` with `kind: "send-result"` uses this same status move. The ingest item is still stored either way. The HTTP response stays `200` when the batch is valid. A move that these rules reject does not change `mail_outbound` and does not insert a sent message.

```json
{
  "kind": "send-result",
  "clientSendId": "send_1",
  "status": "sent",
  "replyToMessageId": "<parent@example.com>",
  "sentMessageId": "prov-1",
  "error": null
}
```

`clientSendId` is the outbox id. `sentMessageId` is the provider id used above. `sent` without `sentMessageId` does not move the row.

How `status` is read:

| `send-result` status | Outbox status |
| --- | --- |
| `sent`, `approved` | `sent` |
| `failed`, `rejected`, `error` | `failed` |
| `declined` | `declined` |
| `awaiting_approval` | `awaiting_approval` |
| `queued`, `pending`, `waiting` | `queued` |

Any other string does not move the row. `approved` is accepted only on this ingest item. It is not a `POST /api/outbox/:id/status` value.

The transition table above still applies. `queued` → `sent` is rejected. `awaiting_approval` → `sent` is applied, and the sent message is inserted the same way as the status route.

## What the app shows

Compose Send writes `mail_outbound` and POSTs the wake when a webhook is saved. The toast is `Sending…`. The screen does not say that the bot did not wake, and it does not say that a message was not sent.

The Outbox folder lists saved sends whose message is still in the mailbox. Delete forever removes the matching `mail_outbound` row. A row whose message is already gone is not listed. The drawer count is how many listed rows are `queued` or `awaiting_approval` (`waiting` and `pending` count as queued).

| Stored status | Label |
| --- | --- |
| `queued`, `waiting`, `pending` | `Sending…` |
| `awaiting_approval` | `Waiting for your OK in Grok Bot` |
| `sent` | `Sent` |
| `declined` | `Declined` |
| `failed` | `Failed: <error>`, or `Failed` when the error is blank. Retry is shown only here. |
| `cancelled` | `Cancelled` |

`failed` is the row after the five wakes are used, or after the bot reports `failed`. Retry sets the row back to `queued` and POSTs the wake again. Cancel is shown only for `queued` (including a stored `waiting` or `pending` row). It calls `DELETE /api/outbox/:id`.

## Attachment `content` on ingest

A message attachment, or a loose `kind: "attachment"` item, may include `content`. It is standard base64 (padding required). The app decodes it and stores at most **1 MiB (1,048,576 bytes)**. The stored value is `mail_attachment.content_b64`. `attachments_json` stays metadata only: `id`, `filename`, `mime`, `bytes`, `path`.

Over the cap, blank, or not valid base64: the item is still accepted, the metadata is stored, and the bytes are not. The reader then says `Not downloaded yet` and Download stays off. A later ingest of the same attachment without `content` keeps bytes already stored. With `content` under the cap, Download uses those bytes.
