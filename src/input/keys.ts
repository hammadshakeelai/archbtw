/**
 * PS/2 scancodes (set 1) for the keys a phone keyboard can't send.
 *
 * A key press is its make code; the release ("break") is the same code with
 * the top bit set. Extended keys such as the arrows are prefixed with 0xE0.
 */

export type SpecialKey = "Escape" | "Tab" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";
export type Modifier = "ctrl" | "alt";

const MAKE: Record<SpecialKey | "Enter" | "Backspace", number[]> = {
  Escape: [0x01],
  Tab: [0x0f],
  Enter: [0x1c],
  Backspace: [0x0e],
  ArrowUp: [0xe0, 0x48],
  ArrowDown: [0xe0, 0x50],
  ArrowLeft: [0xe0, 0x4b],
  ArrowRight: [0xe0, 0x4d],
};

const MODIFIER_MAKE: Record<Modifier, number> = { ctrl: 0x1d, alt: 0x38 };

/** Letter scancodes, for modifier combinations typed on a soft keyboard. */
const LETTERS: Record<string, number> = {
  q: 0x10, w: 0x11, e: 0x12, r: 0x13, t: 0x14, y: 0x15, u: 0x16, i: 0x17, o: 0x18, p: 0x19,
  a: 0x1e, s: 0x1f, d: 0x20, f: 0x21, g: 0x22, h: 0x23, j: 0x24, k: 0x25, l: 0x26,
  z: 0x2c, x: 0x2d, c: 0x2e, v: 0x2f, b: 0x30, n: 0x31, m: 0x32,
};

/** The break sequence for a make sequence: keep any 0xE0 prefix, set the top bit on the code. */
function release(make: number[]): number[] {
  return make.map((code, index) => (index === make.length - 1 ? code | 0x80 : code));
}

/** Press and release one key. */
export function tap(key: keyof typeof MAKE): number[] {
  return [...MAKE[key], ...release(MAKE[key])];
}

/** Hold a modifier, tap a letter, let go. Null for anything but a-z. */
export function chord(modifier: Modifier, letter: string): number[] | null {
  const code = LETTERS[letter.toLowerCase()];
  if (code === undefined || letter.length !== 1) return null;
  const held = MODIFIER_MAKE[modifier];
  return [held, code, code | 0x80, held | 0x80];
}

export type SoftInput =
  | { kind: "text"; text: string }
  | { kind: "scancodes"; codes: number[] }
  | { kind: "ignore" };

/**
 * Turn an `input` event from the phone keyboard textarea into something to
 * send to the guest.
 *
 * Only used when the matching keydown was unidentifiable (Android's
 * keyCode 229). Keyboards that send real keydowns are handled by v86 itself,
 * and translating their input events too would type every character twice.
 */
export function interpretInput(inputType: string, data: string | null): SoftInput {
  switch (inputType) {
    case "insertText":
    case "insertReplacementText":
      return data ? { kind: "text", text: data } : { kind: "ignore" };
    // A composing keyboard reports the word so far on every keystroke ("h",
    // "he", "hel"); the finished word is sent once, on compositionend.
    case "insertCompositionText":
      return { kind: "ignore" };
    case "insertLineBreak":
    case "insertParagraph":
      return { kind: "scancodes", codes: tap("Enter") };
    case "deleteContentBackward":
      return { kind: "scancodes", codes: tap("Backspace") };
    default:
      return { kind: "ignore" };
  }
}

/** Keydowns a soft keyboard sends when it can't say which key it was. */
export function isUnidentified(event: Pick<KeyboardEvent, "key" | "keyCode">): boolean {
  return event.keyCode === 229 || event.key === "Unidentified" || event.key === "Process";
}
