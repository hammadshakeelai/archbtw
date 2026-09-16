#!/usr/bin/env bash
#
# Build the archbtw guest: an archlinux32 i686 root filesystem, converted to
# the 9p format v86 serves over HTTP.
#
#   sudo scripts/rootfs.sh
#
# Needs root on an x86_64 Linux host (a GitHub Actions runner): x86_64 CPUs
# run i686 binaries natively, so the guest's own pacman and mkinitcpio can run
# in a chroot here.
#
# Writes build/out/:
#   fs.json               the 9p inode tree, for the one-time snapshot boot
#   arch/                 every file, named by content hash, zstd-compressed
#   rootfs-report.txt     sizes, for the budget and the build log
#
# Stages are logged with ==> so a CI failure points at one of them.

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BUILD=${BUILD:-$ROOT_DIR/build}
LOCK=$ROOT_DIR/scripts/packages.lock.json
OVERLAY=$ROOT_DIR/rootfs/overlay

# The v86 commit the npm package (0.5.460+g73077e9) was built from. The 9p
# tools must match the runtime that reads their output.
V86_COMMIT=73077e9

# GitHub Pages publishes at most 1 GB. The compressed 9p tree must leave room
# for the state snapshot and the site itself.
BUDGET_MB=${BUDGET_MB:-900}

CACHE=$BUILD/cache
ROOTFS=$BUILD/rootfs
OUT=$BUILD/out
TOOLS=$BUILD/tools

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root: the chroot, mounts and pacman need it"
[[ $(uname -m) == x86_64 ]] || die "needs an x86_64 host (it runs the i686 guest binaries natively)"
[[ -f $LOCK ]] || die "missing $LOCK; run: npm run resolve"

# ------------------------------------------------------------------ chroot

CHROOT_MOUNTS=(var/cache/pacman/pkg run dev/pts dev sys proc)

unmount_chroot() {
    for dir in "${CHROOT_MOUNTS[@]}"; do
        if mountpoint -q "$ROOTFS/$dir" 2>/dev/null; then
            umount -l "$ROOTFS/$dir"
        fi
    done
}
trap unmount_chroot EXIT

mount_chroot() {
    mkdir -p "$ROOTFS"/{proc,sys,dev,run,var/cache/pacman/pkg}
    mount -t proc proc "$ROOTFS/proc"
    mount -t sysfs sys "$ROOTFS/sys"
    mount --bind /dev "$ROOTFS/dev"
    mkdir -p "$ROOTFS/dev/pts"
    mount --bind /dev/pts "$ROOTFS/dev/pts"
    mount -t tmpfs tmpfs "$ROOTFS/run"
    mount --bind "$CACHE" "$ROOTFS/var/cache/pacman/pkg"
}

# `setarch i686` makes uname report i686, so the guest's tools believe they
# are on the machine they were built for.
in_chroot() {
    setarch i686 chroot "$ROOTFS" /usr/bin/env -i \
        HOME=/root TERM=dumb LANG=C.UTF-8 \
        PATH=/usr/local/sbin:/usr/local/bin:/usr/bin \
        "$@"
}

# ------------------------------------------------------------------ tools

log "Installing host tools"
if command -v apt-get >/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq curl zstd libarchive-tools python3 python3-zstandard util-linux >/dev/null
fi
for tool in curl zstd bsdtar python3 setarch chroot sha256sum mountpoint; do
    command -v "$tool" >/dev/null || die "missing host tool: $tool"
done
python3 -c 'import zstandard' 2>/dev/null || die "python3 needs the zstandard module"

mkdir -p "$TOOLS"
for tool in fs2json.py copy-to-sha256.py; do
    curl -fsSL --retry 3 -o "$TOOLS/$tool" "https://raw.githubusercontent.com/copy/v86/$V86_COMMIT/tools/$tool"
done

# ------------------------------------------------------------------ download

log "Downloading packages"
mkdir -p "$CACHE"
python3 - "$LOCK" >"$BUILD/packages.tsv" <<'PY'
import json, sys
lock = json.load(open(sys.argv[1]))
print(lock["mirror"])
for p in lock["packages"]:
    print(p["repo"], p["filename"], p["sha256"], sep="\t")
PY

export CACHE
export MIRROR_LIST="$(head -1 "$BUILD/packages.tsv") https://de.mirror.archlinux32.org https://mirror.math.princeton.edu/pub/archlinux32 https://mirror.archlinux32.org"

fetch_package() {
    local repo=$1 file=$2 sum=$3 dest=$CACHE/$2 mirror
    if [[ -f $dest ]] && echo "$sum  $dest" | sha256sum -c --status; then
        return 0
    fi
    for mirror in $MIRROR_LIST; do
        if curl -fsSL --retry 3 --max-time 600 -o "$dest.part" "$mirror/i686/$repo/$file"; then
            if echo "$sum  $dest.part" | sha256sum -c --status; then
                mv "$dest.part" "$dest"
                return 0
            fi
            echo "checksum mismatch: $file from $mirror" >&2
        fi
    done
    rm -f "$dest.part"
    echo "FAILED: $file" >&2
    return 1
}
export -f fetch_package

tail -n +2 "$BUILD/packages.tsv" |
    xargs -P 8 -n 3 bash -c 'fetch_package "$0" "$1" "$2"' ||
    die "some packages could not be downloaded"

PACKAGE_COUNT=$(($(wc -l <"$BUILD/packages.tsv") - 1))
echo "$PACKAGE_COUNT packages verified against packages.lock.json"

# Sync databases, so `pacman -Ss` and `pacman -Si` work in the offline guest.
SYNC_MIRROR=$(head -1 "$BUILD/packages.tsv")
for repo in core extra; do
    curl -fsSL --retry 3 -o "$CACHE/$repo.db" "$SYNC_MIRROR/i686/$repo/$repo.db"
done

# ------------------------------------------------------------------ bootstrap

log "Extracting packages into a bootstrap root"
unmount_chroot
rm -rf --one-file-system "$ROOTFS"
mkdir -p "$ROOTFS"
cut -f2 <(tail -n +2 "$BUILD/packages.tsv") | while read -r file; do
    bsdtar -xpf "$CACHE/$file" -C "$ROOTFS" --numeric-owner \
        --exclude .PKGINFO --exclude .BUILDINFO --exclude .MTREE \
        --exclude .INSTALL --exclude .CHANGELOG
done

# The initramfs settings must exist before pacman runs, because installing the
# kernel triggers mkinitcpio. Neither path belongs to any package.
mkdir -p "$ROOTFS/etc"
cp -r "$OVERLAY/etc/mkinitcpio.conf.d" "$OVERLAY/etc/initcpio" "$ROOTFS/etc/"

# A build-only pacman config. Signatures are skipped because the guest's
# keyring is not initialised; every package was already checked against the
# SHA-256 in its repo database above.
cat >"$ROOTFS/archbtw-pacman.conf" <<'EOF'
[options]
RootDir     = /
DBPath      = /var/lib/pacman/
CacheDir    = /var/cache/pacman/pkg/
Architecture = i686
SigLevel    = Never
LocalFileSigLevel = Never
EOF
cut -f2 <(tail -n +2 "$BUILD/packages.tsv") | sed 's|^|/var/cache/pacman/pkg/|' >"$ROOTFS/archbtw-packages.txt"

log "Installing packages with the guest's own pacman"
mount_chroot
# Reinstalling over the extracted files registers every package in pacman's
# local database and runs the install scriptlets and hooks (users, groups,
# ldconfig, ca-certificates, the kernel image in /boot).
in_chroot /usr/bin/bash -c \
    'pacman -U --noconfirm --noprogressbar --overwrite "*" --config /archbtw-pacman.conf $(cat /archbtw-packages.txt)'

# ------------------------------------------------------------------ configure

log "Configuring the guest"
(cd "$OVERLAY" && find . -type f) | while read -r path; do
    install -D -o root -g root -m 644 "$OVERLAY/$path" "$ROOTFS/$path"
done
chmod 755 "$ROOTFS/usr/local/bin/pipes"
chmod 700 "$ROOTFS/root"

ln -sf /usr/share/zoneinfo/UTC "$ROOTFS/etc/localtime"
sed -i 's/^Architecture.*/Architecture = i686/' "$ROOTFS/etc/pacman.conf"
mkdir -p "$ROOTFS/var/lib/pacman/sync"
cp "$CACHE/core.db" "$CACHE/extra.db" "$ROOTFS/var/lib/pacman/sync/"

# A machine-id stops systemd treating the boot as a first boot, and the masks
# make sure nothing waits at a prompt: systemd 259 asks for a locale, keymap,
# timezone and a first user when it thinks the machine is new.
rm -f "$ROOTFS/etc/machine-id"
in_chroot systemd-machine-id-setup
in_chroot passwd -d root >/dev/null
in_chroot systemctl set-default multi-user.target
for unit in systemd-firstboot.service systemd-homed-firstboot.service systemd-homed.service \
    systemd-timesyncd.service systemd-networkd.service systemd-resolved.service \
    systemd-networkd-wait-online.service remote-fs.target; do
    in_chroot systemctl mask "$unit" >/dev/null 2>&1 || true
done

# Every timer. A visitor resumes the snapshot hours or weeks after it was
# taken, the guest's clock jumps forward, and every daily and weekly timer
# (keyring sync, shadow checks, tmpfiles cleanup) fires at once, reading
# hundreds of files over the network in the visitor's first minute.
for timer in "$ROOTFS"/usr/lib/systemd/system/*.timer; do
    in_chroot systemctl mask "$(basename "$timer")" >/dev/null 2>&1 || true
done

log "Building the initramfs"
KVER=$(ls "$ROOTFS/usr/lib/modules" | grep -v '^extramodules' | head -1)
[[ -n $KVER ]] || die "no kernel modules directory; did the linux package install?"
echo "kernel $KVER"
cp "$ROOTFS/usr/lib/modules/$KVER/vmlinuz" "$ROOTFS/boot/vmlinuz-linux"
cat >"$ROOTFS/etc/mkinitcpio.d/linux.preset" <<'EOF'
# archbtw: a single image. v86 skips fallback images, so building one only
# costs space.
ALL_kver="/boot/vmlinuz-linux"
PRESETS=('default')
default_image="/boot/initramfs-linux.img"
EOF
rm -f "$ROOTFS"/boot/initramfs-linux-fallback.img
in_chroot mkinitcpio -P

# Fail here, in seconds, rather than after a 20 minute headless boot that
# can never mount root.
INITRAMFS_LIST=$(in_chroot lsinitcpio /boot/initramfs-linux.img)
grep -q "hooks/9p_root" <<<"$INITRAMFS_LIST" || die "initramfs is missing the 9p_root hook"
for module in 9p 9pnet 9pnet_virtio; do
    if grep -Eq "/$module\.ko" <<<"$INITRAMFS_LIST"; then
        echo "initramfs: $module"
    elif grep -Eq "/$module\.ko" "$ROOTFS/usr/lib/modules/$KVER/modules.builtin"; then
        echo "kernel built-in: $module"
    else
        die "$module is neither in the initramfs nor built into the kernel; the guest could not mount root"
    fi
done

unmount_chroot

# ------------------------------------------------------------------ strip

log "Stripping what a browser guest never uses"
BEFORE_MB=$(du -sm "$ROOTFS" | cut -f1)

# Kernel modules: keep only what an emulated PC with virtio devices can load.
MODULES=$ROOTFS/usr/lib/modules/$KVER/kernel
KEEP=$(mktemp -d)
for dir in fs/9p fs/netfs net/9p drivers/virtio drivers/input drivers/char drivers/tty drivers/net/virtio_net.ko.zst; do
    if [[ -e $MODULES/$dir ]]; then
        mkdir -p "$KEEP/$(dirname "$dir")"
        mv "$MODULES/$dir" "$KEEP/$dir"
    fi
done
rm -rf "$MODULES"
mv "$KEEP" "$MODULES"
chmod 755 "$MODULES"
rm -f "$ROOTFS/usr/lib/modules/$KVER/vmlinuz"
mount_chroot
in_chroot depmod "$KVER"
unmount_chroot

rm -rf \
    "$ROOTFS"/usr/share/{doc,man,info,gtk-doc,help,i18n,gir-1.0} \
    "$ROOTFS"/usr/share/locale/* \
    "$ROOTFS"/usr/share/hwdata \
    "$ROOTFS"/usr/include \
    "$ROOTFS"/usr/lib/firmware \
    "$ROOTFS"/usr/lib/udev/hwdb.bin "$ROOTFS"/usr/lib/udev/hwdb.d \
    "$ROOTFS"/usr/share/ri "$ROOTFS"/usr/lib/ruby/gems/*/doc \
    "$ROOTFS"/usr/share/perl5/core_perl/pod \
    "$ROOTFS"/var/cache/pacman/pkg/* \
    "$ROOTFS"/archbtw-pacman.conf "$ROOTFS"/archbtw-packages.txt
find "$ROOTFS/usr/share/vim" -mindepth 2 -maxdepth 2 -type d \
    \( -name doc -o -name lang -o -name tutor -o -name spell \) -exec rm -rf {} + 2>/dev/null || true
find "$ROOTFS/usr/lib" -name '*.a' -type f -delete
find "$ROOTFS/usr/share/perl5" -name '*.pod' -type f -delete 2>/dev/null || true
# Device nodes, fifos and sockets can't be represented in 9p's JSON tree.
find "$ROOTFS" -xdev \( -type c -o -type b -o -type p -o -type s \) -delete

AFTER_MB=$(du -sm "$ROOTFS" | cut -f1)
echo "rootfs ${BEFORE_MB} MB -> ${AFTER_MB} MB"

# ------------------------------------------------------------------ 9p

log "Converting to v86's 9p format"
rm -rf "$OUT"
mkdir -p "$OUT/arch"

# Top-level entries by name: a leading "./" would make fs2json.py create a
# literal "." node at the root of the guest's filesystem.
(cd "$ROOTFS" && tar --numeric-owner -cf "$BUILD/rootfs.tar" $(ls -A))

# Both tools log a line per file; keep the tail so failures stay visible.
python3 "$TOOLS/fs2json.py" --zstd --out "$OUT/fs.json" "$BUILD/rootfs.tar" 2>&1 | tail -3
python3 "$TOOLS/copy-to-sha256.py" --zstd "$BUILD/rootfs.tar" "$OUT/arch" 2>&1 | tail -3

# ------------------------------------------------------------------ budget

ARCH_MB=$(du -sm "$OUT/arch" | cut -f1)
FILE_COUNT=$(find "$OUT/arch" -type f | wc -l)
FS_JSON_MB=$(du -sm "$OUT/fs.json" | cut -f1)

{
    echo "archbtw rootfs report"
    echo "kernel:              $KVER"
    echo "packages:            $PACKAGE_COUNT"
    echo "rootfs before strip: ${BEFORE_MB} MB"
    echo "rootfs after strip:  ${AFTER_MB} MB"
    echo "9p tree (zstd):      ${ARCH_MB} MB in $FILE_COUNT files"
    echo "fs.json:             ${FS_JSON_MB} MB"
    echo "budget:              ${BUDGET_MB} MB"
    echo
    echo "largest directories after strip:"
    # sed rather than head: head exits early, and under pipefail the SIGPIPE
    # that sort then gets would fail the whole build.
    du -xm --max-depth=3 "$ROOTFS/usr" 2>/dev/null | sort -rn | sed -n "1,15s|$ROOTFS||p"
} | tee "$OUT/rootfs-report.txt"

((ARCH_MB <= BUDGET_MB)) || die "9p tree is ${ARCH_MB} MB, over the ${BUDGET_MB} MB budget; drop a tier in scripts/manifest.mjs"

log "Done: $OUT"
