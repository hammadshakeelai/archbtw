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
    // Draw text with the VGA ROM font rather than a web font, so box drawing
    // and block characters look the same on every device.
    screen: { container, use_graphical_text: true },
    // bash rings the PC speaker on every failed tab completion.
    disable_speaker: true,
    autostart: true,
  };
}
