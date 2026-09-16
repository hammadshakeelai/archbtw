import wasmUrl from "v86/build/v86.wasm?url";
import { v86Options } from "../lib/config.ts";
import { TextScreen } from "../lib/vga.ts";
import { Machine, type Emulator, type MachineState } from "../emulator/machine.ts";
import { createScreen, fitScreen, type ScreenElements } from "../emulator/screen.ts";
import { chord, interpretInput, isUnidentified, sendsAsText, tap, type Modifier, type SpecialKey } from "../input/keys.ts";

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
/** A text copy of the guest's screen, for the end-to-end tests. */
let textScreen = new TextScreen();

// ------------------------------------------------------------------ status line

const ERRORS: Record<string, string> = {
  download: "The machine's files didn't finish downloading. Check your connection, then try again.",
  stalled: "The download stopped making progress. Try again, or reload the page.",
  "no-wasm":
    "This browser can't run the emulator because it doesn't support WebAssembly. Open this page in a current version of Firefox, Chrome, Safari or Edge.",
};

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

  if (state.kind === "resuming") {
    stateLabel.textContent = "Downloading the machine";
    // GitHub Pages compresses some responses and then sends no length, so a
    // total is only shown when the server reported one still ahead of us.
    const knownTotal = state.expectedMB > state.downloadedMB;
    fetched.textContent = knownTotal
      ? `${formatMB(state.downloadedMB)} of ${formatMB(state.expectedMB)}`
      : `${formatMB(state.downloadedMB)} downloaded`;
    progress.style.width = knownTotal ? `${(state.downloadedMB / state.expectedMB) * 100}%` : "0";
  } else {
    fetched.textContent = `${formatMB(state.downloadedMB)} downloaded`;
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
  later: (ms, fn) => {
    setTimeout(fn, ms);
  },
  randomBytes: (count) => crypto.getRandomValues(new Uint8Array(count)),
  onState: render,
  onRead,
  onScreenSizeChange: () => requestAnimationFrame(fit),
});

async function start(): Promise<void> {
  screen.sizer.remove();
  screen = createScreen(document);
  stage.prepend(screen.sizer);
  reading.textContent = "";
  textScreen = new TextScreen();
  // start() returns once the emulator exists, before the snapshot has
  // downloaded, so these catch the full redraw that follows the restore.
  await machine.start(v86Options({ wasmUrl, base }, screen.container));
  machine.guest?.add_listener("screen-put-char", (args) => textScreen.put(args));
  machine.guest?.add_listener("screen-set-size", (args) => textScreen.resize(args));
}

new ResizeObserver(() => fit()).observe(stage);
// Focus goes back to the terminal: a fresh machine starts with the keyboard,
// and leaving focus on the button would send the next Enter to the guest.
retry.addEventListener("click", () => void start().then(() => stage.focus({ preventScroll: true })));
restartButton.addEventListener("click", () => void start().then(() => stage.focus({ preventScroll: true })));

// ------------------------------------------------------------------ keyboard

// v86 takes every key pressed anywhere on the page, so it only gets the
// keyboard while the terminal (or nothing in particular) has focus. Buttons
// and links get their keys back, so Enter and Space press them.
function keysGoToGuest(target: EventTarget | null): boolean {
  return !(target instanceof HTMLElement) || target === stage || target === phoneKeyboard || target === document.body;
}
function setKeyboardOwner(guest: boolean): void {
  machine.setKeyboardEnabled(guest);
  document.body.dataset.keyboard = guest ? "guest" : "page";
}
document.addEventListener("focusin", (event) => setKeyboardOwner(keysGoToGuest(event.target)));
document.addEventListener("focusout", (event) => {
  if (!event.relatedTarget) setKeyboardOwner(true);
});

// Tab belongs to the shell, so keyboard users need another way out of the
// terminal: Ctrl+], the escape character telnet used for the same job.
window.addEventListener(
  "keydown",
  (event) => {
    if (!event.ctrlKey || event.code !== "BracketRight") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const firstControl = [fullscreenButton, restartButton].find((button) => !button.hidden);
    (firstControl ?? element("brand")).focus();
  },
  true,
);

function focusTerminal(): void {
  if (touch) phoneKeyboard.focus();
  else stage.focus({ preventScroll: true });
}

stage.addEventListener("click", (event) => {
  // Leave the notice's own button, and text selection, alone.
  if ((event.target as HTMLElement).closest("button") || getSelection()?.toString()) return;
  focusTerminal();
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
  if (sendsAsText(event)) {
    // Stops v86's own listener typing the key without its Shift, and stops
    // the input event that would otherwise follow.
    event.preventDefault();
    event.stopPropagation();
    if (!sendWithModifier(event.key)) machine.sendText(event.key);
  }
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
  screenText: () => textScreen.rows(),
};

void start().then(() => {
  // So a hardware keyboard types into the machine without a click first.
  if (!touch) stage.focus({ preventScroll: true });
});
