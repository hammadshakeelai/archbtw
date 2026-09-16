#
# ~/.bash_profile -- archbtw
#

[[ -f ~/.bashrc ]] && . ~/.bashrc

if [[ $(tty) == /dev/tty1 ]]; then
    # Once, on the boot the snapshot is taken from: shrink the snapshot.
    # Everything the boot read over 9p is still in the page cache, and freed
    # memory keeps its old contents, so the saved RAM compresses poorly. Drop
    # the cache, then fill free memory with zeros through a tmpfs and release
    # it again. Nothing is printed, so the screen still shows the MOTD.
    if [[ -e /etc/archbtw/snapshot-pending ]]; then
        rm -f /etc/archbtw/snapshot-pending
        # udev has set up every device this machine will ever have. Left
        # running, it rereads its rules over 9p after a resume.
        systemctl stop systemd-udevd-kernel.socket systemd-udevd-control.socket systemd-udevd.service 2>/dev/null
        sync
        echo 3 > /proc/sys/vm/drop_caches
        zero_mb=$(awk '/^MemFree:/ { print int($2 / 1024) - 32 }' /proc/meminfo)
        if (( zero_mb > 0 )); then
            mkdir -p /run/archbtw-zero
            if mount -t tmpfs -o "size=${zero_mb}m" tmpfs /run/archbtw-zero; then
                dd if=/dev/zero of=/run/archbtw-zero/fill bs=1M count="$zero_mb" status=none 2>/dev/null
                umount /run/archbtw-zero
            fi
            rmdir /run/archbtw-zero
        fi

        # Where the snapshot's memory goes, for the build log.
        {
            echo "--- memory at snapshot ---"
            grep -E '^(MemTotal|MemFree|MemAvailable|Buffers|Cached|Shmem|Slab|SReclaimable|SUnreclaim|KernelStack|PageTables|AnonPages|Mapped):' /proc/meminfo
            echo "--- largest processes (RSS kB) ---"
            ps -eo rss=,comm= --sort=-rss | head -12
            echo "--- end ---"
        } > /dev/ttyS0 2>&1
    fi

    # Tell the snapshot builder (scripts/snapshot.ts) that tty1 has reached a
    # prompt. It listens on the serial port; in the browser nobody is
    # listening, so this costs nothing after the snapshot is taken.
    printf 'ARCHBTW_READY\n' > /dev/ttyS0 2>/dev/null
fi
