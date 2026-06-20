/**
 * `sw://` object identity. A **subwire** is the whole communication network a
 * server hosts — one server, one subwire — addressed by its authority alone:
 *
 *   sw://subwire.ai                         the subwire (the network)
 *   sw://subwire.ai/signals/{id}            a signal on it
 *   sw://subwire.ai/identities/{id}         an identity on it
 *
 * There are no channels/slugs: signals are organized by tags, not by address.
 */
export interface SubwireUri {
  host: string;
  port: string | null;
  target:
    | { kind: "subwire" }
    | { kind: "signal"; signalId: string }
    | { kind: "identity"; identity: string };
}

export function subwireAuthority(host: string, port?: string | number | null): string {
  if (host.includes("://")) {
    const url = new URL(host);
    return subwireAuthority(url.hostname, url.port || port);
  }
  // Hostnames canonicalize to lowercase everywhere: authorities are compared by
  // exact string equality, so case must never reach them. (The WHATWG URL
  // parser does NOT fold case for non-special schemes like sw:.)
  const normalizedHost = host.replace(/^sw:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const normalizedPort = port == null || port === "" ? "" : `:${port}`;
  return `${normalizedHost}${normalizedPort}`;
}

export function subwireAuthorityFromHttpUrl(input: string): string {
  const url = new URL(input);
  return subwireAuthority(url.hostname, url.port);
}

export function buildSubwireUri(authority: string, ...segments: Array<string | number>): string {
  const path = segments
    .filter((segment) => String(segment).length > 0)
    .map((segment) => encodeURIComponent(String(segment)))
    .join("/");
  return path ? `sw://${authority}/${path}` : `sw://${authority}`;
}

/** The subwire itself: `sw://{authority}`. */
export function subwireUri(authority: string): string {
  return buildSubwireUri(authority);
}

export function signalObjectUri(authority: string, signalId: string): string {
  return buildSubwireUri(authority, "signals", signalId);
}

export function identityObjectUri(authority: string, identity: string): string {
  return buildSubwireUri(authority, "identities", identity);
}

export function publicSubwireAuthority(fallback = "subwire.local"): string {
  if (process.env.PUBLIC_SUBWIRE_HOST) {
    return subwireAuthority(process.env.PUBLIC_SUBWIRE_HOST);
  }
  if (process.env.PUBLIC_API_URL) {
    return subwireAuthorityFromHttpUrl(process.env.PUBLIC_API_URL);
  }
  if (process.env.VITE_API_URL) {
    return subwireAuthorityFromHttpUrl(process.env.VITE_API_URL);
  }
  return fallback;
}

export function signalIdFromRef(ref: string): string {
  if (!ref.startsWith("sw://")) return ref;
  const parsed = parseSubwireUri(ref);
  if (parsed.target.kind !== "signal") {
    throw new Error("Signal reference URI must point at sw://{authority}/signals/{id}");
  }
  return parsed.target.signalId;
}

export function parseSubwireUri(input: string): SubwireUri {
  const url = new URL(input);
  if (url.protocol !== "sw:") {
    throw new Error("Subwire URI must use sw://");
  }

  // sw: is not a WHATWG "special" scheme, so URL leaves host case intact —
  // fold it here; authorities are canonically lowercase (see vectors/).
  const host = url.hostname.toLowerCase();
  const port = url.port || null;
  const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const [first, second] = segments;

  if (!first) {
    return { host, port, target: { kind: "subwire" } };
  }
  if (first === "identities") {
    if (!second || segments.length !== 2) throw new Error("Identity URI must be sw://{authority}/identities/{id}");
    return { host, port, target: { kind: "identity", identity: decodeURIComponent(second) } };
  }
  if (first === "signals") {
    if (!second || segments.length !== 2) throw new Error("Signal URI must be sw://{authority}/signals/{id}");
    return { host, port, target: { kind: "signal", signalId: decodeURIComponent(second) } };
  }

  throw new Error("Unknown Subwire URI target");
}

export function subwireUriToHttpOrigin(uri: SubwireUri, secure = true): string {
  const port = uri.port ? `:${uri.port}` : "";
  return `${secure ? "https" : "http"}://${uri.host}${port}`;
}

// Maps an sw:// URI onto the authority's HTTP surface, where subwire traffic
// is namespaced under /sw/: sw://subwire.ai/signals/x -> https://subwire.ai/sw/signals/x
export function subwireUriToHttpUrl(uri: SubwireUri, secure = true): string {
  const origin = subwireUriToHttpOrigin(uri, secure);
  switch (uri.target.kind) {
    case "subwire":
      return `${origin}/sw`;
    case "signal":
      return `${origin}/sw/signals/${encodeURIComponent(uri.target.signalId)}`;
    case "identity":
      return `${origin}/identities/${encodeURIComponent(uri.target.identity)}`;
  }
}
