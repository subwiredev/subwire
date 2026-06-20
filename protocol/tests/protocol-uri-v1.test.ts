import { describe, expect, test } from "bun:test";
import {
  buildSubwireUri,
  subwireUri,
  identityObjectUri,
  parseSubwireUri,
  signalIdFromRef,
  signalObjectUri,
  subwireAuthority,
  subwireUriToHttpUrl,
} from "../src/index.js";

describe("Subwire URI helpers", () => {
  test("builds canonical object URIs", () => {
    expect(buildSubwireUri("subwire.ai")).toBe("sw://subwire.ai");
    expect(subwireUri("subwire.ai")).toBe("sw://subwire.ai");
    expect(signalObjectUri("subwire.ai", "scsAJkjkss")).toBe("sw://subwire.ai/signals/scsAJkjkss");
    expect(identityObjectUri("subwire.ai", "agent_123")).toBe("sw://subwire.ai/identities/agent_123");
    expect(subwireAuthority("https://subwire.ai/sw")).toBe("subwire.ai");
    expect(subwireAuthority("sw://localhost:3001")).toBe("localhost:3001");
  });

  test("parses subwire, signal, and identity targets", () => {
    expect(parseSubwireUri("sw://subwire.ai").target).toEqual({ kind: "subwire" });
    expect(parseSubwireUri("sw://subwire.ai/signals/abc").target).toEqual({
      kind: "signal",
      signalId: "abc",
    });
    expect(parseSubwireUri("sw://subwire.ai/identities/agent_123").target).toEqual({
      kind: "identity",
      identity: "agent_123",
    });
    expect(parseSubwireUri("sw://localhost:4001")).toEqual({
      host: "localhost",
      port: "4001",
      target: { kind: "subwire" },
    });
  });

  test("rejects malformed targets", () => {
    expect(() => parseSubwireUri("https://subwire.ai/signals/x")).toThrow(/must use sw:/);
    expect(() => parseSubwireUri("sw://subwire.ai/news")).toThrow(/Unknown Subwire URI/);
    expect(() => parseSubwireUri("sw://subwire.ai/identities")).toThrow();
    expect(() => parseSubwireUri("sw://subwire.ai/signals")).toThrow();
    expect(() => parseSubwireUri("sw://subwire.ai/signals/abc/extra")).toThrow();
  });

  test("extracts signal ids from refs", () => {
    expect(signalIdFromRef("abc123")).toBe("abc123");
    expect(signalIdFromRef("sw://subwire.ai/signals/abc123")).toBe("abc123");
    expect(() => signalIdFromRef("sw://subwire.ai")).toThrow(/signal/);
  });

  test("maps sw:// URIs onto the /sw/ HTTP namespace", () => {
    expect(subwireUriToHttpUrl(parseSubwireUri("sw://subwire.ai"))).toBe("https://subwire.ai/sw");
    expect(subwireUriToHttpUrl(parseSubwireUri("sw://localhost:3001/signals/abc"), false)).toBe(
      "http://localhost:3001/sw/signals/abc",
    );
    expect(subwireUriToHttpUrl(parseSubwireUri("sw://subwire.ai/identities/agent_123"))).toBe(
      "https://subwire.ai/identities/agent_123",
    );
  });
});
