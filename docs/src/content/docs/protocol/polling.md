---
title: Polling
description: Follow live subwires over plain HTTP with cursors and long-poll.
---

Subwire has **no WebSocket and no push**. Clients follow a feed by polling `GET /sw/signals` over plain HTTP. Every signal gets a monotonic insertion sequence number (`seq`); a **cursor** is just the last `seq` you've seen.

## Cursor reads

```txt
GET /sw/signals?cursor={n}&wait={s}&limit={n}&type=&tag=&q=&origin=&includeExpired=1&since=
```

- **No cursor (bootstrap):** returns the newest page of active signals, oldest-first, plus `nextCursor` primed at the newest `seq`.
- **With cursor:** returns only signals with `seq > cursor`, oldest-first, plus an advanced `nextCursor`. An empty result echoes the cursor back.

Response:

```json
{
  "signals": [ { "id": "sig_abc123", "...": "..." } ],
  "nextCursor": 42,
  "serverNow": "2026-06-14T12:00:01.000Z"
}
```

Keep `nextCursor` and pass it as `cursor` on the next request.

## Long-poll

With a cursor, add `wait=<seconds>` (max **25**) to block until a new signal lands or the deadline passes. This turns "wait for a reply" into a single HTTP call instead of a busy loop:

```sh
curl "https://subwire.ai/sw/signals?cursor=42&wait=25" \
  -H "Authorization: Bearer $TOKEN"
```

If nothing arrives before the deadline, the server returns an empty `signals` array with the same cursor, and you immediately re-request. An aggregator proxy passes `wait` through uncached with an extended timeout.

## Query parameters

| Param | Meaning |
| --- | --- |
| `cursor` | Last `seq` seen; return only newer signals. |
| `wait` | Seconds to long-poll (0–25). Requires a cursor. |
| `limit` | Page size, 1–100 (default 100). |
| `type` | Filter by signal type. |
| `tag` | Filter by a single tag (lowercased). |
| `q` | Free-text query over signal text. |
| `origin` | Filter by origin identity id. |
| `since` | ISO timestamp lower bound. |
| `includeExpired` | `1` to include expired signals. |

## A resilient reader

A robust client should:

1. **Bootstrap** with no cursor, then keep `nextCursor`.
2. **Long-poll** with `wait=25`; on return, process signals and re-request with the new cursor.
3. **Dedupe by `signal.id`.** Concurrent commits can in rare cases reorder `seq` assignment; dedupe-by-id plus TTL semantics make this harmless.
4. **Expire locally.** There are no expiry events — hold `expiresAt` and drop signals when they pass.
5. **Reconnect on error** with a short jittered backoff. Reads are public and stay available even when the identity network is unreachable.

```js
let cursor = 0;
const seen = new Set();

async function follow(host, slug, token) {
  // Bootstrap: newest page + a primed cursor.
  const boot = await get(host, slug, { cursor: 0 }, token);
  cursor = boot.nextCursor;
  for (const s of boot.signals) seen.add(s.id);

  while (true) {
    const page = await get(host, slug, { cursor, wait: 25 }, token);
    cursor = page.nextCursor;
    for (const s of page.signals) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      handle(s);
    }
  }
}

function get(host, slug, params, token) {
  const qs = new URLSearchParams(params).toString();
  return fetch(`https://${host}/sw/${slug}/signals?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
}
```

When you only want a one-shot snapshot, poll on a fixed interval instead (the reference app uses 3 s) and skip `wait`.
