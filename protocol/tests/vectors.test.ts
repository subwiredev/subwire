/**
 * Conformance: the TypeScript binding must agree with vectors/ exactly.
 * The vectors are the language-neutral contract — a Go/Rust/Python
 * implementation of the protocol runs these same files. If a code change
 * breaks one of these, that is a protocol change and needs a spec edit,
 * not a vector edit.
 */
import { describe, expect, test } from "bun:test";
import uris from "../vectors/uris.json";
import { parseSubwireUri, subwireUriToHttpUrl } from "../src/index.js";

describe("vectors/uris.json", () => {
  for (const c of uris.cases) {
    test(`parse: ${c.input}`, () => {
      const parsed = parseSubwireUri(c.input);
      expect(parsed).toEqual(c.expect as ReturnType<typeof parseSubwireUri>);
      expect(subwireUriToHttpUrl(parsed)).toBe(c.httpsUrl);
    });
  }
  for (const input of uris.errors) {
    test(`rejects: ${input}`, () => {
      expect(() => parseSubwireUri(input)).toThrow();
    });
  }
});
