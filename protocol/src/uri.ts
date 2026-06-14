import { isValidSubwireSlug } from "./slug.js";

export interface SubwireUri {
  host: string;
  port: string | null;
  target:
    | { kind: "authority" }
    | { kind: "subwire"; slug: string }
    | { kind: "signal"; slug: string; signalId: string }
    | { kind: "identity"; identity: string };
}

export function subwireAuthority(host: string, port?: string | number | null): string {
  if (host.includes("://")) {
    const url = new URL(host);
    return subwireAuthority(url.hostname, url.port || port);
  }
  // Hostnames canonicalize to lowercase everywhere: scopes and addresses are
  // compared by exact string equality, so case must never reach them. (The
  // WHATWG URL parser does NOT fold case for non-special schemes like sw:.)
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

export function subwireUri(authority: string, slug: string): string {
  return buildSubwireUri(authority, slug);
}

export function signalObjectUri(authority: string, slug: string, signalId: string): string {
  return buildSubwireUri(authority, slug, "signals", signalId);
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
    throw new Error("Signal reference URI must point at sw://host/{slug}/signals/{id}");
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
  const [first, second, third] = segments;

  if (!first) {
    return { host, port, target: { kind: "authority" } };
  }
  if (first === "identities") {
    if (!second) throw new Error("Identity URI must include an id");
    return { host, port, target: { kind: "identity", identity: decodeURIComponent(second) } };
  }

  const slug = decodeURIComponent(first);
  if (!isValidSubwireSlug(slug)) {
    throw new Error(`Subwire URI has an invalid subwire slug: ${slug}`);
  }
  if (segments.length === 1) {
    return { host, port, target: { kind: "subwire", slug } };
  }
  if (second === "signals" && third && segments.length === 3) {
    return { host, port, target: { kind: "signal", slug, signalId: decodeURIComponent(third) } };
  }

  throw new Error("Unknown Subwire URI target");
}

export function subwireUriToHttpOrigin(uri: SubwireUri, secure = true): string {
  const port = uri.port ? `:${uri.port}` : "";
  return `${secure ? "https" : "http"}://${uri.host}${port}`;
}

// Maps an sw:// URI onto the authority's HTTP surface, where subwire traffic
// is namespaced under /sw/: sw://subwire.ai/news -> https://subwire.ai/sw/news
export function subwireUriToHttpUrl(uri: SubwireUri, secure = true): string {
  const origin = subwireUriToHttpOrigin(uri, secure);
  switch (uri.target.kind) {
    case "authority":
      return origin;
    case "subwire":
      return `${origin}/sw/${encodeURIComponent(uri.target.slug)}`;
    case "signal":
      return `${origin}/sw/${encodeURIComponent(uri.target.slug)}/signals/${encodeURIComponent(uri.target.signalId)}`;
    case "identity":
      return `${origin}/identities/${encodeURIComponent(uri.target.identity)}`;
  }
}
