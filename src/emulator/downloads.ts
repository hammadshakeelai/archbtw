const MEGABYTE = 1024 * 1024;

/** Adds up bytes downloaded across files; v86 reports progress per file. */
export class DownloadMeter {
  private readonly loaded = new Map<string, number>();

  record(file: string, loaded: number): void {
    this.loaded.set(file, Math.max(loaded, this.loaded.get(file) ?? 0));
  }

  megabytes(): number {
    let total = 0;
    for (const bytes of this.loaded.values()) total += bytes;
    return total / MEGABYTE;
  }
}

/**
 * Detects a download that started but got no new bytes for `timeoutMs`. Only downloads of known
 * length count, so time spent booting with nothing downloading never looks like a stall.
 */
export class StallWatch {
  private readonly active = new Map<string, { loaded: number; at: number }>();
  private readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  progress(file: string, loaded: number, total: number, lengthComputable: boolean, now: number): void {
    if (!lengthComputable || total <= 0) return;
    if (loaded >= total) {
      this.active.delete(file);
      return;
    }
    const entry = this.active.get(file);
    if (!entry || loaded > entry.loaded) this.active.set(file, { loaded, at: now });
  }

  isStalled(now: number): boolean {
    for (const entry of this.active.values()) {
      if (now - entry.at >= this.timeoutMs) return true;
    }
    return false;
  }
}
