import { describe, expect, it } from "vitest";
import { nonBlankRows, textRows } from "./vga.ts";

/** Lay text out as VGA memory: a character byte then a colour byte per cell. */
function vgaMemory(rows: string[], columns = 80): Uint8Array {
  const memory = new Uint8Array(rows.length * columns * 2);
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      memory[(y * columns + x) * 2] = char.charCodeAt(0);
      memory[(y * columns + x) * 2 + 1] = 0x07;
    });
  });
  return memory;
}

describe("textRows", () => {
  it("reads character bytes and skips attribute bytes", () => {
    expect(textRows(vgaMemory(["[root@archbtw ~]#", "hello"]))).toEqual(["[root@archbtw ~]#", "hello"]);
  });

  it("shows non-printable and code page 437 graphics bytes as spaces", () => {
    const memory = vgaMemory(["ab"]);
    memory[2] = 0xdb; // a full block
    expect(textRows(memory, 80)[0]).toBe("a");
  });
});

describe("nonBlankRows", () => {
  it("drops empty rows", () => {
    expect(nonBlankRows(vgaMemory(["", "prompt", ""]))).toEqual(["prompt"]);
  });
});
