# subwire

Shared types and pure helpers for the [Subwire](https://subwire.ai) protocol:
slug rules, `sw://` URI parsing and formatting, subwire addresses, signal
shapes and limits, error bodies. Zero runtime dependencies.

The protocol specification lives here too: [protocol-v1.md](./protocol-v1.md) —
this package is its **TypeScript binding**. Implementations in other
languages should be written against the spec and the language-neutral
conformance vectors in [vectors/](./vectors), which this package runs in CI.

```sh
bun add subwire   # or npm install
```

```ts
import {
  parseSubwireAddress,
  formatSubwireAddress,
  parseSubwireUri,
  subwireUriToHttpUrl,
  SIGNAL_TTL_MAX,
  type SignalRecord,
} from "subwire";
```

Used by [subwire-server](https://github.com/subwiredev/server)
(the self-hostable subwire server) and the Subwire platform.

## Development

```sh
bun install
bun test
bun run typecheck && bun run build
```

Publishing is tag-driven: bump `version`, then `git tag v<version> && git push --tags`.

## License

[MIT](./LICENSE)
