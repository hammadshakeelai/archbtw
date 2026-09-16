/**
 * What gets installed into the guest.
 *
 * Every name here must exist as an i686 build in archlinux32's core/extra.
 * `npm run resolve` proves that and prices the whole tree before anything is
 * downloaded, so a bad name fails in seconds rather than half an hour in.
 *
 * Order matters only for the budget: TIERS are dropped from the end when the
 * rootfs overflows the 1 GB GitHub Pages ceiling (spec: "Budget policy").
 */

/** The smallest thing that boots: kernel, init, shell, and pacman itself. */
export const BASE = [
  "base",
  "linux",
  "mkinitcpio",
  "systemd",
  "systemd-sysvcompat",
  "bash",
  "coreutils",
  "pacman",
  "less",
  "ncurses",
];

/**
 * Tiers, most important first. The budget cutter drops whole tiers from the
 * end, so the toys the site exists to show off are never the first casualty.
 */
export const TIERS = [
  {
    name: "toys",
    why: "the reason the site exists",
    packages: [
      "sl",
      "cmatrix",
      "cowsay",
      "figlet",
      "fortune-mod",
      "lolcat",
      "nyancat",
      "asciiquarium",
      "pv",
    ],
    // `toilet` is deliberately absent: it depends on libcaca -> libglvnd ->
    // mesa, dragging 260 MB of 3D driver into a machine with no GPU. figlet
    // renders the same ASCII banners for none of that.
  },
  {
    name: "fetch",
    why: "the screenshot everyone posts",
    packages: ["neofetch", "fastfetch", "screenfetch"],
  },
  {
    name: "games",
    why: "tetris, hangman, worm, robots, adventure",
    packages: ["bsd-games"],
  },
  {
    name: "shell",
    why: "makes the prompt worth staying at",
    // `mc` pulls glib2 (36 MB) and `ranger` pulls all of python (71 MB) for
    // file managers nobody visits a novelty terminal to use.
    packages: ["vim", "nano", "htop", "tmux", "fish", "zsh", "tree", "which", "bc"],
  },
  {
    name: "browse",
    why: "text browsers are a good gag with no network",
    packages: ["w3m", "lynx"],
  },
];

/** Everything, in tier order. */
export function allPackages(tiers = TIERS) {
  return [...BASE, ...tiers.flatMap((t) => t.packages)];
}
