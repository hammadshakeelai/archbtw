/**
 * The emulated machine, shared by the snapshot builder and the page.
 *
 * A state snapshot is a copy of this machine's memory and devices, so the page
 * must resume on exactly the hardware the snapshot was taken on. Keeping both
 * sides on one definition means they cannot drift.
 */

export const GUEST = {
  memorySize: 512 * 1024 * 1024,
  vgaMemorySize: 8 * 1024 * 1024,
  // v86's Arch recipe boots with ACPI off.
  acpi: false,
} as const;

/** Where the build puts the guest, relative to the site's images/ folder. */
export const IMAGE_PATHS = {
  /** Content-addressed, zstd-compressed files served over 9p. */
  tree: "arch/",
  /** The 9p inode tree. Only the snapshot boot needs it; the state carries its own copy. */
  fsJson: "fs.json",
  /** Memory and devices of the booted guest, zstd-compressed. */
  state: "arch_state.bin.zst",
} as const;

/** What the snapshot builder waits for: printed by /root/.bash_profile on tty1. */
export const READY_MARKER = "ARCHBTW_READY";

/** The shell prompt from /root/.bashrc, as it appears on screen. */
export const PROMPT = "[root@archbtw ~]#";

/**
 * Kernel command line for the one boot the snapshot builder does.
 *
 * `mitigations=off` because an emulated CPU gains nothing from speculative
 * execution defences and pays for them on every syscall. Kernel messages go to
 * the serial port too, so a failed CI boot leaves evidence in the log; tty1 is
 * listed last, which makes it /dev/console and keeps the visible screen clean.
 */
export function bootCmdline(debug = false): string {
  const root = "rw root=host9p rootfstype=9p rootflags=trans=virtio,version=9p2000.L,cache=loose";
  const quiet = debug
    ? "loglevel=7 systemd.show_status=true console=tty1 console=ttyS0"
    : "quiet loglevel=3 systemd.show_status=false rd.udev.log_level=3 console=ttyS0 console=tty1";
  // nomodeset keeps the console in VGA text mode: a framebuffer console is far
  // slower under emulation and has no text for the builder to check. A console
  // on ttyS0 makes systemd start a login prompt there too; nobody can reach
  // it, so it is masked.
  const machine = "nomodeset systemd.mask=serial-getty@ttyS0.service";
  return `${root} ${quiet} ${machine} mitigations=off nowatchdog`;
}
