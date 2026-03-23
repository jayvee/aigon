# Aigon on Linux

## Prerequisites

- **Node.js** 18+ (`node -v`)
- **Git** 2.20+ (`git --version`)
- **tmux** — required for all agent sessions (`tmux -V`)

Install on Ubuntu/Debian:
```bash
sudo apt install nodejs npm git tmux
```

Install on Fedora:
```bash
sudo dnf install nodejs npm git tmux
```

Install on Arch:
```bash
sudo pacman -S nodejs npm git tmux
```

## Install Aigon

```bash
npm install -g aigon
```

Or clone and link:
```bash
git clone https://github.com/jayvee/aigon.git
cd aigon
npm link
```

## Terminal Emulator Setup

Aigon opens terminal windows to attach to tmux agent sessions. On Linux, it checks for these emulators in order:

1. **kitty** (recommended) — fast, GPU-accelerated
2. **gnome-terminal** — default on GNOME desktops
3. **xterm** — universal fallback

Install your preferred terminal:
```bash
# kitty
sudo apt install kitty        # or: curl -L https://sw.kovidgoyal.net/kitty/installer.sh | sh

# gnome-terminal (usually pre-installed on GNOME)
sudo apt install gnome-terminal

# xterm
sudo apt install xterm
```

If no GUI terminal is found, aigon prints the `tmux attach` command for you to run manually. This works well for headless/SSH workflows.

### Configuring a Preferred Terminal

Set your preferred terminal in `~/.aigon/config.json`:

```json
{
  "linuxTerminal": "kitty"
}
```

## xdg-open

Aigon uses `xdg-open` to open files and URLs on Linux. It's usually pre-installed, but if not:

```bash
sudo apt install xdg-utils
```

## Running the Doctor

After installation, verify your setup:

```bash
aigon doctor
```

On Linux, doctor checks for:
- tmux availability
- Supported terminal emulators
- xdg-open availability

## Known Limitations vs macOS

| Feature | macOS | Linux |
|---------|-------|-------|
| Terminal launch | iTerm2 / Terminal.app / Warp | kitty / gnome-terminal / xterm |
| Window tiling | Automatic iTerm2 grid | Manual (`tmux select-layout tiled`) |
| Warp split panes | Full support | Not available |
| Trash on cleanup | Finder Trash | `gio trash` / `trash-put` / `rm` |
| Dashboard | Full support | Full support (web-based) |
| Worktrees | Full support | Full support |
| Agent sessions | Full support | Full support |

## Headless / SSH Usage

Aigon works in headless environments (servers, SSH, containers). When no GUI terminal is detected:
- Agent sessions are created in detached tmux sessions
- Aigon prints the `tmux attach -t <session>` command
- All other features (dashboard, state machine, worktrees) work normally

## Proxy Setup (Caddy)

The Aigon dev proxy uses Caddy, which works the same on Linux:

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Then run `aigon proxy-setup` as usual.
