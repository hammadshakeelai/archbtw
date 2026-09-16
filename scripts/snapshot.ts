/**
 * Boot the built guest once, headless, and save it as the snapshot visitors
 * resume from.
 *
 *   node scripts/snapshot.ts [build/out]
 *
 * Reads build/out/fs.json and build/out/arch/ from scripts/rootfs.sh and writes
 * build/out/arch_state.bin.zst. Set ARCHBTW_DEBUG=1 to send the whole boot log
 * to the serial port, which this script prints.
 */

import { V86 } from "v86";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { constants, zstdCompressSync } from "node:zlib";
import { bootCmdline, GUEST, IMAGE_PATHS, PROMPT, READY_MARKER } from "../src/lib/guest.ts";
import { nonBlankRows, VGA_TEXT_BASE, VGA_TEXT_WINDOW } from "../src/lib/vga.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(process.argv[2] ?? join(ROOT, "build", "out"));
const DEBUG = process.env.ARCHBTW_DEBUG === "1";
const BOOT_TIMEOUT_MS = Number(process.env.BOOT_TIMEOUT_MINUTES ?? 30) * 60_000;
const PROMPT_TIMEOUT_MS = 120_000;

const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;

const emulator = new V86({
  wasm_path: fileURLToPath(import.meta.resolve("v86/build/v86.wasm")),
  bios: { url: join(ROOT, "public", "bios", "seabios.bin") },
  vga_bios: { url: join(ROOT, "public", "bios", "vgabios.bin") },
  memory_size: GUEST.memorySize,
  vga_memory_size: GUEST.vgaMemorySize,
  acpi: GUEST.acpi,
  filesystem: {
    baseurl: join(OUT, IMAGE_PATHS.tree) + "/",
    basefs: join(OUT, IMAGE_PATHS.fsJson),
  },
  bzimage_initrd_from_filesystem: true,
  cmdline: bootCmdline(DEBUG),
  disable_speaker: true,
  autostart: true,
  log_level: 0,
});

let serial = "";
let serialLine = "";
emulator.add_listener("serial0-output-byte", (byte: number) => {
  const char = String.fromCharCode(byte);
  serial += char;
  if (char === "\n") {
    console.log(`  [serial ${elapsed()}] ${serialLine.replace(/\r/g, "")}`);
    serialLine = "";
  } else {
    serialLine += char;
  }
});

let filesRead = 0;
let bytesRead = 0;
// v86 sends multi-value events as one array.
emulator.add_listener("9p-read-end", ([, count]: [string, number]) => {
  filesRead++;
  bytesRead += count;
});

function screen(): string[] {
  return nonBlankRows(emulator.read_memory(VGA_TEXT_BASE, VGA_TEXT_WINDOW));
}

function dumpScreen(title: string): void {
  console.log(`\n--- ${title} ---`);
  for (const row of screen()) console.log(`  | ${row}`);
  console.log("---");
}

async function waitFor(what: string, timeoutMs: number, check: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastReport = Date.now();
  while (Date.now() < deadline) {
    if (check()) return true;
    if (Date.now() - lastReport >= 30_000) {
      lastReport = Date.now();
      console.log(`  ${elapsed()}: waiting for ${what}; ${filesRead} files / ${(bytesRead / 1e6).toFixed(1)} MB read over 9p`);
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  return false;
}

async function fail(message: string): Promise<never> {
  console.error(`\nERROR: ${message}`);
  dumpScreen("screen at failure");
  await emulator.destroy();
  process.exit(1);
}

console.log(`Booting ${OUT} under v86 (timeout ${BOOT_TIMEOUT_MS / 60_000} min)`);
console.log(`  cmdline: ${bootCmdline(DEBUG)}`);

if (!(await waitFor("the shell on tty1", BOOT_TIMEOUT_MS, () => serial.includes(READY_MARKER)))) {
  await fail(`the guest never reached a shell on tty1 within ${BOOT_TIMEOUT_MS / 60_000} minutes`);
}
console.log(`\nShell started after ${elapsed()}`);

// The marker is printed from .bash_profile, just before bash draws its prompt.
if (!(await waitFor("the prompt on screen", PROMPT_TIMEOUT_MS, () => screen().some((row) => row.includes(PROMPT))))) {
  await fail(`the shell started but "${PROMPT}" never appeared on screen`);
}
// Let the console settle so the snapshot shows a still screen.
await new Promise((done) => setTimeout(done, 3_000));
dumpScreen("screen in the snapshot");

await emulator.stop();
const state = new Uint8Array(await emulator.save_state());
await emulator.destroy();

const compressed = zstdCompressSync(state, {
  params: { [constants.ZSTD_c_compressionLevel]: 19 },
});
await mkdir(OUT, { recursive: true });
const statePath = join(OUT, IMAGE_PATHS.state);
await writeFile(statePath, compressed);

const report = {
  bootSeconds: Math.round((Date.now() - started) / 1000),
  filesReadDuringBoot: filesRead,
  bytesReadDuringBoot: bytesRead,
  stateBytes: state.byteLength,
  compressedStateBytes: (await stat(statePath)).size,
};
await writeFile(join(OUT, "snapshot-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nWrote ${statePath}`);
console.log(JSON.stringify(report, null, 2));
process.exit(0);
