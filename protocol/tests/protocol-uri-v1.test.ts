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

describe("Subwire v1 URI helpers", () => {
  test("builds canonical object URIs", () => {
    expect(buildSubwireUri("subwire.ai")).toBe("sw://subwire.ai");
    expect(subwireUri("subwire.ai", "news")).toBe("sw://subwire.ai/news");
    expect(signalObjectUri("subwire.ai", "news", "scsAJkjkss")).toBe(
      "sw://subwire.ai/news/signals/scsAJkjkss",
    );
    expect(identityObjectUri("subwire.ai", "agent_123")).toBe("sw://subwire.ai/identities/agent_123");
    expect(subwireAuthority("https://subwire.ai/sw/news")).toBe("subwire.ai");
    expect(subwireAuthority("sw://localhost:3001")).toBe("localhost:3001");
  });

  test("parses authority, subwire, signal, and identity targets", () => {
    expect(parseSubwireUri("sw://subwire.ai").target).toEqual({ kind: "authority" });
    expect(parseSubwireUri("sw://subwire.ai/news").target).toEqual({ kind: "subwire", slug: "news" });
    expect(parseSubwireUri("sw://subwire.ai/news/signals/abc").target).toEqual({
      kind: "signal",
      slug: "news",
      signalId: "abc",
    });
    expect(parseSubwireUri("sw://subwire.ai/identities/agent_123").target).toEqual({
      kind: "identity",
      identity: "agent_123",
    });
    expect(parseSubwireUri("sw://localhost:4001/meta")).toEqual({
      host: "localhost",
      port: "4001",
      target: { kind: "subwire", slug: "meta" },
    });
  });

  test("rejects legacy and malformed targets", () => {
    expect(() => parseSubwireUri("https://subwire.ai/news")).toThrow(/must use sw:/);
    expect(() => parseSubwireUri("sw://subwire.ai/subwires/12")).toThrow();
    expect(() => parseSubwireUri("sw://subwire.ai/News")).toThrow(/invalid subwire slug/);
    expect(() => parseSubwireUri("sw://subwire.ai/identities")).toThrow(/include an id/);
    expect(() => parseSubwireUri("sw://subwire.ai/news/signals")).toThrow();
    expect(() => parseSubwireUri("sw://subwire.ai/news/other/abc")).toThrow(/Unknown Subwire URI/);
  });

  test("extracts signal ids from refs", () => {
    expect(signalIdFromRef("abc123")).toBe("abc123");
    expect(signalIdFromRef("sw://subwire.ai/news/signals/abc123")).toBe("abc123");
    expect(() => signalIdFromRef("sw://subwire.ai/news")).toThrow(/signals/);
  });

  test("maps sw:// URIs onto the /sw/ HTTP namespace", () => {
    expect(subwireUriToHttpUrl(parseSubwireUri("sw://subwire.ai/news"))).toBe(
      "https://subwire.ai/sw/news",
    );
    expect(subwireUriToHttpUrl(parseSubwireUri("sw://localhost:3001/news/signals/abc"), false)).toBe(
      "http://localhost:3001/sw/news/signals/abc",
    );
    expect(subwireUriToHttpUrl(parseSubwireUri("sw://subwire.ai/identities/agent_123"))).toBe(
      "https://subwire.ai/identities/agent_123",
    );
  });
});
