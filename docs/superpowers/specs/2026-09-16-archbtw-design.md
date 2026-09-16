# archbtw — real Arch Linux in the browser

**Date:** 2026-09-16
**Status:** Built and deployed (see "What changed while building it" at the end)
**Repo:** `hammadshakeelai/archbtw` → https://hammadshakeelai.github.io/archbtw/

## What this is

A web page that boots a **real Arch Linux** (archlinux32, i686) in the browser via the
[v86](https://github.com/copy/v86) x86 emulator, landing the visitor at a live root shell in a
few seconds with several dozen fun commands already installed.

Not a simulation. A real Linux kernel, real `bash`, real `pacman`, real ELF binaries.

## Why these choices

### Why v86 and not CheerpX or container2wasm

| Option | Verdict |
|---|---|
| **v86 + archlinux32** | **Chosen.** BSD-2 licensed, self-hostable, proven Arch support upstream (`docs/archlinux.md`), and v86 ships a 9P transport that fits GitHub Pages exactly. |
| CheerpX / WebVM | Faster (real JIT), but the engine may not be self-hosted without a commercial licence, and a large image needs an external CORS/Range proxy. Not honestly "deployed on GitHub". |
| container2wasm | Experimental; ≥30 s startup for x86_64 guests. |

### Why 9P instead of a disk image

v86's own `archlinux` profile uses a **9P filesystem**: a directory of content-addressed files
plus an `fs.json` index, fetched per-file on demand. This matters for three reasons:

1. **No 100 MB file limit problem.** GitHub caps individual files at 100 MB. A 9P tree is
   thousands of small files, none near the limit. A monolithic disk image would need splitting.
2. **Low bandwidth per visitor.** Only files the guest actually reads get fetched. A visitor
   running `neofetch` and `sl` downloads a few MB, not the whole rootfs.
3. **Cheap to update.** Content addressing means an updated rootfs re-uploads only changed files.

### Why a state snapshot

Cold-booting a kernel in v86 takes 30–90 s — long enough that most visitors leave. v86 supports
resuming from a zstd-compressed RAM snapshot instead. copy.sh's equivalent
(`arch_state-v3.bin.zst`) is **15.5 MB** — mostly-zero memory compresses enormously — so instant
boot costs almost nothing. The visitor lands at a prompt in seconds.

### Why i686

Arch dropped i686 in 2017; [archlinux32](https://archlinux32.org) carries it on and is actively
maintained. v86 emulates 32-bit x86, so i686 is the only option — and it works: the `i686/extra`
repo has ~3,400 current packages including every toy we need. **i686, not pentium4** — the
pentium4 tier requires SSE2, which v86 supports only partially.

## Verified constraints

These were checked, not assumed:

| Constraint | Value | Consequence |
|---|---|---|
| GitHub Pages site size | **1 GB** | The whole 9P tree counts, even though visitors fetch little. This is the binding budget. |
| GitHub Pages file size | 100 MB | Not a problem with 9P. |
| Pages bandwidth | 100 GB/mo (soft) | Lazy 9P fetching keeps per-visitor cost low. |
| State snapshot | ~15 MB | Negligible against the budget. |
| Network in guest | **None** | A static host cannot proxy the VM's TCP. `pacman -S` cannot reach a mirror. Everything ships preinstalled; the MOTD says so. |

## Package manifest

Confirmed present as i686 builds in `archlinux32` `core`/`extra`:

- **Toys:** `sl` `cmatrix` `cowsay` `figlet` `toilet` `fortune-mod` `lolcat` `nyancat`
  `asciiquarium` `pv`
- **Fetch:** `neofetch` `fastfetch` `screenfetch`
- **Games:** `bsd-games` (tetris, hangman, worm, robots, adventure, …)
- **Tools:** `vim` `nano` `htop` `btop` `git` `tmux` `fish` `zsh` `ranger` `mc` `w3m` `lynx`
- **Shell-script toys** dropped in directly (no package needed): `pipes.sh`

Not available for i686 (AUR-only, out of scope): `cbonsai` `tty-clock` `bastet` `ninvaders` `cava`.

**Budget policy (decided):** toys take priority. If the rootfs exceeds budget, cut in this order:
`gcc` → full `python` → `neovim` → `btop`. Strip `/usr/share/doc`, locales, pacman cache and
unused kernel modules before cutting any toy.

## Architecture

Two halves that never run at the same time.

```
BUILD (CI, occasional)                    RUNTIME (visitor, always)
──────────────────────                    ─────────────────────────
bootstrap archlinux32 i686                Astro static page
  ↓ pacstrap manifest                       ↓
configure (9P initramfs, autologin,       v86 + wasm
           MOTD, PS1)                       ↓
  ↓ strip                                 fetch fs.json + state.bin.zst
fs2json.py  → fs.json                       ↓
copy-to-sha256.py → arch/ tree            resume → live prompt
  ↓ boot headless, save_state               ↓
arch-9p.tar.zst → GitHub Release          lazy per-file 9P fetch
```

### Build pipeline

Runs in GitHub Actions (`workflow_dispatch`), because the rootfs step needs root and must be
reproducible. Each stage is a separate script so failures are attributable.

1. **`scripts/rootfs.sh`** — download the archlinux32 bootstrap tarball, verify it, `pacstrap`
   the manifest into `build/rootfs/`.
2. **Configure** (same script, second phase):
   - `mkinitcpio` with `virtio_9p` + `9pnet_virtio` in `MODULES`. **Without these the guest
     cannot mount its own root and will not boot** — this is the single most common failure mode
     and v86's docs call it out explicitly.
   - systemd `getty@tty1` override with `--autologin root` — no login prompt.
   - `/etc/motd` with the Arch ASCII logo, a starter command list, and the offline notice.
   - `/root/.bashrc` with an Arch-style `PS1` and helpful aliases.
3. **Strip** — `/usr/share/doc`, `/usr/share/locale`, `/var/cache/pacman`, unused modules.
4. **`scripts/ninep.sh`** — `fs2json.py` → `fs.json`; `copy-to-sha256.py` → `arch/`; tar+zstd
   the result to `arch-9p.tar.zst`.
5. **`scripts/snapshot.mjs`** — boot the image headless under Node v86, wait for the prompt,
   `save_state()`, zstd-compress to `arch_state.bin.zst`.
6. **Publish** — attach both artifacts to a GitHub Release with their SHA-256 sums.

### Artifact hosting

The 9P tree is thousands of files: too much for git, impractical as individual Release assets.
So it is tarred into a single `arch-9p.tar.zst` attached to a **GitHub Release** (2 GB/file limit,
does not count against repo size). `scripts/images.mjs` downloads it at site-build time, verifies
SHA-256, and extracts into a gitignored `public/images/`.

This mirrors RetroMuseum's proven `npm run images` pattern — the repo stays small, Pages gets the
full tree.

### Runtime

One Astro page, full-screen v86:

```js
{
  memory_size:   512 * 1024 * 1024,
  vga_memory_size: 8 * 1024 * 1024,
  filesystem:    { baseurl: base + "images/arch/", basefs: base + "images/fs.json" },
  initial_state: { url: base + "images/arch_state.bin.zst" },
  screen: { container, use_graphical_text: false },
  autostart: true,
}
```

## Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `scripts/rootfs.sh` | bootstrap → pacstrap → configure → strip | archlinux32 mirrors |
| `scripts/ninep.sh` | rootfs → `fs.json` + `arch/` + tarball | v86 tools |
| `scripts/snapshot.mjs` | headless boot → `save_state` → zstd | v86 (node) |
| `scripts/images.mjs` | download + verify + extract at build time | GitHub Release |
| `src/lib/config.ts` | build v86 options from base path | — |
| `src/emulator/machine.ts` | boot/teardown, state machine | v86 browser build |
| `src/emulator/downloads.ts` | MB metering, stall detection | — |
| `src/input/keyboard.ts` | mobile input bridge + modifier toolbar | — |
| `src/pages/index.astro` | the page | all of the above |

Each is independently testable: the pure logic (`config`, `downloads`, `keyboard`) under Vitest,
the emulator integration under Playwright.

## Error handling

Visitor-facing states, modelled in `machine.ts`:

| State | Trigger | Shown |
|---|---|---|
| `no-wasm` | `WebAssembly` absent | "This browser can't run archbtw" + why |
| `downloading` | normal | MB counter + progress |
| `stalled` | 60 s without progress | "Still trying…" + retry |
| `download` | fetch error | error + retry |
| `running` | prompt live | the terminal |

Plus a static **offline notice** in the MOTD: `pacman -S` cannot reach a mirror because a static
host cannot proxy the guest's TCP. Stated plainly so nobody reports it as a bug.

## Mobile

A terminal link gets shared on phones, and v86 needs keystrokes a phone keyboard does not send.

- A hidden, focused `<input>` captures typing and forwards scancodes.
- A tap-toolbar supplies `Ctrl` `Alt` `Esc` `Tab` `↑` `↓` `Ctrl+C`.
- The screen scales to fit; the terminal stays legible at 375 px.

## Testing

**Vitest** — pure logic: v86 option construction from base path, download metering, stall
detection, manifest validation, keyboard scancode mapping.

**Playwright** — the proof that the image works, run in CI on every PR:

1. Load the page, wait for the shell prompt.
2. Type `neofetch`, assert output contains `Arch Linux`.
3. Run `sl`, assert the framebuffer changes.
4. Assert the MOTD lists commands.

A test that only checks the page renders would pass with a broken image, so the E2E tests drive
the guest and assert on its output.

## CI

| Workflow | Trigger | Does |
|---|---|---|
| `rootfs.yml` | `workflow_dispatch` | Builds rootfs → 9P → snapshot → Release. Slow, run rarely. |
| `ci.yml` | PR | lint, typecheck, vitest, build, Playwright |
| `deploy.yml` | push to `main` | fetch artifacts → build → deploy Pages |
| `health.yml` | weekly | verify Release assets and archlinux32 mirrors still resolve; open an issue if not |

## Risks

1. **The rootfs build is the hard part.** Bootstrap tarball, `pacstrap` on i686, and above all the
   `mkinitcpio` 9P modules. Everything else is downstream. Mitigation: prototype locally in WSL
   via `unshare -r` (verified working) before relying on CI round-trips.
2. **1 GB budget.** Mitigation: the strip list and the stated cut order.
3. **archlinux32 mirror rot.** Mitigation: the weekly health workflow; pin a mirror with a
   fallback list.
4. **v86 i686 kernel quirks.** Upstream's Arch profile works, so this is proven rather than
   speculative.

## Out of scope

- A desktop/window manager (v86 handles text mode far better; chosen surface is the terminal).
- A `fun` discovery command — the MOTD covers discovery; trivial to add later.
- Guest networking — impossible on a static host.
- Persistence between visits — each reload is a fresh VM.

## What changed while building it

The design held; these details changed once they met a real browser, a real
CI runner and a real guest. Each is explained where it lives in the code.

| Planned | Built | Why |
|---|---|---|
| `pacstrap` from a bootstrap tarball | Extract packages with `bsdtar`, then reinstall them with the guest's own `pacman -U` in an i686 chroot | archlinux32 publishes ISOs, not bootstrap tarballs |
| `toilet`, `mc`, `ranger`, `python`, `git` | Dropped | `toilet` pulls Mesa/LLVM (260 MB); `ranger` pulls Python. The resolver prices every tier before a build |
| Tetris from `bsd-games` | `snake`, `worm`, `robots`, `hangman`, `atc`, `adventure` | archlinux32's `bsd-games` has no tetris |
| Default `mkinitcpio` hooks | `base udev modconf 9p_root` | mkinitcpio 40 defaults to the `systemd` hook, under which the busybox-style `9p_root` handler never runs |
| Snapshot builder reads VGA memory | Rebuilds the screen from `screen-put-char` events | v86 keeps the text buffer in device memory; `read_memory` returns guest RAM |
| Canvas text in the VGA ROM font | DOM text rows in JetBrains Mono | After a restore the canvas renderer repainted only the cursor row. DOM text also makes output selectable |
| ~15 MB snapshot | ~41 MB | The boot's page cache and freed memory were captured. The builder now drops caches and zeroes free memory first; the rest is live kernel and process memory, logged by each build |
| Commit a package lock | Resolve at build time, commit the result | archlinux32 mirrors delete superseded package files within days |
| Unsigned packages checked by SHA-256 | Signatures verified against Arch Linux 32's keyring, whose master keys are pinned in `rootfs/trusted-keys.txt` | The repo databases the SHA-256 sums come from are unsigned |
| — | Every systemd timer masked; udev stopped before the snapshot | A visitor resumes long after the snapshot, the clock jumps, and every daily and weekly timer fires at once, reading hundreds of files over the network |
| — | `nomodeset`; serial getty masked | Keeps the fast VGA text console; a `ttyS0` console otherwise spawns an unreachable login prompt |
| — | `Ctrl+]` moves focus out of the terminal | v86 takes every key including Tab, so keyboard users couldn't reach the page controls |
| — | Modifiers released again 100 ms after the keyboard is handed back | On Windows v86 delays Left Ctrl by 10 ms, which left Ctrl stuck down after `Ctrl+]` |
| Phone keys forwarded as key codes | Printable phone keys sent as text | Phone keyboards report `$` as the 4 key with no Shift |
| `health.yml` checks mirrors | `health.yml` runs Chromium, Firefox and WebKit on desktop, Android, iPhone and iPad against the live site, and checks the manifest resolves | Deploys gate on Chromium desktop and Android only, to stay fast |

### Known limits

- **Bandwidth.** A first visit downloads about 45 MB (emulator plus snapshot), more as toys fetch their files. GitHub Pages' soft limit of 100 GB a month allows roughly two thousand first visits; repeat visits are mostly served from the browser cache.
- **Background tabs.** Browsers throttle timers in hidden tabs, which slows the emulator to a crawl until the tab is shown again.
- **Hardware-keyboard layouts.** v86 translates keys by key code, which assumes a US layout.
