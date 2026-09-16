import { describe, expect, it } from "vitest";
import { releaseModifiers } from "../input/keys.ts";
import { Machine, STALL_MS, type DownloadProgress, type Emulator, type MachineState } from "./machine.ts";

type Listener = (payload: unknown) => void;

class FakeEmulator {
  listeners = new Map<string, Listener[]>();
  destroyed = false;
  scancodes: number[][] = [];
  keyboardEnabled = true;

  add_listener(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
  keyboard_send_scancodes(codes: number[]): void {
    this.scancodes.push(codes);
  }
  keyboard_send_text(): void {}
  keyboard_set_enabled(enabled: boolean): void {
    this.keyboardEnabled = enabled;
  }
  async destroy(): Promise<void> {
    this.destroyed = true;
  }
}

function setup(options: { wasm?: boolean } = {}) {
  const states: MachineState[] = [];
  const reads: [string, number][] = [];
  const emulators: FakeEmulator[] = [];
  let now = 0;
  let tick: (() => void) | null = null;
  const pending: (() => void)[] = [];
  const machine = new Machine({
    create: async () => {
      const emulator = new FakeEmulator();
      emulators.push(emulator);
      return emulator as unknown as Emulator;
    },
    hasWebAssembly: () => options.wasm ?? true,
    now: () => now,
    every: (_ms, fn) => {
      tick = fn;
      return () => {
        tick = null;
      };
    },
    later: (_ms, fn) => {
      pending.push(fn);
    },
    onState: (state) => states.push(state),
    onRead: (name, bytes) => reads.push([name, bytes]),
    onScreenSizeChange: () => {},
  });
  return {
    machine,
    states,
    reads,
    emulators,
    advance: (ms: number) => {
      now += ms;
      tick?.();
    },
    /** Run every `later` callback scheduled so far. */
    settle: () => {
      for (const fn of pending.splice(0)) fn();
    },
  };
}

const MB = 1024 * 1024;

const progress = (loaded: number, total: number): DownloadProgress => ({
  file_name: "arch_state.bin.zst",
  loaded,
  total,
  lengthComputable: true,
});

describe("Machine", () => {
  it("reports no-wasm without creating an emulator", async () => {
    const { machine, states, emulators } = setup({ wasm: false });
    await machine.start({});
    expect(states.at(-1)).toEqual({ kind: "error", error: "no-wasm", downloadedMB: 0 });
    expect(emulators).toHaveLength(0);
  });

  it("resumes, counts the download, then runs", async () => {
    const { machine, states, emulators } = setup();
    await machine.start({});
    expect(states.at(-1)?.kind).toBe("resuming");
    emulators[0].emit("download-progress", progress(4 * MB, 16 * MB));
    expect(states.at(-1)).toEqual({ kind: "resuming", downloadedMB: 4, expectedMB: 16 });
    emulators[0].emit("emulator-started");
    expect(states.at(-1)).toEqual({ kind: "running", downloadedMB: 4 });
  });

  it("passes 9p reads through", async () => {
    const { machine, reads, emulators } = setup();
    await machine.start({});
    emulators[0].emit("9p-read-end", ["sl", 18_000]);
    expect(reads).toEqual([["sl", 18_000]]);
  });

  it("stops with an error when a download stalls", async () => {
    const { machine, states, emulators, advance } = setup();
    await machine.start({});
    emulators[0].emit("download-progress", progress(1024, 16 * MB));
    advance(STALL_MS);
    expect(states.at(-1)).toMatchObject({ kind: "error", error: "stalled" });
  });

  it("destroys the old emulator on restart", async () => {
    const { machine, emulators } = setup();
    await machine.start({});
    await machine.start({});
    expect(emulators[0].destroyed).toBe(true);
    expect(emulators[1].destroyed).toBe(false);
  });

  it("forwards key presses to the guest", async () => {
    const { machine, emulators } = setup();
    await machine.start({});
    machine.sendScancodes([0x01, 0x81]);
    expect(emulators[0].scancodes).toEqual([[0x01, 0x81]]);
  });

  it("releases held modifiers when taking the keyboard away, and again once v86's delayed Ctrl has gone", async () => {
    const { machine, emulators, settle } = setup();
    await machine.start({});
    machine.setKeyboardEnabled(false);
    expect(emulators[0].scancodes).toEqual([releaseModifiers()]);
    expect(emulators[0].keyboardEnabled).toBe(false);

    settle();
    expect(emulators[0].scancodes).toEqual([releaseModifiers(), releaseModifiers()]);

    // Focus moving between two buttons changes nothing.
    machine.setKeyboardEnabled(false);
    settle();
    expect(emulators[0].scancodes).toHaveLength(2);
  });

  it("skips the delayed release if the terminal took the keyboard back first", async () => {
    const { machine, emulators, settle } = setup();
    await machine.start({});
    machine.setKeyboardEnabled(false);
    machine.setKeyboardEnabled(true);
    settle();
    expect(emulators[0].scancodes).toEqual([releaseModifiers()]);
    expect(emulators[0].keyboardEnabled).toBe(true);
  });

  it("gives a restarted machine the keyboard, and doesn't touch the old one", async () => {
    const { machine, emulators, settle } = setup();
    await machine.start({});
    machine.setKeyboardEnabled(false);
    await machine.start({});
    settle();
    expect(emulators[0].scancodes).toEqual([releaseModifiers()]);

    machine.setKeyboardEnabled(false);
    expect(emulators[1].scancodes).toEqual([releaseModifiers()]);
  });
});
