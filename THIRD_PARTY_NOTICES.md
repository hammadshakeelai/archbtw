# Third-Party Notices

archbtw's own code — the site, the build scripts and the files in `rootfs/overlay/` — is MIT-licensed (see [LICENSE](LICENSE)). The site redistributes the following, each under its own license.

## v86

The emulator code bundled into the site and `v86.wasm`, both from the npm `v86` package, version 0.5.460.

- Project: https://github.com/copy/v86
- License: BSD-2-Clause (below). The v86 build also contains Berkeley SoftFloat, zstd decompression, and floppy code ported from QEMU, each under its own license; see the v86 repository.

```
Copyright (c) 2012, The v86 contributors
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## SeaBIOS and SeaVGABIOS

`public/bios/seabios.bin` and `public/bios/vgabios.bin`.

- Project: https://www.seabios.org/ (version `rel-1.16.2`)
- License: GNU Lesser General Public License v3
- Source: https://review.coreboot.org/seabios.git, tag `rel-1.16.2`

## The Arch Linux guest

The guest is built by `.github/workflows/rootfs.yml` from binary packages published by [Arch Linux 32](https://archlinux32.org), a community port of Arch Linux to 32-bit x86. It is not stored in this repository: it is attached to a [GitHub Release](../../releases) and published in the site's `images/` folder.

- **What's in it:** the exact package names, versions, file names and SHA-256 sums are in [`scripts/packages.lock.json`](scripts/packages.lock.json), updated by each guest build. `scripts/manifest.mjs` lists what was asked for.
- **Licenses:** each package keeps its own license (GPL-2.0 for the Linux kernel, GPL-3.0 for bash and coreutils, LGPL for glibc, and many others). Every package's license is recorded in its `.PKGINFO` and on its Arch Linux 32 package page.
- **Source code:** the build recipes are in Arch Linux 32's repositories (https://git.archlinux32.org/) and Arch Linux's (https://gitlab.archlinux.org/archlinux/packaging/packages), each of which names the upstream source it builds.
- **Changes made by archbtw:** the files in `rootfs/overlay/` are added, and documentation, locales, static libraries and most kernel modules are deleted to fit GitHub Pages (see the "Stripping" stage of `scripts/rootfs.sh`). No package's code is modified.

The 9p conversion uses `tools/fs2json.py` and `tools/copy-to-sha256.py` from v86 (BSD-2-Clause, above), downloaded at build time from commit `73077e9`.

## Trademarks

Arch Linux is a trademark of its respective owners. archbtw is an unofficial fan project and is not affiliated with or endorsed by Arch Linux or Arch Linux 32.
