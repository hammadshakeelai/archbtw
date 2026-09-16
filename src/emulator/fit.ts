export interface Size {
  width: number;
  height: number;
}

/** The largest scale that fits `content` inside `area` without cropping. */
export function fitScale(area: Size, content: Size): number {
  if (area.width <= 0 || area.height <= 0 || content.width <= 0 || content.height <= 0) return 1;
  return Math.min(area.width / content.width, area.height / content.height);
}

/**
 * Below this the 9x16 VGA font is too small to read (about 6 px per
 * character), so a narrow phone pans the screen instead of shrinking it further.
 */
export const MIN_SCALE = 0.66;

/**
 * The scale to draw the guest's screen at: as large as fits, never below
 * MIN_SCALE, and a whole number when it is 1 or more so pixel fonts stay sharp
 * unless that would waste more than a fifth of the space.
 */
export function screenScale(area: Size, content: Size): number {
  const fit = fitScale(area, content);
  if (fit < 1) return Math.max(fit, MIN_SCALE);
  const whole = Math.floor(fit);
  return whole / fit >= 0.8 ? whole : fit;
}

/** Whether a scale draws each source pixel as a whole number of screen pixels. */
export function isWholeScale(scale: number): boolean {
  return Number.isInteger(scale);
}
