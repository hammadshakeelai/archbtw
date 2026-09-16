import { isWholeScale, screenScale, type Size } from "./fit.ts";

export interface ScreenElements {
  /** Sized to the scaled screen, so the area around it can scroll on a phone. */
  sizer: HTMLElement;
  /** What v86 draws into (v86 examples/basic.html). */
  container: HTMLElement;
  text: HTMLElement;
  canvas: HTMLCanvasElement;
}

export function createScreen(doc: Document): ScreenElements {
  const sizer = doc.createElement("div");
  sizer.className = "screen-sizer";
  const container = doc.createElement("div");
  container.className = "v86-screen";
  const text = doc.createElement("div");
  text.className = "v86-text";
  const canvas = doc.createElement("canvas");
  canvas.className = "v86-canvas";
  container.append(text, canvas);
  sizer.append(container);
  return { sizer, container, text, canvas };
}

/**
 * Scale whichever layer v86 is showing to fit `area`.
 *
 * v86 sizes its layers itself, so the layer is measured as laid out with any
 * previous scale removed. The sizer takes the scaled size because a CSS
 * transform doesn't change layout, and without it a phone couldn't scroll to
 * the parts of the screen that don't fit.
 */
export function fitScreen(screen: ScreenElements, area: Size): number {
  const shown = screen.canvas.style.display === "none" ? screen.text : screen.canvas;
  screen.container.style.transform = "";
  const { width, height } = shown.getBoundingClientRect();
  if (width === 0 || height === 0) return 1;

  const scale = screenScale(area, { width, height });
  screen.container.style.transform = `scale(${scale})`;
  screen.sizer.style.width = `${Math.round(width * scale)}px`;
  screen.sizer.style.height = `${Math.round(height * scale)}px`;
  screen.canvas.style.imageRendering = isWholeScale(scale) ? "pixelated" : "auto";
  return scale;
}
