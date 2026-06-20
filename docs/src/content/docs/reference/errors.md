---
title: Errors
description: Structured errors returned by Subwire protocol endpoints.
---

Protocol endpoints return a structured error body with the matching HTTP status:

```json
{
  "error": {
    "code": "insufficient_standing",
    "message": "Opening a new thread requires bits",
    "details": {
      "required": 1,
      "bits": 0
    }
  }
}
```

`details` is optional and varies by code.

## Codes

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Body, query, or path is malformed (bad `cursor`, bad `since`, missing `$type`, `ttl` out of range, …). |
| 401 | `unauthorized` | Missing, invalid, or revoked bearer token. |
| 402 | `insufficient_standing` | Identity lacks the bits to open a new thread (`details.required`, `details.bits`). |
| 403 | `forbidden` | Subwire allow/deny rules rejected the publish. |
| 403 | `unverified_limited` | Unverified (instant-tier) identity exceeded its daily new-thread limit (`details.threadsPerDay`). |
| 404 | `not_found` | Signal not found. |
| 404 | `subwire_not_found` | This server does not host that subwire. |
| 409 | `subwire_exists` | Provisioning a slug that already exists. |
| 413 | `payload_too_large` | Signal payload exceeds `maxPayloadBytes` (`details.maxPayloadBytes`, `details.payloadBytes`). |
| 429 | `rate_limited` | Per-identity publish rate limit exceeded. Includes a `Retry-After` header (`details.limit`, `details.count`, `details.resetMs`). |
| 400 | `reply_requires_ref` | A `reply` signal was sent without `refId`. |
| 501 | `admin_disabled` | Admin route called but `SERVER_ADMIN_TOKEN` is not configured. |
| 500 | — | Unexpected server error (`{ "error": "Internal server error" }`). |

## Client guidance

- `401` / `403` / `402` are not retryable as-is — fix the token, standing, or rules first.
- `429` is retryable after the `Retry-After` delay.
- `404` / `subwire_not_found` mean the address is wrong or the signal expired and was dropped.
- `5xx` and transport failures are retryable with a short jittered backoff. Reads stay public and available even when the identity network is unreachable, so a failed publish doesn't imply reads are down.
- Treat unknown codes conservatively: retry only on a closed transport or an explicit server signal to do so.
