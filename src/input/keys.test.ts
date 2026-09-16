import { describe, expect, it } from "vitest";
import { chord, interpretInput, isUnidentified, sendsAsText, tap } from "./keys.ts";

describe("tap", () => {
  it("presses and releases a plain key", () => {
    expect(tap("Escape")).toEqual([0x01, 0x81]);
    expect(tap("Tab")).toEqual([0x0f, 0x8f]);
  });

  it("keeps the 0xE0 prefix on both halves of an extended key", () => {
    expect(tap("ArrowUp")).toEqual([0xe0, 0x48, 0xe0, 0xc8]);
  });
});

describe("chord", () => {
  it("holds Ctrl around a letter", () => {
    expect(chord("ctrl", "c")).toEqual([0x1d, 0x2e, 0xae, 0x9d]);
  });

  it("treats capitals like lowercase", () => {
    expect(chord("alt", "F")).toEqual(chord("alt", "f"));
  });

  it("refuses anything but a single letter", () => {
    expect(chord("ctrl", "1")).toBeNull();
    expect(chord("ctrl", "cd")).toBeNull();
  });
});

describe("interpretInput", () => {
  it("sends typed text", () => {
    expect(interpretInput("insertText", "ls")).toEqual({ kind: "text", text: "ls" });
  });

  it("turns Enter and Backspace into key presses", () => {
    expect(interpretInput("insertLineBreak", null)).toEqual({ kind: "scancodes", codes: tap("Enter") });
    expect(interpretInput("deleteContentBackward", null)).toEqual({ kind: "scancodes", codes: tap("Backspace") });
  });

  it("ignores composition updates, which repeat the word typed so far", () => {
    expect(interpretInput("insertCompositionText", "hel")).toEqual({ kind: "ignore" });
  });
});

describe("isUnidentified", () => {
  it("recognises Android's placeholder keydown", () => {
    expect(isUnidentified({ key: "Unidentified", keyCode: 229 })).toBe(true);
  });

  it("leaves real keydowns to v86", () => {
    expect(isUnidentified({ key: "a", keyCode: 65 })).toBe(false);
  });
});

describe("sendsAsText", () => {
  const key = (key: string, extra: Partial<KeyboardEvent> = {}) => ({
    key,
    keyCode: 0,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...extra,
  });

  it("sends shifted symbols as text so they keep their Shift", () => {
    expect(sendsAsText(key("$", { keyCode: 52 }))).toBe(true);
    expect(sendsAsText(key("|"))).toBe(true);
  });

  it("leaves named keys and shortcuts to v86", () => {
    expect(sendsAsText(key("Enter"))).toBe(false);
    expect(sendsAsText(key("Backspace"))).toBe(false);
    expect(sendsAsText(key("c", { ctrlKey: true }))).toBe(false);
  });

  it("leaves unidentified keydowns to the input event", () => {
    expect(sendsAsText(key("Unidentified", { keyCode: 229 }))).toBe(false);
  });
});
