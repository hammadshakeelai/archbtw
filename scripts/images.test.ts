import { describe, expect, it } from "vitest";
import { parseLock } from "./images.ts";

const valid = {
  tag: "guest-20260917-2",
  asset: "archbtw-images.tar",
  url: "https://github.com/hammadshakeelai/archbtw/releases/download/guest-20260917-2/archbtw-images.tar",
  sha256: "a".repeat(64),
  bytes: 230_000_000,
};

describe("parseLock", () => {
  it("accepts a lock written by the guest workflow", () => {
    expect(parseLock(JSON.stringify(valid))).toEqual(valid);
  });

  it("only downloads from GitHub", () => {
    expect(() => parseLock(JSON.stringify({ ...valid, url: "https://example.com/x.tar" }))).toThrow(/GitHub/);
  });

  it.each([
    ["a lookalike host", "https://github.com.evil.example/o/r/releases/download/t/a.tar"],
    ["credentials that hide the real host", "https://github.com@evil.example/o/r/releases/download/t/a.tar"],
    ["plain http", "http://github.com/o/r/releases/download/t/a.tar"],
    ["a page that isn't a release download", "https://github.com/o/r/blob/main/a.tar"],
    ["a path that climbs out", "https://github.com/o/r/releases/download/../../a.tar"],
  ])("rejects %s", (_, url) => {
    expect(() => parseLock(JSON.stringify({ ...valid, url }))).toThrow(/GitHub/);
  });

  it("rejects a malformed checksum", () => {
    expect(() => parseLock(JSON.stringify({ ...valid, sha256: "ABC" }))).toThrow(/sha256/);
  });
});
