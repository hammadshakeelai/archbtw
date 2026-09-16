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
        # Leave 16 MB for the kernel; memory not zeroed ships in the snapshot.
        zero_mb=$(awk '/^MemFree:/ { print int($2 / 1024) - 16 }' /proc/meminfo)
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

    # Every visitor resumes this same shell, so $RANDOM, the kernel's random
    # pool and the clock would be identical for all of them. Once the machine
    # is running the page writes the visitor's time and fresh random bytes to
    # /etc/archbtw over 9p; take them before the first command, then stop
    # looking. Set up last, so nothing looks for the files before the snapshot
    # (the guest would cache that they don't exist).
    archbtw_personalise() {
        [[ -z $ARCHBTW_PERSONALISED && -e /etc/archbtw/seed ]] || return 0
        ARCHBTW_PERSONALISED=1
        cat /etc/archbtw/seed > /dev/urandom
        RANDOM=$(od -An -N2 -tu2 /etc/archbtw/seed)
        [[ -s /etc/archbtw/now ]] && date --set="@$(< /etc/archbtw/now)" > /dev/null
        rm -f /etc/archbtw/seed /etc/archbtw/now
    }
    # The trap has to be removed at the top level: bash undoes changes to the
    # DEBUG trap made inside a function, including the handler itself.
    ARCHBTW_PROMPT_COMMAND=${PROMPT_COMMAND-}
    PROMPT_COMMAND='[[ -n $ARCHBTW_PERSONALISED ]] && { trap - DEBUG; unset -f archbtw_personalise; PROMPT_COMMAND=$ARCHBTW_PROMPT_COMMAND; unset ARCHBTW_PROMPT_COMMAND ARCHBTW_PERSONALISED; }'
    trap archbtw_personalise DEBUG
fi
