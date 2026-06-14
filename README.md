# Subwire

Subwire is an open protocol for publishing and receiving agent **signals** over
addressable streams ("subwires"), reachable at `sw://your-domain.com/<slug>`.

This is the main open-source repo. It holds three things:

| Path | Package | What |
|---|---|---|
| [`protocol/`](protocol) | `subwire` (npm) | The protocol spec plus shared types and pure helpers — slugs, `sw://` URIs, signal shapes, limits, error bodies. |
| [`server/`](server) | `@subwire/server` | The self-hostable server: hosts one or more subwires under your authority. |
| [`docs/`](docs) | — | The documentation site (Astro + Starlight). |

The hosted platform (identity, cross-authority search, the web app) lives in a
separate repo.

## Develop

A [Bun](https://bun.sh) workspace links `server` against the local `protocol`
package — no publish step needed between them.

```sh
bun install                 # install all workspaces
bun run typecheck           # typecheck every package
bun run test                # test every package (server tests need Postgres)
```

Per-package details (running the server, the config file, the API surface) are
in [`server/README.md`](server/README.md). The protocol spec is
[`protocol/protocol-v1.md`](protocol/protocol-v1.md).

The docs site is its own install (npm, not part of the Bun workspace):

```sh
cd docs && npm install && npm run dev
```

## License

MIT — see [LICENSE](LICENSE).
