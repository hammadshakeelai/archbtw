import { describe, expect, it } from "vitest";
import { fitScale, isWholeScale, MIN_SCALE, screenScale } from "./fit.ts";

describe("fitScale", () => {
  it("scales up to fill the tighter side", () => {
    expect(fitScale({ width: 1440, height: 1000 }, { width: 720, height: 400 })).toBe(2);
  });

  it("scales down and keeps the aspect ratio", () => {
    expect(fitScale({ width: 512, height: 600 }, { width: 1024, height: 768 })).toBe(0.5);
  });

  it("leaves the scale at 1 before anything is drawn", () => {
    expect(fitScale({ width: 800, height: 600 }, { width: 0, height: 0 })).toBe(1);
    expect(fitScale({ width: 0, height: 0 }, { width: 640, height: 480 })).toBe(1);
  });
});

describe("screenScale", () => {
  const vga = { width: 720, height: 400 };

  it("uses a whole number when that keeps most of the space", () => {
    expect(screenScale({ width: 1500, height: 1000 }, vga)).toBe(2);
  });

  it("keeps a fractional scale when rounding down would waste too much", () => {
    // fit is 1.85; dropping to 1 would leave nearly half the screen empty.
    expect(screenScale({ width: 1332, height: 740 }, vga)).toBeCloseTo(1.85, 2);
  });

  it("shrinks to fit a small window", () => {
    expect(screenScale({ width: 540, height: 400 }, vga)).toBe(0.75);
  });

  it("never drops below the legible minimum, so a phone pans instead", () => {
    expect(screenScale({ width: 360, height: 640 }, vga)).toBe(MIN_SCALE);
  });

  it("reports whole scales", () => {
    expect(isWholeScale(2)).toBe(true);
    expect(isWholeScale(1.85)).toBe(false);
  });
});
