import wasmUrl from "v86/build/v86.wasm?url";
import { v86Options } from "../lib/config.ts";
import { textRows, VGA_TEXT_BASE, VGA_TEXT_WINDOW } from "../lib/vga.ts";
import { Machine, type Emulator, type MachineState } from "../emulator/machine.ts";
import { createScreen, fitScreen, type ScreenElements } from "../emulator/screen.ts";
import { chord, interpretInput, isUnidentified, tap, type Modifier, type SpecialKey } from "../input/keys.ts";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

const stage = element("stage");
const base = stage.dataset.base ?? "/";
const bootCursor = element("boot-cursor");
const notice = element("notice");
const noticeText = element("notice-text");
const retry = element<HTMLButtonElement>("retry");
const phoneKeyboard = element<HTMLTextAreaElement>("phone-keyboard");
const keybar = element("keybar");
const progress = element("progress");
const stateLabel = element("state");
const reading = element("reading");
const fetched = element("fetched");
const fullscreenButton = element<HTMLButtonElement>("fullscreen");
const restartButton = element<HTMLButtonElement>("restart");

const touch = matchMedia("(pointer: coarse)").matches;
keybar.hidden = !touch;

let screen: ScreenElements = createScreen(document);

// ------------------------------------------------------------------ status line

const ERRORS: Record<string, string> = {
  download: "The machine's files didn't finish downloading. Check your connection, then try again.",
  stalled: "The download stopped making progress. Try again, or reload the page.",
  "no-wasm":
    "This browser can't run the emulator because it doesn't support WebAssembly. Open this page in a current version of Firefox, Chrome, Safari or Edge.",
};

/** Roughly what resuming downloads: the emulator, the BIOS and the compressed snapshot. */
const RESUME_ESTIMATE_MB = 20;

function formatMB(megabytes: number): string {
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

function render(state: MachineState): void {
  const failed = state.kind === "error";
  notice.hidden = !failed;
  bootCursor.hidden = state.kind !== "resuming";
  screen.sizer.hidden = failed;
  restartButton.hidden = state.kind === "error" && state.error === "no-wasm";

  if (state.kind === "error") {
    notice.dataset.tone = "error";
    noticeText.textContent = ERRORS[state.error];
    retry.hidden = state.error === "no-wasm";
    stateLabel.textContent = state.error === "no-wasm" ? "Can't run here" : "Stopped";
    progress.style.width = "0";
    return;
  }
  if (state.kind === "idle") return;

  fetched.textContent = `${formatMB(state.downloadedMB)} downloaded`;
  if (state.kind === "resuming") {
    stateLabel.textContent = "Downloading the machine";
    progress.style.width = `${Math.min(100, (state.downloadedMB / RESUME_ESTIMATE_MB) * 100)}%`;
  } else {
    stateLabel.textContent = "Running";
    progress.style.width = "0";
  }
}

// The guest reads files in bursts; show the latest name, then dim it once
// reading stops so the line doesn't flicker through hundreds of names.
let lastName = "";
let readingTimer = 0;
let paintQueued = false;

function onRead(name: string): void {
  if (!name) return;
  lastName = name;
  if (!paintQueued) {
    paintQueued = true;
    setTimeout(() => {
      paintQueued = false;
      reading.textContent = `reading ${lastName}`;
      reading.classList.add("active");
    }, 120);
  }
  clearTimeout(readingTimer);
  readingTimer = window.setTimeout(() => reading.classList.remove("active"), 1500);
}

// ------------------------------------------------------------------ machine

function fit(): void {
  const style = getComputedStyle(stage);
  const width = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  fitScreen(screen, { width, height });
}

const machine = new Machine({
  create: async (options) => {
    const { V86 } = await import("v86");
    return new V86(options as ConstructorParameters<typeof V86>[0]) as unknown as Emulator;
  },
  hasWebAssembly: () => typeof WebAssembly === "object",
  now: () => Date.now(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  onState: render,
  onRead,
  onScreenSizeChange: () => requestAnimationFrame(fit),
});

async function start(): Promise<void> {
  screen.sizer.remove();
  screen = createScreen(document);
  stage.prepend(screen.sizer);
  reading.textContent = "";
  await machine.start(v86Options({ wasmUrl, base }, screen.container));
}

new ResizeObserver(() => fit()).observe(stage);
retry.addEventListener("click", () => void start());
restartButton.addEventListener("click", () => void start());

// ------------------------------------------------------------------ keyboard

// v86 takes every key pressed anywhere on the page. While a toolbar button has
// focus, hand the keyboard back so Enter and Space press the button.
for (const bar of [keybar, element("restart").parentElement!]) {
  bar.addEventListener("focusin", () => machine.setKeyboardEnabled(false));
  bar.addEventListener("focusout", () => machine.setKeyboardEnabled(true));
}

stage.addEventListener("click", () => {
  (document.activeElement as HTMLElement | null)?.blur();
  if (touch) phoneKeyboard.focus();
});

// Sticky modifiers from the key bar apply to the next letter typed.
let modifier: Modifier | null = null;

function setModifier(next: Modifier | null): void {
  modifier = next;
  for (const button of keybar.querySelectorAll<HTMLButtonElement>("[data-modifier]")) {
    button.setAttribute("aria-pressed", String(button.dataset.modifier === next));
  }
}

function sendWithModifier(text: string): boolean {
  if (!modifier) return false;
  const codes = chord(modifier, text);
  setModifier(null);
  if (!codes) return false;
  machine.sendScancodes(codes);
  return true;
}

// Capture phase, so this runs before v86's own listener on window.
window.addEventListener(
  "keydown",
  (event) => {
    if (!modifier || event.key.length !== 1) return;
    if (sendWithModifier(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);

keybar.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button");
  if (!button) return;
  if (button.id === "show-keyboard") {
    phoneKeyboard.focus();
    return;
  }
  if (button.dataset.modifier) {
    const pressed = button.dataset.modifier as Modifier;
    setModifier(modifier === pressed ? null : pressed);
  } else if (button.dataset.key) {
    machine.sendScancodes(tap(button.dataset.key as SpecialKey));
  } else if (button.dataset.chord) {
    const [held, letter] = button.dataset.chord.split(":");
    const codes = chord(held as Modifier, letter);
    if (codes) machine.sendScancodes(codes);
  }
  // Keep the phone keyboard open after pressing a key-bar key.
  if (touch) phoneKeyboard.focus();
});

// Soft keyboards that send real keydowns are handled by v86 (the textarea has
// v86's phone_keyboard class). The rest send keyCode 229 and only say what
// they typed in the input event that follows.
let unidentified = false;
phoneKeyboard.addEventListener("keydown", (event) => {
  unidentified = isUnidentified(event);
});
phoneKeyboard.addEventListener("input", (event) => {
  const input = event as InputEvent;
  if (unidentified && !input.isComposing) {
    const action = interpretInput(input.inputType, input.data);
    if (action.kind === "text" && !sendWithModifier(action.text)) machine.sendText(action.text);
    if (action.kind === "scancodes") machine.sendScancodes(action.codes);
  }
  if (!input.isComposing) phoneKeyboard.value = "";
});
phoneKeyboard.addEventListener("compositionend", (event) => {
  if (event.data && !sendWithModifier(event.data)) machine.sendText(event.data);
  phoneKeyboard.value = "";
});

// ------------------------------------------------------------------ full screen

if (!document.fullscreenEnabled) fullscreenButton.hidden = true;
fullscreenButton.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
});
document.addEventListener("fullscreenchange", () => {
  fullscreenButton.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
});

// ------------------------------------------------------------------ tests

/** For the end-to-end tests: what's on the guest's screen right now. */
declare global {
  interface Window {
    archbtw: { state: () => MachineState; screenText: () => string[] };
  }
}
window.archbtw = {
  state: () => machine.current,
  screenText: () => {
    const guest = machine.guest;
    return guest ? textRows(guest.read_memory(VGA_TEXT_BASE, VGA_TEXT_WINDOW)) : [];
  },
};

void start();
