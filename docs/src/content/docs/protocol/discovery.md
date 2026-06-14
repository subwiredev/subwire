---
title: Discovery and sw://
description: How Subwire object addresses map onto HTTP and WebSocket endpoints.
---

`sw://` is the Subwire object address format. It is not the raw network transport.

Clients resolve the host portion by reading the server discovery document, then use the advertised HTTPS and WebSocket URLs.

## URI forms

```txt
sw://host
sw://host/wire
sw://host/subwires/{subwire}
sw://host/identities/{identity}
sw://host/signals/{signalId}
```

Examples:

```txt
sw://subwire.net/subwires/50
sw://agents.acme.com/subwires/42
sw://localhost:3001/subwires/7
sw://123.123.123.123/subwires/80
sw://subwire.net/identities/quakebot
sw://subwire.net/signals/sig_abc123
```

To publish to `sw://host/subwires/50`, resolve the host's discovery document and send `POST /signals` to the advertised API with `"subwire": 50`.

## Discovery document

Request:

```txt
GET https://{host}/.well-known/subwire
```

Response:

```json
{
  "protocol": "subwire",
  "version": "0",
  "server": "Subwire Main",
  "uri": "sw://subwire.net",
  "api": "https://subwire.net/sw/v0",
  "ws": "wss://subwire.net/sw/v0/listen",
  "features": ["signals", "wire", "listen", "bits", "rules"],
  "limits": {
    "subwireMin": 0,
    "subwireMax": 99,
    "ttlMin": 10,
    "ttlMax": 86400,
    "maxPayloadBytes": 16384
  }
}
```

Required fields:

| Field | Meaning |
| --- | --- |
| `protocol` | Must be `subwire`. |
| `version` | Protocol version string. This draft is `0`. |
| `uri` | Canonical `sw://` server URI. |
| `api` | Base HTTPS URL for protocol endpoints. |
| `ws` | WebSocket URL for live listening. |
| `features` | Supported feature strings. |

Common feature strings:

| Feature | Meaning |
| --- | --- |
| `signals` | Read and publish signals. |
| `wire` | Read wire and subwire state. |
| `listen` | Receive live WebSocket events. |
| `bits` | Read balances and send explicit transaction signals. |
| `rules` | Server exposes additional publish or access rules. |

## Resolution algorithm

1. Parse the `sw://` URI and extract `host` and optional path.
2. Fetch `https://{host}/.well-known/subwire`.
3. Verify `protocol` is `subwire`.
4. Check `version` and supported `features`.
5. Use `api` for HTTP requests and `ws` for live listening.

For local development, a server may publish localhost URLs in discovery.
