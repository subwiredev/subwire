import { describe, expect, test } from "bun:test";
import {
  assertSubwireSlug,
  formatSubwireAddress,
  isSubwireAuthority,
  isValidSubwireSlug,
  parseSubwireAddress,
} from "../src/index.js";

describe("subwire slugs", () => {
  test("accepts url-friendly names", () => {
    for (const slug of ["news", "bounties", "announce", "meta", "ai-agents", "x0", "a".repeat(32)]) {
      expect(isValidSubwireSlug(slug)).toBe(true);
    }
  });

  test("rejects invalid shapes", () => {
    const bad = [
      "a", // too short
      "a".repeat(33), // too long
      "News", // uppercase
      "12.0", // legacy dial format
      "-news", // leading hyphen
      "news-", // trailing hyphen
      "ne ws",
      "ne/ws",
      "ne_ws",
      "",
      42,
      null,
      undefined,
    ];
    for (const slug of bad) {
      expect(isValidSubwireSlug(slug)).toBe(false);
    }
  });

  test("rejects the identities grammar collision", () => {
    expect(isValidSubwireSlug("identities")).toBe(false);
    expect(isValidSubwireSlug("identities-2")).toBe(true);
  });

  test("assertSubwireSlug throws with context", () => {
    expect(() => assertSubwireSlug("Bad Slug")).toThrow(/Invalid subwire slug/);
    expect(assertSubwireSlug("news")).toBe("news");
  });
});

describe("subwire addresses", () => {
  test("parses first-party and third-party addresses unambiguously", () => {
    expect(parseSubwireAddress("news")).toEqual({ authority: null, slug: "news" });
    expect(parseSubwireAddress("thirdparty.com/chan")).toEqual({
      authority: "thirdparty.com",
      slug: "chan",
    });
    expect(parseSubwireAddress("localhost:4001/news")).toEqual({
      authority: "localhost:4001",
      slug: "news",
    });
  });

  test("rejects malformed addresses", () => {
    for (const bad of ["", "a", "Thirdparty.com", "host/Bad Slug", "a/b/c", "host./chan", "12.0"]) {
      expect(parseSubwireAddress(bad)).toBeNull();
    }
  });

  test("authorities require a dot or port so they never collide with slugs", () => {
    expect(isSubwireAuthority("thirdparty.com")).toBe(true);
    expect(isSubwireAuthority("localhost:4001")).toBe(true);
    expect(isSubwireAuthority("localhost")).toBe(false);
    expect(isSubwireAuthority("news")).toBe(false);
  });

  test("round-trips through format", () => {
    expect(formatSubwireAddress(null, "news")).toBe("news");
    expect(formatSubwireAddress("thirdparty.com", "chan")).toBe("thirdparty.com/chan");
  });
});
