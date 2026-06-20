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

// One server is one subwire, so signals are addressed at the server's own
// authority — no slug. Identities live on the identity network (or, in local
// mode, at this server's own authority).
export function decorateSignal(signal: SignalRecord, authority: string): SignalRecord {
  return {
    ...signal,
    uri: signalObjectUri(authority, signal.id),
    originUri: identityObjectUri(identityAuthority(), signal.origin),
    refUri: signal.refId ? signalObjectUri(authority, signal.refId) : null,
  };
}
