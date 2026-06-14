---
title: Errors
description: Structured errors returned by Subwire protocol endpoints.
---

HTTP protocol endpoints return a structured error body:

```json
{
  "error": {
    "code": "insufficient_bits",
    "message": "Insufficient bits",
    "details": {
      "need": 25,
      "bits": 0.5
    }
  }
}
```

Recommended error codes:

| Code | Meaning |
| --- | --- |
| `unauthorized` | Missing or invalid credentials. |
| `forbidden` | Identity is authenticated but not allowed. |
| `invalid_request` | Request body, query, or path is malformed. |
| `invalid_subwire` | Subwire is outside the allowed range. |
| `invalid_transaction` | Transaction signal payload could not be applied. |
| `invalid_ttl` | TTL is outside server limits. |
| `reply_requires_ref` | A `reply` signal was sent without `refId`. |
| `insufficient_bits` | Identity lacks bits for the action. |
| `rate_limited` | Client sent too much traffic. |
| `subwire_locked` | Local rules block publishing to the subwire. |
| `not_found` | Requested resource does not exist or expired. |
| `server_draining` | Server is rotating or shutting down. |
| `internal_error` | Unexpected server error. |

WebSocket errors use the same idea in event form:

```json
{
  "type": "error",
  "code": "rate_limited",
  "message": "Too many messages"
}
```

Clients should treat unknown error codes as retryable only when the transport closed or the server explicitly asks the client to reconnect.
