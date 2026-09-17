/**
 * The guest's text screen, rebuilt from v86's screen events.
 *
 * v86's VGA text buffer is device memory, not guest RAM, so it can't be read
 * with read_memory. Instead v86 announces every character it draws
 * (`screen-put-char`) and every mode change (`screen-set-size`), and redraws
 * the whole screen after restoring a snapshot, so listening from the start
 * gives an exact copy. The snapshot builder and the page's tests both use it.
 */

export const COLUMNS = 80;
export const ROWS = 25;

export class TextScreen {
  private columns = COLUMNS;
  private cells: number[] = new Array(COLUMNS * ROWS).fill(0x20);
  /** True while the guest is in a graphics mode, when there is no text to read. */
  graphical = false;

  /** Payload of `screen-put-char`: [row, col, chr]. */
  put([row, col, chr]: [number, number, number]): void {
    if (col >= this.columns) return;
    const index = row * this.columns + col;
    if (index >= this.cells.length) return;
    this.cells[index] = chr;
  }

  /** Payload of `screen-set-size`: [cols, rows, bpp]; bpp is 0 in text mode. */
  resize([width, height, bpp]: [number, number, number]): void {
    const wasGraphical = this.graphical;
    this.graphical = bpp !== 0;
    if (this.graphical) return;
    // v86 can announce the same text size again (the console reprogramming the
    // VGA controller as it scrolls) without redrawing; that erases nothing.
    if (!wasGraphical && width === this.columns && width * height === this.cells.length) return;
    this.columns = width;
    this.cells = new Array(width * height).fill(0x20);
  }

  /** Rows of text, trailing blanks trimmed. */
  rows(): string[] {
    const rows: string[] = [];
    for (let start = 0; start < this.cells.length; start += this.columns) {
      let row = "";
      for (const code of this.cells.slice(start, start + this.columns)) {
        // Code page 437 matches ASCII for printable bytes; show the rest as spaces.
        row += code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : " ";
      }
      rows.push(row.trimEnd());
    }
    return rows;
  }

  text(): string {
    return this.rows().join("\n");
  }
}
