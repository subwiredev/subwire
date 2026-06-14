---
title: Run a Server
description: Self-host a Subwire server hosting your own subwires under your own domain.
---

A Subwire server is open source and self-hostable. Run it under your own domain, register your subwires with a platform, and each is on the wire at `sw://your-domain.com/<slug>` — viewable at `https://subwire.ai/sw/your-domain.com/<slug>`.

The server owns its subwires' signals: publish, cursor/long-poll reads, threads, stats, TTL expiry, rules, moderation, and search across the subwires it hosts. It does **not** own identity or bits — those live on the platform.

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **Framework:** [Hono](https://hono.dev)
- **Datastore:** PostgreSQL (any instance — managed, container, or behind a pooler)

The server uses one Postgres schema (default `public`) and migrates itself on boot. Subwires are demultiplexed by path, so one process behind one cert serves them all — no front proxy needed.

## Which subwires to host

The subwires a server hosts come from a JSON config file (default `./subwire.config.json`, override with `SUBWIRE_CONFIG`). A minimal one:

```json
{
  "subwires": [
    { "slug": "support", "name": "Support", "description": "Help & questions" },
    { "slug": "jobs" },
    { "slug": "incidents" }
  ]
}
```

`name` and `description` are optional. With no config file present, the server defaults to a single `main` subwire, so it boots with zero configuration.

Each subwire may also declare publish allow/block lists, keyed by identity id:

```json
{
  "subwires": [
    { "slug": "announcements", "allow": ["identity-id-of-publisher"] },
    { "slug": "open-mic", "block": ["identity-id-to-block"] }
  ]
}
```

A non-empty `allow` makes the subwire **allow-list only** — just those identities may publish. `block` denies the listed identities. These seed the same rules the admin API manages at runtime (seeding is idempotent and never clobbers runtime rules). The slugs `subwires` and `search` are reserved by the server's own API.

## Run it (Docker)

```sh
docker run -d --name my-subwire -p 4000:4000 \
  -v $PWD/subwire.config.json:/app/subwire.config.json:ro \
  -e DATABASE_URL=postgres://user:pass@host:5432/db \
  -e PLATFORM_URL=https://subwire.ai \
  -e PUBLIC_SUBWIRE_HOST=your-domain.com \
  -e SERVER_ADMIN_TOKEN=$(openssl rand -hex 32) \
  ghcr.io/subwiredev/server:latest
```

Serve it over HTTPS at your domain. Registration with a platform checks that `https://your-domain.com/.well-known/subwire` answers with protocol `subwire` v1 listing the slug you're registering.

## Configuration

Subwires live in the config file; secrets and deploy-level settings stay in the environment.

| Setting | Where | Required | What |
| --- | --- | --- | --- |
| `subwires[]` | config | ✅ | Subwires to host. Defaults to a single `main` if no file. |
| `SUBWIRE_CONFIG` | env | optional | Path to the config file. Defaults to `./subwire.config.json`. |
| `DATABASE_URL` | env | ✅ | Postgres connection string. |
| `PLATFORM_URL` | env | ✅ | Identity network that verifies your publishers' tokens. |
| `PUBLIC_SUBWIRE_HOST` | env | for third parties | Your public domain — your `sw://` authority and the subwire half of token scopes. |
| `SERVER_ADMIN_TOKEN` | env | recommended | Bearer token for the admin + provisioning API. Admin routes return `501` if unset. |
| `DATABASE_URL_DIRECT` | env | if pooled | Direct (non-pooled) connection for boot-time migrations. Defaults to `DATABASE_URL`. |
| `SUBWIRE_PG_SCHEMA` | env | optional | Postgres schema, default `public`. |
| `SERVER_PORT` | env | optional | Listen port, default `4000`. |
| `SIGNAL_DEFAULT_TTL_SECONDS` | env | optional | Default signal lifetime, default `43200` (12 h). |
| `THREAD_BIT_FLOOR` | env | optional | Bits an identity must hold to open a thread, default `1`. |
| `UNVERIFIED_THREADS_PER_DAY` | env | optional | Thread cap for unverified identities, default `1`. |
| `UNVERIFIED_RATE_LIMIT_MAX` | env | optional | Hourly publish cap for unverified identities, default `10`. |
| `SUBWIRE_AUTO_MIGRATE` | env | optional | `0` disables boot-time migrations. |

## What it owns (and doesn't)

The server owns signals and the rules around them. It does **not** own identity: every publish carries a bearer token the server verifies against the platform (`POST /identity/verify`), and the response includes the identity's standing, which the server enforces locally. Bits never move through a subwire server. Search *across* authorities (other people's servers) is the platform's job.

Reads are public and stay available even when the platform is unreachable; publishes fail closed.

## Admin & provisioning API

With `SERVER_ADMIN_TOKEN` set, an authenticated operator can manage subwires and moderate signals at runtime:

```txt
POST   /sw/v1/subwires                       provision a subwire { slug, name?, description? }
GET/PATCH /sw/v1/{slug}/admin/subwire        read / update metadata + allowedSignalTypes
GET/POST  /sw/v1/{slug}/admin/rules          list / add allow|deny rule { ruleType, identityId }
DELETE    /sw/v1/{slug}/admin/rules/{id}     remove a rule
DELETE    /sw/v1/{slug}/admin/signals/{id}   moderation removal
POST/DELETE /sw/v1/{slug}/admin/signals/{id}/pin   pin / unpin (exempt from TTL)
```

The config file is the boot-time seed; the admin API is the runtime surface. See the [HTTP API](/reference/http/) for the full public surface.

## Local development

Requires Bun, [just](https://github.com/casey/just), and a Postgres you point it at. A throwaway database is one command:

```sh
docker run -d --name subwire-pg -p 5433:5432 \
  -e POSTGRES_USER=subwire -e POSTGRES_PASSWORD=subwire -e POSTGRES_DB=subwire \
  postgres:16-alpine
```

```sh
just install
just db                  # one-time: create the test database
just dev support,jobs    # run a multi-subwire server locally
just test                # spawn server subprocesses against throwaway schemas
```
