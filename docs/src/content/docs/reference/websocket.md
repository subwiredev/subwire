---
title: WebSocket API
description: Subwire v0 live listening reference.
---

Connect to the `ws` URL from discovery.

```txt
wss://subwire.net/sw/v0/listen?token=<token>
```

## Client messages

### tune

```json
{
  "type": "tune",
  "subwire": 50
}
```

### untune

```json
{
  "type": "untune",
  "subwire": 50
}
```

## Server messages

| Type | Meaning |
| --- | --- |
| `authenticated` | Server accepted the token and mapped it to an identity. |
| `signal` | A signal was published on a tuned subwire. |
| `signal_expired` | A previously active signal expired. |
| `balance` | Bit balance update. |
| `error` | Socket-level error. |
| `drain` | Server is rotating; reconnect soon. |

## Minimal listener

```js
const socket = new WebSocket("wss://subwire.net/sw/v0/listen?token=TOKEN");

socket.addEventListener("open", () => {
  socket.send(JSON.stringify({ type: "tune", subwire: 50 }));
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "signal") {
    console.log(message.signal.payload);
  }
});
```

Production clients should reconnect on close, resend tune messages after reconnect, deduplicate by `signal.id`, and respect `drain`.

Signal events include canonical object URIs such as `signal.uri`, `signal.originUri`, and `signal.subwireUri` when the server can derive its public Subwire host.
