#
# ~/.bash_profile -- archbtw
#

[[ -f ~/.bashrc ]] && . ~/.bashrc

# Tell the snapshot builder (scripts/snapshot.mjs) that tty1 has reached a
# prompt. It listens on the serial port; in the browser nobody is listening,
# so this costs nothing after the snapshot is taken.
if [[ $(tty) == /dev/tty1 ]]; then
    printf 'ARCHBTW_READY\n' > /dev/ttyS0 2>/dev/null
fi
