import { describe, expect, it } from "vitest";
import { DownloadMeter, StallWatch } from "./downloads.ts";

const MB = 1024 * 1024;

describe("DownloadMeter", () => {
  it("adds the latest byte count of every file", () => {
    const meter = new DownloadMeter();
    meter.record("a", 1 * MB);
    meter.record("a", 2 * MB);
    meter.record("b", 1 * MB);
    expect(meter.megabytes()).toBe(3);
  });

  it("ignores a lower count for a file", () => {
    const meter = new DownloadMeter();
    meter.record("a", 2 * MB);
    meter.record("a", 1 * MB);
    expect(meter.megabytes()).toBe(2);
  });
});

describe("StallWatch", () => {
  it("fires when a started download gets no bytes for 60 seconds", () => {
    const watch = new StallWatch(60_000);
    watch.progress("disk", 100, 1000, true, 0);
    expect(watch.isStalled(59_999)).toBe(false);
    expect(watch.isStalled(60_000)).toBe(true);
  });

  it("restarts the clock when new bytes arrive", () => {
    const watch = new StallWatch(60_000);
    watch.progress("disk", 100, 1000, true, 0);
    watch.progress("disk", 200, 1000, true, 50_000);
    expect(watch.isStalled(100_000)).toBe(false);
    expect(watch.isStalled(110_000)).toBe(true);
  });

  it("never fires for a finished download", () => {
    const watch = new StallWatch(60_000);
    watch.progress("disk", 100, 1000, true, 0);
    watch.progress("disk", 1000, 1000, true, 1_000);
    expect(watch.isStalled(1_000_000)).toBe(false);
  });

  it("never fires for a download of unknown length", () => {
    const watch = new StallWatch(60_000);
    watch.progress("disk", 100, 0, false, 0);
    expect(watch.isStalled(1_000_000)).toBe(false);
  });

  it("never fires while nothing is downloading", () => {
    expect(new StallWatch(60_000).isStalled(1_000_000)).toBe(false);
  });
});
