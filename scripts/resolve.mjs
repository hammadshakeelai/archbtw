/**
 * Resolve the package manifest against archlinux32's i686 repositories.
 *
 * Pacman's repo databases carry %ISIZE% (installed bytes), so the whole rootfs
 * can be priced before a single package is downloaded. That turns the 1 GB
 * GitHub Pages ceiling from a risk discovered at the end of a long build into a
 * number checked in about twenty seconds.
 *
 * Writes scripts/packages.lock.json: the exact file list the rootfs build
 * downloads, with sizes and SHA-256 sums.
 */

import { gunzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { allPackages, BASE, TIERS } from "./manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Mirrors are tried in order; the first that serves a database wins. */
export const MIRRORS = [
  "https://de.mirror.archlinux32.org",
  "https://mirror.math.princeton.edu/pub/archlinux32",
  "https://mirror.archlinux32.org",
];

const REPOS = ["core", "extra"];
const ARCH = "i686";

/** GitHub Pages refuses to publish a site larger than this. */
export const PAGES_LIMIT = 1024 ** 3;

/**
 * What the rootfs must weigh once it is on Pages, leaving headroom for
 * fs.json, the state snapshot and the site itself.
 *
 * This is NOT the number checked here. `%ISIZE%` counts every file a package
 * ships, but the build then deletes most of them -- unused kernel modules
 * (~205 MB), binutils once the initramfs exists (~39 MB), docs, locales and
 * hwdata. scripts/rootfs.sh measures the real tree and is the authoritative
 * gate; this file only catches a manifest so greedy that no amount of
 * stripping would save it.
 */
export const ROOTFS_BUDGET = 900 * 1024 ** 2;

/** Conservative estimate of what the build's strip pass removes. */
export const EXPECTED_STRIP_SAVING = 280 * 1024 ** 2;

/** The pre-strip ceiling this script enforces. */
export const PRE_STRIP_BUDGET = ROOTFS_BUDGET + EXPECTED_STRIP_SAVING;

// ---------------------------------------------------------------- tar reading

/**
 * Yield [name, contents] for every regular file in an uncompressed tar.
 *
 * Pacman databases are small, well-formed GNU tars, so this handles the subset
 * that actually appears in them rather than the whole format.
 */
export function* readTar(buffer) {
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    // Two zero blocks mark the end of the archive.
    if (header.every((byte) => byte === 0)) break;

    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeField = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeField, 8) || 0;
    const type = String.fromCharCode(header[156]);

    offset += 512;
    if (type === "0" || type === "\0") {
      yield [name, buffer.subarray(offset, offset + size)];
    }
    offset += Math.ceil(size / 512) * 512;
  }
}

// ----------------------------------------------------------------- db parsing

/**
 * Parse one `desc` entry into a record.
 *
 * The format is a sequence of `%KEY%` lines each followed by values until a
 * blank line.
 */
export function parseDesc(text) {
  const fields = {};
  let key = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (/^%[A-Z0-9]+%$/.test(trimmed)) {
      key = trimmed.slice(1, -1);
      fields[key] = [];
    } else if (trimmed === "") {
      key = null;
    } else if (key) {
      fields[key].push(trimmed);
    }
  }
  return fields;
}

/** Strip a version constraint: `glibc>=2.38` -> `glibc`. */
export function depName(dep) {
  return dep.split(/[<>=:]/)[0].trim();
}

/**
 * Build the package index from every repo database.
 *
 * Returns { byName, provides } where `provides` maps a virtual name to the
 * package supplying it, so deps like `sh` resolve to bash.
 */
export function indexDatabases(databases) {
  const byName = new Map();
  const provides = new Map();

  for (const { repo, buffer } of databases) {
    for (const [path, contents] of readTar(buffer)) {
      if (!path.endsWith("/desc")) continue;
      const fields = parseDesc(contents.toString("utf8"));
      const name = fields.NAME?.[0];
      if (!name) continue;

      const pkg = {
        name,
        repo,
        version: fields.VERSION?.[0] ?? "",
        filename: fields.FILENAME?.[0] ?? "",
        depends: (fields.DEPENDS ?? []).map(depName),
        installedSize: Number(fields.ISIZE?.[0] ?? 0),
        downloadSize: Number(fields.CSIZE?.[0] ?? 0),
        sha256: fields.SHA256SUM?.[0] ?? "",
      };

      // Later repos win, matching pacman's repo precedence order.
      byName.set(name, pkg);
      for (const virtual of fields.PROVIDES ?? []) {
        const provided = depName(virtual);
        if (!provides.has(provided)) provides.set(provided, name);
      }
    }
  }
  return { byName, provides };
}

/**
 * Walk dependencies breadth-first from `seeds`.
 *
 * Unresolvable names are collected rather than thrown: a handful of pacman deps
 * are satisfied by the base filesystem package and never appear in a database,
 * and failing the whole build for those would be wrong.
 */
export function resolve(seeds, { byName, provides }) {
  const chosen = new Map();
  const missing = new Set();
  const queue = [...seeds];

  while (queue.length) {
    const wanted = queue.shift();
    if (chosen.has(wanted)) continue;

    const pkg = byName.get(wanted) ?? byName.get(provides.get(wanted) ?? "");
    if (!pkg) {
      missing.add(wanted);
      continue;
    }
    if (chosen.has(pkg.name)) continue;

    chosen.set(pkg.name, pkg);
    queue.push(...pkg.depends);
  }
  return { chosen, missing };
}

// ------------------------------------------------------------------ reporting

export function formatMB(bytes) {
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function fetchDatabases() {
  for (const mirror of MIRRORS) {
    try {
      const databases = [];
      for (const repo of REPOS) {
        const url = `${mirror}/${ARCH}/${repo}/${repo}.db`;
        const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
        if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
        const raw = Buffer.from(await response.arrayBuffer());
        // Databases are gzipped tars, but some mirrors serve them decompressed.
        const buffer = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
        databases.push({ repo, buffer });
      }
      return { mirror, databases };
    } catch (error) {
      console.error(`  ${mirror} failed: ${error.message}`);
    }
  }
  throw new Error("no archlinux32 mirror served the package databases");
}

async function main() {
  console.log("Fetching archlinux32 i686 databases...");
  const { mirror, databases } = await fetchDatabases();
  console.log(`  using ${mirror}\n`);

  const { byName, provides } = indexDatabases(databases);
  console.log(`Indexed ${byName.size} packages, ${provides.size} virtual names.\n`);

  // Price each tier cumulatively so the cut order has real numbers behind it.
  const seen = new Set();
  let running = 0;
  const rows = [];

  for (const group of [{ name: "base", packages: BASE }, ...TIERS]) {
    const { chosen } = resolve([...seen, ...group.packages], { byName, provides });
    const total = [...chosen.values()].reduce((sum, p) => sum + p.installedSize, 0);
    rows.push({ name: group.name, added: total - running, total });
    running = total;
    for (const name of group.packages) seen.add(name);
  }

  console.log("Tier                 adds        cumulative");
  console.log("--------------------------------------------");
  for (const row of rows) {
    const flag = row.total > PRE_STRIP_BUDGET ? "  OVER BUDGET" : "";
    console.log(
      `${row.name.padEnd(18)} ${formatMB(row.added).padStart(9)} ${formatMB(row.total).padStart(14)}${flag}`,
    );
  }

  const { chosen, missing } = resolve(allPackages(), { byName, provides });
  const installed = [...chosen.values()].reduce((sum, p) => sum + p.installedSize, 0);
  const download = [...chosen.values()].reduce((sum, p) => sum + p.downloadSize, 0);

  console.log(`\n${chosen.size} packages resolved.`);
  console.log(`  download  ${formatMB(download)}`);
  console.log(`  installed ${formatMB(installed)}`);
  const projected = installed - EXPECTED_STRIP_SAVING;
  console.log(`  pre-strip ceiling ${formatMB(PRE_STRIP_BUDGET)} (${((installed / PRE_STRIP_BUDGET) * 100).toFixed(0)}% used)`);
  console.log(`  projected after strip ${formatMB(projected)} against ${formatMB(ROOTFS_BUDGET)} on Pages`);

  // A name in the manifest that no repo carries is a typo and must fail loudly.
  const wanted = new Set(allPackages());
  const missingFromManifest = [...missing].filter((name) => wanted.has(name));
  if (missing.size) console.log(`\nUnresolved deps (satisfied by base): ${[...missing].join(", ")}`);
  if (missingFromManifest.length) {
    console.error(`\nERROR: manifest names not in any i686 repo: ${missingFromManifest.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const lock = {
    mirror,
    arch: ARCH,
    generated: new Date().toISOString(),
    installedSize: installed,
    downloadSize: download,
    packages: [...chosen.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, repo, version, filename, sha256, installedSize }) => ({
        name,
        repo,
        version,
        filename,
        sha256,
        installedSize,
      })),
  };
  const out = join(HERE, "packages.lock.json");
  writeFileSync(out, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`\nWrote ${out}`);

  if (installed > PRE_STRIP_BUDGET) {
    console.error(
      `\nERROR: pre-strip rootfs exceeds ${formatMB(PRE_STRIP_BUDGET)}. Drop a tier from manifest.mjs.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
