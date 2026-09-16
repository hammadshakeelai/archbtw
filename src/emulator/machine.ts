import { DownloadMeter, StallWatch } from "./downloads.ts";

export type MachineError = "download" | "stalled" | "no-wasm";

export type MachineState =
  | { kind: "idle" }
  /** Fetching the emulator and the snapshot; nothing on screen yet. */
  | { kind: "resuming"; downloadedMB: number; expectedMB: number }
  | { kind: "running"; downloadedMB: number }
  | { kind: "error"; error: MachineError; downloadedMB: number };

export interface DownloadProgress {
  file_name: string;
  loaded: number;
  total: number;
  lengthComputable: boolean;
}

/** The part of v86's V86 class the machine uses. */
export interface Emulator {
  add_listener(event: "download-progress", listener: (progress: DownloadProgress) => void): void;
  add_listener(event: "9p-read-start", listener: (args: [string]) => void): void;
  add_listener(event: "9p-read-end", listener: (args: [string, number]) => void): void;
  add_listener(event: "screen-put-char" | "screen-set-size", listener: (args: [number, number, number]) => void): void;
  add_listener(event: "download-error" | "emulator-started" | "screen-set-size", listener: () => void): void;
  keyboard_send_scancodes(codes: number[]): void;
  keyboard_send_text(text: string): void;
  keyboard_set_enabled(enabled: boolean): void;
  destroy(): Promise<void>;
}

export interface MachineDeps {
  create(options: Record<string, unknown>): Promise<Emulator>;
  hasWebAssembly(): boolean;
  now(): number;
  /** Calls `fn` every `ms` milliseconds and returns a function that stops it. */
  every(ms: number, fn: () => void): () => void;
  onState(state: MachineState): void;
  /** The guest read a file over 9p; the first read of a file downloads it. */
  onRead(name: string, bytes: number): void;
  /** The guest changed its screen size, so the page should fit the screen again. */
  onScreenSizeChange(): void;
}

export const STALL_MS = 60_000;
const STALL_CHECK_MS = 5_000;

export class Machine {
  private readonly deps: MachineDeps;
  private emulator: Emulator | null = null;
  private stopTimer: (() => void) | null = null;
  private state: MachineState = { kind: "idle" };
  private meter = new DownloadMeter();
  private stall = new StallWatch(STALL_MS);
  private generation = 0;

  constructor(deps: MachineDeps) {
    this.deps = deps;
  }

  get current(): MachineState {
    return this.state;
  }

  get guest(): Emulator | null {
    return this.emulator;
  }

  async start(options: Record<string, unknown>): Promise<void> {
    await this.teardown();
    const generation = this.generation;
    if (!this.deps.hasWebAssembly()) {
      this.setState({ kind: "error", error: "no-wasm", downloadedMB: 0 });
      return;
    }
    this.meter = new DownloadMeter();
    this.stall = new StallWatch(STALL_MS);
    this.setState({ kind: "resuming", downloadedMB: 0, expectedMB: 0 });

    const emulator = await this.deps.create(options);
    // A restart while v86 was still loading makes this emulator stale.
    if (generation !== this.generation) {
      await emulator.destroy();
      return;
    }
    this.emulator = emulator;

    emulator.add_listener("download-progress", (progress) => {
      this.meter.record(progress.file_name, progress.loaded, progress.lengthComputable ? progress.total : 0);
      this.stall.progress(progress.file_name, progress.loaded, progress.total, progress.lengthComputable, this.deps.now());
      if (this.state.kind === "resuming") {
        this.setState({ ...this.state, downloadedMB: this.meter.megabytes(), expectedMB: this.meter.expectedMegabytes() });
      } else if (this.state.kind === "running") {
        this.setState({ ...this.state, downloadedMB: this.meter.megabytes() });
      }
    });
    emulator.add_listener("download-error", () => this.fail("download"));
    emulator.add_listener("emulator-started", () => {
      if (this.state.kind === "resuming") this.setState({ kind: "running", downloadedMB: this.meter.megabytes() });
    });
    emulator.add_listener("9p-read-end", ([name, bytes]) => this.deps.onRead(name, bytes));
    emulator.add_listener("screen-set-size", () => this.deps.onScreenSizeChange());

    this.stopTimer = this.deps.every(STALL_CHECK_MS, () => {
      if (this.stall.isStalled(this.deps.now())) this.fail("stalled");
    });
  }

  async stop(): Promise<void> {
    await this.teardown();
    this.setState({ kind: "idle" });
  }

  sendScancodes(codes: number[]): void {
    this.emulator?.keyboard_send_scancodes(codes);
  }

  sendText(text: string): void {
    this.emulator?.keyboard_send_text(text);
  }

  setKeyboardEnabled(enabled: boolean): void {
    this.emulator?.keyboard_set_enabled(enabled);
  }

  private fail(error: MachineError): void {
    if (this.state.kind !== "resuming" && this.state.kind !== "running") return;
    this.setState({ kind: "error", error, downloadedMB: this.meter.megabytes() });
  }

  private async teardown(): Promise<void> {
    this.generation++;
    this.stopTimer?.();
    this.stopTimer = null;
    const emulator = this.emulator;
    this.emulator = null;
    if (emulator) await emulator.destroy();
  }

  private setState(state: MachineState): void {
    this.state = state;
    this.deps.onState(state);
  }
}
