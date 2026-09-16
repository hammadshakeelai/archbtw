import { describe, expect, it } from "vitest";
import { v86Options } from "./config.ts";
import { GUEST } from "./guest.ts";

describe("v86Options", () => {
  const container = {} as HTMLElement;
  const options = v86Options({ wasmUrl: "/archbtw/_astro/v86.wasm", base: "/archbtw/" }, container);

  it("resumes from the snapshot and serves files over 9p under the base path", () => {
    expect(options.initial_state).toEqual({ url: "/archbtw/images/arch_state.bin.zst" });
    expect(options.filesystem).toEqual({ baseurl: "/archbtw/images/arch/" });
  });

  it("doesn't boot a kernel, because the snapshot is already booted", () => {
    expect(options).not.toHaveProperty("bzimage_initrd_from_filesystem");
    expect(options).not.toHaveProperty("cmdline");
  });

  it("uses the same machine the snapshot was taken on", () => {
    expect(options.memory_size).toBe(GUEST.memorySize);
    expect(options.vga_memory_size).toBe(GUEST.vgaMemorySize);
    expect(options.acpi).toBe(GUEST.acpi);
  });

  it("finds the BIOS under the base path", () => {
    expect(options.bios).toEqual({ url: "/archbtw/bios/seabios.bin" });
    expect(options.vga_bios).toEqual({ url: "/archbtw/bios/vgabios.bin" });
  });
});
