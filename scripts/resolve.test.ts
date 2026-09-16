import { describe, expect, it } from "vitest";
import { depName, parseDesc, resolve } from "./resolve.mjs";

describe("depName", () => {
  it("strips version constraints", () => {
    expect(depName("glibc>=2.38")).toBe("glibc");
    expect(depName("sh")).toBe("sh");
  });
});

describe("parseDesc", () => {
  it("reads pacman database fields", () => {
    const fields = parseDesc("%NAME%\nsl\n\n%DEPENDS%\nncurses\nglibc>=2.38\n\n%ISIZE%\n30000\n");
    expect(fields).toEqual({ NAME: ["sl"], DEPENDS: ["ncurses", "glibc>=2.38"], ISIZE: ["30000"] });
  });
});

describe("resolve", () => {
  const pkg = (name: string, depends: string[] = []) => ({ name, depends, installedSize: 1 });
  const byName = new Map([
    ["sl", pkg("sl", ["ncurses"])],
    ["ncurses", pkg("ncurses", ["sh"])],
    ["bash", pkg("bash")],
  ]);
  const provides = new Map([["sh", "bash"]]);

  it("follows dependencies and virtual names", () => {
    const { chosen, missing } = resolve(["sl"], { byName, provides });
    expect([...chosen.keys()].sort()).toEqual(["bash", "ncurses", "sl"]);
    expect(missing.size).toBe(0);
  });

  it("collects names nothing provides", () => {
    expect([...resolve(["nope"], { byName, provides }).missing]).toEqual(["nope"]);
  });
});
