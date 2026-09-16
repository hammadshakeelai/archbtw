#
# ~/.bashrc -- archbtw
#

# If not running interactively, don't do anything
[[ $- != *i* ]] && return

export LANG=C.UTF-8
export EDITOR=vim
export PAGER=less

alias ls='ls --color=auto'
alias ll='ls -lah --color=auto'
alias grep='grep --color=auto'
alias btw='echo "I use Arch btw"'

# The default Arch prompt, with colour.
PS1='[\[\e[1;36m\]\u\[\e[0m\]@\[\e[1;34m\]\h\[\e[0m\] \W]\$ '
