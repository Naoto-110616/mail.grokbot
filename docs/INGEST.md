# Ingest

The bot delivers mail with `POST /api/ingest`. The body is `{ "items": [ ... ] }`. Each item uses one of the kinds below. The response is `{ "accepted": 0, "skipped": 0 }`.

Send `Authorization: Bearer <INGEST_TOKEN>`. The app compares the token in constant time. A missing or wrong token is `401`. If `INGEST_TOKEN` is unset, every call is rejected and nothing is stored. The app does not log the body or the token.

A request may contain at most 200 items and 5MB. Larger requests are `413`. Invalid JSON, or a body that is not `{ "items": [] }`, is `400`.

The same `id` or `messageId` updates the stored message. Repeating a request does not create a second copy.

Messages group by `threadHint` first. A missing or empty `threadHint` falls back to In-Reply-To and References, then one normalized subject. A `thread` item is still only a hint and is not stored. `threadHint` on a message is stored. Different hints stay in different threads.

`GET /api/ingest/state` uses the same header. It returns the newest stored message date and the row counts:

```json
{
  "newest": "2026-10-01T15:00:00Z",
  "counts": { "messages": 1, "attachments": 1, "accounts": 1, "sendResults": 1 }
}
```

`newest` is `null` when no message date parses. Use it as the cursor for the next sync.

`kind` is one of `account`, `thread`, `message`, `attachment`, `send-result`. Unknown kinds are skipped. A `thread` item is a hint and is skipped. The app groups messages by `threadHint`, then by headers, then by subject.

Attachment items store metadata only. The bytes stay with the bot. A path that is absolute, contains `..`, or contains a NUL byte is skipped. An empty path is metadata with no file.

The first section below is the account. Later account items replace it. Product state on the box (read, star, snooze, labels, folder) is stored separately and overrides the message `unread` flag on load.

## account

The latest valid account item wins. It overrides `data/config.json` for the address, display name, and aliases.

```json
{
  "kind": "account",
  "address": "you@example.test",
  "displayName": "You",
  "aliases": [
    { "email": "you@example.test", "tag": null, "name": "You" },
    { "email": "you+ops@example.test", "tag": "ops", "name": "Ops" }
  ]
}
```

## thread

A hint only. The app does not store it and does not use it to decide which messages share a thread. Grouping uses headers, then a single subject fallback.

```json
{
  "kind": "thread",
  "id": "thr_optional",
  "messageIds": ["<a@example.test>", "<b@example.test>"]
}
```

## message

`messageId`, `inReplyTo`, and `references` are the header values, angle brackets included. `deliveredTo` is the envelope recipient. The plus-tag is the local part after `+` in that address. The thread keeps the tag from the earliest message that has one. `account` is the inbox id from the bot, such as `primary`. The UI still files the thread under the Grok Bot account.

```json
{
  "kind": "message",
  "id": "msg_a",
  "messageId": "<a@example.test>",
  "inReplyTo": null,
  "references": [],
  "deliveredTo": "you+ops@example.test",
  "account": "primary",
  "from": { "name": "Ada", "email": "ada@example.test" },
  "to": [{ "name": "You", "email": "you+ops@example.test" }],
  "cc": [],
  "bcc": [],
  "subject": "Quarterly notes",
  "threadHint": "batch-1",
  "direction": "inbound",
  "body": "Notes for the quarter.",
  "html": "<p>Notes for the quarter.</p>",
  "date": "2026-10-01T15:00:00Z",
  "unread": true,
  "attachments": [
    {
      "id": "att_note",
      "filename": "note.txt",
      "mime": "text/plain",
      "bytes": 11,
      "path": "files/note.txt"
    }
  ]
}
```

`date` is ISO-8601. `unread` defaults to true when it is omitted, and it is stored only when the message is inserted. Posting the same `id` or `messageId` again updates the message content and leaves `unread` as it is. Omitted `threadHint`, `direction`, and `html` stay as stored. Star, snooze, labels, folder, and trash live on the thread and are not changed by ingest.

`direction` is `inbound` or `outbound`. Any other value is stored as empty. A missing direction is inbound unless `from` is the account address, which is outbound. Outbound mail is shown as sent by the mailbox owner and listed in Sent.

A copy of a message the app sent is stored once. When an ingested message is the bot inbox copy of an app send, it updates the app's `msg_<providerMessageId>` row instead of adding a second one. It matches when its `id` or `messageId` is the provider message id, or, failing that, when `from`, `to`, and `subject` match and `date` is within 15 minutes of the send. An explicit `inbound` direction never matches, so mail you send to yourself still arrives. If the copy is ingested before the send is marked sent, the send links to that copy. Pairs stored before this rule are shown once on read.

`html` is optional. A string is stored in `mail_message.html_body`. The plain `body` (or `text`) is always stored as well. The reader shows the HTML when `html_body` is present, and the plain body when it is not.

`html` is capped at **1 MiB (1,048,576 UTF-8 bytes)** per message. The 5MB request cap is unchanged. Over the cap, the message is still accepted, the plain body is stored, and `html_body` is not written: a new row stays null, and an update keeps the HTML already stored. A blank `html` is treated the same as omitting it. A new `html` within the cap replaces `html_body`.

The reader sanitizes HTML before display. Scripts, forms, and event handlers are removed. Links open in a new tab with `rel="noopener noreferrer"`. Remote images stay unloaded until the person taps Show images on that message. Tracking pixels stay unloaded after that tap.

`headers` is how Promos and Updates see `List-Unsubscribe` and `Auto-Submitted`. It may be an object, a raw header block, or a list of `{ "name", "value" }` (the list is what mail providers return). The same names may be top-level (`listUnsubscribe`, `List-Unsubscribe`). `List-Unsubscribe` files the thread in Promos. `Auto-Submitted` other than `no` files it in Updates. A later ingest that omits the header keeps the value already stored. Marketing copy in the body does not file Promos by itself.

## attachment

Optional. Use it when the file metadata is sent separately from the message. `messageId` or a matching `id` attaches it to a message. `path` is a relative location the bot keeps. The bytes are not copied into the JSON and they are not sent on the webhook.

```json
{
  "kind": "attachment",
  "id": "att_note",
  "messageId": "<a@example.test>",
  "filename": "note.txt",
  "mime": "text/plain",
  "bytes": 11,
  "path": "files/note.txt"
}
```

## send-result

Written when a reply's outcome is known. `pending` and `waiting` leave the UI on "Waiting for approval in Grok Bot". `failed`, `rejected`, and `error` mark the reply failed. Any other status, including `sent` and `approved`, marks it sent. When `sentMessageId` is set on a sent result, it becomes the message's `Message-ID`.

```json
{
  "kind": "send-result",
  "clientSendId": "send_1",
  "status": "sent",
  "replyToMessageId": "<a@example.test>",
  "sentMessageId": "<sent-1@example.test>",
  "error": null
}
```

`clientSendId` matches `clientSendId` on the wake `{ "action": "send", "clientSendId" }`. Do not write this file merely because a draft was created.

The same item also updates the queued send when that id matches and the transition in `docs/bot-setup.md` allows it. `approved` counts as `sent` for that row. A move that is not allowed leaves the queued send unchanged. The bot reads queued sends with `GET /api/outbox?status=queued`. The wake carries no message content.
