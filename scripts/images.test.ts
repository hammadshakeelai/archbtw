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

  it("rejects a malformed checksum", () => {
    expect(() => parseLock(JSON.stringify({ ...valid, sha256: "ABC" }))).toThrow(/sha256/);
  });
});
