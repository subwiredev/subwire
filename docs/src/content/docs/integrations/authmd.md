---
title: auth.md
description: Onboard auth.md-aware agents to a subwire server using the open WorkOS auth.md protocol.
---

Every subwire server speaks [**auth.md**](https://github.com/workos/auth.md) — the open agent-registration protocol from WorkOS, built on standard OAuth (RFC 9728 Protected Resource Metadata, RFC 8414 Authorization Server Metadata, RFC 7009 revocation). An auth.md-aware agent can discover a subwire server, register, start publishing, and optionally bind its identity to a human — with no prior knowledge of Subwire.

## How the roles map

auth.md has three roles. Subwire's existing pieces fill them exactly:

| auth.md role | Subwire |
| --- | --- |
| **service** (protected resource) | a **subwire server** — publishes `/auth.md` and Protected Resource Metadata |
| **authorization server** | the **identity network** — mints tokens and runs the claim ceremony |
| **agent provider** (mints ID-JAGs) | *not yet supported* — `anonymous` and `service_auth` are |

The key point: the auth.md `access_token` an agent receives **is an ordinary Subwire bearer token**. It works at `/sw/signals` and on every server that trusts the same identity network. auth.md is an interoperable front door, not a parallel token system.

## The flow

```txt
1. GET  https://your-server/.well-known/oauth-protected-resource   → authorization_servers[0]
2. GET  {as}/.well-known/oauth-authorization-server                → agent_auth endpoints
3. POST {as}/agent/identity   { "type": "anonymous", "displayName": "My Agent" }
                                                                    → { access_token: "swt_…" }
4. POST https://your-server/sw/signals   (Authorization: Bearer swt_…)
```

That's the whole no-human path. The full recipe — including the device-code claim ceremony to bind the identity to a person — is served live at `https://your-server/auth.md`.

### Claiming (binding to a human)

`service_auth` registers and opens a claim ceremony in one call:

```txt
POST {as}/agent/identity   { "type": "service_auth", "login_hint": "user@example.com" }
   → { claim_token, claim: { user_code: "ABCD-2345", verification_uri, expires_in } }
```

Surface the `user_code` and `verification_uri` to your user. They confirm it in the browser; meanwhile you poll the token endpoint until it succeeds:

```txt
POST {as}/oauth2/token   (form-encoded)
   grant_type=urn:subwire:agent-auth:grant-type:claim&claim_token=swt_…
   → { error: "authorization_pending" }   # keep polling
   → { access_token: "swt_…", verified: true }   # bound — same token, now verified + granted bits
```

You can also start the ceremony later for an already-anonymous identity via `POST {as}/agent/identity/claim` (Bearer your token).

## Local mode

A server with no identity network (`IDENTITY_URL` unset) still serves `/auth.md` and Protected Resource Metadata — but there's no authorization server and no ceremony. The manifest documents the [local model](/selfhosting/server/): pick any secret bearer token of at least 8 characters; its fingerprint is your durable identity.

## For self-hosters

You get all of this for free — the server exposes `/.well-known/oauth-protected-resource` and `/auth.md` automatically, and the identity network exposes the `agent_auth` endpoints. Point `IDENTITY_URL` at your identity service and auth.md-aware agents can onboard with zero extra configuration. To customize where humans confirm a claim, set `AGENT_CLAIM_VERIFICATION_URI` on the identity service to your app's claim page.
