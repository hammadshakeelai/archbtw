/**
 * Put the guest into public/images/ before the site is built.
 *
 *   node scripts/images.ts
 *
 * The guest is built by .github/workflows/rootfs.yml and attached to a GitHub
 * Release as one tar: thousands of small 9p files are too many for git and
 * impractical as separate release assets. images.lock.json, committed by that
 * workflow, names the release asset and its SHA-256. This downloads it,
 * verifies it and unpacks it, and does nothing if it is already unpacked.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { IMAGE_PATHS } from "../src/lib/guest.ts";

export interface ImagesLock {
  tag: string;
  asset: string;
  url: string;
  sha256: string;
  bytes: number;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = join(ROOT, "images.lock.json");
const IMAGES = join(ROOT, "public", "images");
const STAMP = join(IMAGES, ".sha256");
const DOWNLOAD = join(ROOT, "build", "images.tar");

/** Reject a lock that could point the build somewhere unexpected. */
export function parseLock(text: string): ImagesLock {
  const lock = JSON.parse(text) as Partial<ImagesLock>;
  if (typeof lock.tag !== "string" || !lock.tag) throw new Error("images.lock.json: missing tag");
  if (typeof lock.asset !== "string" || !lock.asset) throw new Error("images.lock.json: missing asset");
  if (typeof lock.url !== "string" || !lock.url.startsWith("https://github.com/")) {
    throw new Error("images.lock.json: url must be a GitHub release download");
  }
  if (typeof lock.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(lock.sha256)) {
    throw new Error("images.lock.json: sha256 must be 64 lowercase hex characters");
  }
  if (typeof lock.bytes !== "number" || lock.bytes <= 0) throw new Error("images.lock.json: missing bytes");
  return lock as ImagesLock;
}

async function download(lock: ImagesLock): Promise<void> {
  await mkdir(dirname(DOWNLOAD), { recursive: true });
  const response = await fetch(lock.url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status} for ${lock.url}`);

  const hash = createHash("sha256");
  let received = 0;
  let lastReport = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      received += chunk.length;
      if (received - lastReport >= 50 * 1024 * 1024) {
        lastReport = received;
        console.log(`  ${Math.round(received / 1024 / 1024)} / ${Math.round(lock.bytes / 1024 / 1024)} MB`);
      }
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), meter, createWriteStream(DOWNLOAD));

  const actual = hash.digest("hex");
  if (actual !== lock.sha256) {
    await rm(DOWNLOAD, { force: true });
    throw new Error(`checksum mismatch for ${lock.asset}: expected ${lock.sha256}, got ${actual}`);
  }
}

async function main(): Promise<void> {
  if (!existsSync(LOCK_PATH)) {
    console.error("images.lock.json is missing: the guest has not been built yet.");
    console.error("Run the 'Build guest' workflow (.github/workflows/rootfs.yml) first.");
    process.exit(1);
  }
  const lock = parseLock(await readFile(LOCK_PATH, "utf8"));

  const stamp = existsSync(STAMP) ? (await readFile(STAMP, "utf8")).trim() : "";
  if (stamp === lock.sha256 && existsSync(join(IMAGES, IMAGE_PATHS.state))) {
    console.log(`public/images/ already holds ${lock.tag}`);
    return;
  }

  console.log(`Downloading ${lock.asset} from release ${lock.tag} (${Math.round(lock.bytes / 1024 / 1024)} MB)`);
  await download(lock);

  console.log("Unpacking into public/images/");
  await rm(IMAGES, { recursive: true, force: true });
  await mkdir(IMAGES, { recursive: true });
  const untar = spawnSync("tar", ["-xf", DOWNLOAD, "-C", IMAGES], { stdio: "inherit" });
  if (untar.status !== 0) throw new Error("tar could not unpack the images");
  if (!existsSync(join(IMAGES, IMAGE_PATHS.state))) throw new Error(`the images tar has no ${IMAGE_PATHS.state}`);

  await writeFile(STAMP, `${lock.sha256}\n`);
  await rm(DOWNLOAD, { force: true });
  console.log(`public/images/ now holds ${lock.tag}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
