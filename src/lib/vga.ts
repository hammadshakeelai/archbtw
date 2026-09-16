/**
 * Read VGA text-mode memory as lines of text.
 *
 * In text mode the screen lives at physical address 0xB8000 as (character,
 * attribute) byte pairs. The Linux console can scroll by moving the display
 * origin inside the 32 KB window rather than copying, so callers read the whole
 * window and look for what they need anywhere in it.
 */

export const VGA_TEXT_BASE = 0xb8000;
export const VGA_TEXT_WINDOW = 0x8000;
export const COLUMNS = 80;

/** Character bytes only, as rows of `columns`, trailing blanks trimmed. */
export function textRows(memory: Uint8Array, columns = COLUMNS): string[] {
  const rows: string[] = [];
  const cells = Math.floor(memory.length / 2);
  for (let start = 0; start < cells; start += columns) {
    let row = "";
    for (let cell = start; cell < Math.min(start + columns, cells); cell++) {
      const code = memory[cell * 2];
      // Code page 437 matches ASCII for printable bytes; show the rest as spaces.
      row += code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : " ";
    }
    rows.push(row.trimEnd());
  }
  return rows;
}

/** The rows that have anything on them, for a readable dump in a CI log. */
export function nonBlankRows(memory: Uint8Array, columns = COLUMNS): string[] {
  return textRows(memory, columns).filter((row) => row.length > 0);
}
