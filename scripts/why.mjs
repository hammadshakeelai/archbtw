/**
 * Explain why a package ended up in the rootfs.
 *
 * Prints the shortest dependency chain from a manifest seed to the named
 * package, so bloat can be cut at its actual cause instead of guessed at.
 *
 *   node scripts/why.mjs mesa llvm-libs icu
 */

import { gunzipSync } from "node:zlib";
import { indexDatabases, MIRRORS } from "./resolve.mjs";
import { allPackages } from "./manifest.mjs";

const REPOS = ["core", "extra"];

async function fetchDatabases() {
  for (const mirror of MIRRORS) {
    try {
      const databases = [];
      for (const repo of REPOS) {
        const response = await fetch(`${mirror}/i686/${repo}/${repo}.db`, {
          signal: AbortSignal.timeout(90_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = Buffer.from(await response.arrayBuffer());
        databases.push({ repo, buffer: raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw });
      }
      return databases;
    } catch {
      /* try the next mirror */
    }
  }
  throw new Error("no mirror served the databases");
}

/** Breadth-first from the seeds, remembering who first pulled each package. */
function traceFrom(seeds, { byName, provides }) {
  const parent = new Map();
  const queue = [];

  for (const seed of seeds) {
    const pkg = byName.get(seed) ?? byName.get(provides.get(seed) ?? "");
    if (pkg && !parent.has(pkg.name)) {
      parent.set(pkg.name, null);
      queue.push(pkg.name);
    }
  }

  while (queue.length) {
    const current = byName.get(queue.shift());
    for (const dep of current.depends) {
      const pkg = byName.get(dep) ?? byName.get(provides.get(dep) ?? "");
      if (!pkg || parent.has(pkg.name)) continue;
      parent.set(pkg.name, current.name);
      queue.push(pkg.name);
    }
  }
  return parent;
}

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error("usage: node scripts/why.mjs <package>...");
  process.exit(1);
}

const index = indexDatabases(await fetchDatabases());
const parent = traceFrom(allPackages(), index);

for (const target of targets) {
  if (!parent.has(target)) {
    console.log(`${target}: not in the tree`);
    continue;
  }
  const chain = [];
  for (let at = target; at != null; at = parent.get(at)) chain.unshift(at);
  const size = index.byName.get(target)?.installedSize ?? 0;
  console.log(`${target} (${(size / 1024 ** 2).toFixed(1)} MB): ${chain.join(" -> ")}`);
}
