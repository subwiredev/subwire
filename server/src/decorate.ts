import {
  identityObjectUri,
  signalObjectUri,
  subwireAuthority,
  type SignalRecord,
} from "subwire";
import { config, identityAuthority } from "./config.js";

export function serverAuthority(requestUrl: string): string {
  if (config.publicAuthority) return subwireAuthority(config.publicAuthority);
  const url = new URL(requestUrl);
  return subwireAuthority(url.hostname, url.port);
}

// Identities live on the identity network, so origin URIs always point there;
// the signal itself is addressed at whatever authority fronts this server,
// under its subwire slug.
export function decorateSignal(
  signal: SignalRecord & { subwire: string },
  authority: string,
): SignalRecord & { subwire: string } {
  const slug = signal.subwire;
  return {
    ...signal,
    uri: signalObjectUri(authority, slug, signal.id),
    originUri: identityObjectUri(identityAuthority(), signal.origin),
    refUri: signal.refId ? signalObjectUri(authority, slug, signal.refId) : null,
  };
}
