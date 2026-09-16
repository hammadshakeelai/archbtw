import { GUEST, IMAGE_PATHS } from "./guest.ts";

export interface Runtime {
  /** Where the bundler put v86.wasm. */
  wasmUrl: string;
  /** The site's base path, ending in a slash. */
  base: string;
}

/**
 * v86 options for resuming the guest.
 *
 * No `basefs` and no kernel: the snapshot already holds the booted kernel and
 * the 9p inode table, so v86 only needs to know where file contents live.
 */
export function v86Options(runtime: Runtime, container: HTMLElement): Record<string, unknown> {
  const images = `${runtime.base}images/`;
  return {
    wasm_path: runtime.wasmUrl,
    bios: { url: `${runtime.base}bios/seabios.bin` },
    vga_bios: { url: `${runtime.base}bios/vgabios.bin` },
    memory_size: GUEST.memorySize,
    vga_memory_size: GUEST.vgaMemorySize,
    acpi: GUEST.acpi,
    filesystem: { baseurl: images + IMAGE_PATHS.tree },
    initial_state: { url: images + IMAGE_PATHS.state },
    // Text as DOM rows rather than v86's canvas renderer: after a snapshot
    // restore the canvas renderer repainted only the cursor row, leaving the
    // MOTD blank. DOM text also lets visitors select and copy output.
    screen: { container, use_graphical_text: false },
    // bash rings the PC speaker on every failed tab completion.
    disable_speaker: true,
    autostart: true,
  };
}
