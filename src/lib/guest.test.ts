import { describe, expect, it } from "vitest";
import { bootCmdline } from "./guest.ts";

describe("bootCmdline", () => {
  it("mounts root from v86's 9p share", () => {
    expect(bootCmdline()).toContain("root=host9p rootfstype=9p rootflags=trans=virtio");
  });

  it("keeps tty1 as the console so the visible screen stays clean", () => {
    const consoles = bootCmdline().match(/console=\S+/g);
    expect(consoles?.at(-1)).toBe("console=tty1");
  });

  it("sends the console to serial in debug mode, where the builder can print it", () => {
    const consoles = bootCmdline(true).match(/console=\S+/g);
    expect(consoles?.at(-1)).toBe("console=ttyS0");
    expect(bootCmdline(true)).not.toContain("quiet");
  });
});
