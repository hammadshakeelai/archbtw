import { describe, expect, it } from "vitest";
import { TextScreen } from "./vga.ts";

function write(screen: TextScreen, row: number, text: string): void {
  [...text].forEach((char, col) => screen.put([row, col, char.charCodeAt(0)]));
}

describe("TextScreen", () => {
  it("rebuilds rows from put-char events", () => {
    const screen = new TextScreen();
    write(screen, 0, "[root@archbtw ~]#");
    write(screen, 2, "hello");
    expect(screen.rows().slice(0, 3)).toEqual(["[root@archbtw ~]#", "", "hello"]);
  });

  it("overwrites a cell when the guest redraws it", () => {
    const screen = new TextScreen();
    write(screen, 0, "cat");
    write(screen, 0, "b");
    expect(screen.rows()[0]).toBe("bat");
  });

  it("shows code page 437 graphics as spaces", () => {
    const screen = new TextScreen();
    screen.put([0, 0, 0x61]);
    screen.put([0, 1, 0xdb]); // a full block
    screen.put([0, 2, 0x62]);
    expect(screen.rows()[0]).toBe("a b");
  });

  it("clears and resizes on a text mode change", () => {
    const screen = new TextScreen();
    write(screen, 0, "old");
    screen.resize([80, 50, 0]);
    expect(screen.rows()).toHaveLength(50);
    expect(screen.text().trim()).toBe("");
  });

  it("notes a graphics mode, where there is no text", () => {
    const screen = new TextScreen();
    screen.resize([1024, 768, 32]);
    expect(screen.graphical).toBe(true);
    screen.resize([80, 25, 0]);
    expect(screen.graphical).toBe(false);
  });

  it("ignores characters outside the screen", () => {
    const screen = new TextScreen();
    screen.put([30, 0, 0x61]);
    screen.put([0, 90, 0x61]);
    expect(screen.text().trim()).toBe("");
  });
});
