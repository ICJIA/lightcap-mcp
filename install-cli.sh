#!/usr/bin/env bash
set -euo pipefail

# LightCap CLI installer (macOS + Linux) — makes `lightcap ...` available in
# your shell without the MCP server being registered anywhere.
#
# Usage:
#   ./install-cli.sh              — install (safe to re-run; updates paths in place)
#   ./install-cli.sh --uninstall  — remove the alias and the symlink
#
# What it does:
#   1. Checks Node >= 22.19 (Lighthouse 13) and runs npm install
#   2. Checks that Chrome/Chromium is installed (lightcap uses your system
#      Chrome via chrome-launcher; set CHROME_PATH to point at a specific one)
#   3. Adds a `lightcap` alias to ~/.zshrc (and ~/.bashrc if present, or if
#      bash is your login shell), inside a marked block — re-runs replace the
#      block rather than appending a duplicate
#   4. Symlinks ~/.local/bin/lightcap -> src/cli.js, so `lightcap` also works
#      in non-interactive shells that don't read aliases (e.g. Claude Code's
#      Bash tool, scripts, cron)
#   5. Runs a smoke-test audit against a tiny local page

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[lightcap]${NC} $1"; }
warn()  { echo -e "${YELLOW}[lightcap]${NC} $1"; }
error() { echo -e "${RED}[lightcap]${NC} $1" >&2; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$REPO_DIR/src/cli.js"
OS="$(uname -s)"
BIN_DIR="$HOME/.local/bin"
LINK="$BIN_DIR/lightcap"
MARK_START="# >>> lightcap cli >>>"
MARK_END="# <<< lightcap cli <<<"

# Shell rc files to manage: ~/.zshrc always (created if missing), plus
# ~/.bashrc when it exists or bash is the login shell (typical on Linux).
rc_files() {
  echo "${ZDOTDIR:-$HOME}/.zshrc"
  if [[ -f "$HOME/.bashrc" || "$(basename "${SHELL:-}")" == "bash" ]]; then
    echo "$HOME/.bashrc"
  fi
}

# Remove the marked block from an rc file (returns 1 if there was none).
remove_block() {
  local rc="$1"
  [[ -f "$rc" ]] || return 1
  if grep -qxF "$MARK_START" "$rc"; then
    local tmp
    tmp="$(mktemp)"
    awk -v s="$MARK_START" -v e="$MARK_END" '
      $0 == s { skip = 1; next }
      $0 == e { skip = 0; next }
      !skip
    ' "$rc" > "$tmp"
    cat "$tmp" > "$rc"   # preserve the original file's permissions/inode
    rm -f "$tmp"
    return 0
  fi
  return 1
}

add_block() {
  local rc="$1"
  touch "$rc"
  # If the file doesn't end in a newline, add one so the marker starts its
  # own line (otherwise it would be glued onto the user's last line).
  if [[ -s "$rc" && "$(tail -c 1 "$rc")" != "" ]]; then
    echo "" >> "$rc"
  fi
  {
    echo "$MARK_START"
    echo "# Managed by $REPO_DIR/install-cli.sh — remove with: install-cli.sh --uninstall"
    echo "alias lightcap='node \"$CLI\"'"
    echo "$MARK_END"
  } >> "$rc"
}

# Remove the symlink only if it is ours (points at a lightcap cli.js).
remove_link() {
  if [[ -L "$LINK" ]]; then
    local target
    target="$(readlink "$LINK")"
    if [[ "$target" == */src/cli.js ]]; then
      rm -f "$LINK"
      return 0
    fi
    warn "$LINK points at $target — not ours, leaving it alone."
  fi
  return 1
}

# ─── Uninstall ──────────────────────────────────────────────────────

if [[ "${1:-}" == "--uninstall" ]]; then
  for rc in "${ZDOTDIR:-$HOME}/.zshrc" "$HOME/.bashrc"; do
    if remove_block "$rc"; then info "Removed alias block from $rc"; fi
  done
  if remove_link; then info "Removed $LINK"; else info "No lightcap symlink at $LINK"; fi
  info "Done. Open a new shell (or run: unalias lightcap) to drop the alias from this session."
  exit 0
fi

if [[ -n "${1:-}" ]]; then
  error "Unknown argument: $1 (use --uninstall or no argument)"
  exit 1
fi

# ─── Preflight ──────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  error "Node.js not found. Install Node 22.19+ first."
  exit 1
fi

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=19)?0:1)'; then
  error "Node $(node -v) is too old — lightcap needs Node 22.19+ (required by Lighthouse 13)."
  exit 1
fi

if [[ ! -f "$CLI" ]]; then
  error "Can't find $CLI — run this script from the lightcap repo."
  exit 1
fi

# ─── Dependencies ───────────────────────────────────────────────────

cd "$REPO_DIR"
# Always run: it's fast when up to date, and catches a stale node_modules
# after a git pull.
info "Installing npm dependencies..."
npm install --no-fund --no-audit

info "Looking for Chrome/Chromium..."
if CHROME_FOUND="$(node --input-type=module -e "
  import { Launcher } from 'chrome-launcher';
  const p = process.env.CHROME_PATH || Launcher.getInstallations()[0];
  if (!p) process.exit(1);
  console.log(p);
" 2>/dev/null)"; then
  info "Using Chrome: $CHROME_FOUND"
else
  error "No Chrome/Chromium found. lightcap uses your system Chrome."
  if [[ "$OS" == "Darwin" ]]; then
    error "  Install Google Chrome: https://www.google.com/chrome/"
  else
    error "  Install one, e.g.:  sudo apt install chromium   (or google-chrome-stable)"
  fi
  error "  Or point at a binary:  export CHROME_PATH=/path/to/chrome"
  exit 1
fi

chmod +x "$CLI"

# ─── Shell alias ────────────────────────────────────────────────────

RC_FILES=()
while IFS= read -r rc; do RC_FILES+=("$rc"); done < <(rc_files)
for rc in "${RC_FILES[@]}"; do
  if remove_block "$rc"; then
    info "Updating alias in $rc"
  else
    info "Adding alias to $rc"
  fi
  add_block "$rc"
done

# ─── ~/.local/bin symlink ───────────────────────────────────────────

mkdir -p "$BIN_DIR"
if [[ -e "$LINK" && ! -L "$LINK" ]]; then
  warn "$LINK exists and is not a symlink — skipping (alias still works in interactive shells)."
elif [[ -L "$LINK" && "$(readlink "$LINK")" != */src/cli.js ]]; then
  warn "$LINK points at $(readlink "$LINK") — not ours, skipping."
else
  ln -sfn "$CLI" "$LINK"
  info "Symlinked $LINK -> $CLI"
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on your PATH — add it so non-interactive shells (and Claude) can find lightcap:"
     warn "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ${RC_FILES[0]}" ;;
esac

# ─── Verify ─────────────────────────────────────────────────────────

echo ""
node "$CLI" status
echo ""

info "Smoke test: auditing a tiny local page (takes a few seconds)..."
# Serve one page on a free localhost port from a throwaway Node server, audit
# it, then shut the server down. --no-diff keeps it out of the run history.
SMOKE_PORT_FILE="$(mktemp)"
node -e '
  const http = require("http");
  const page = "<!doctype html><html lang=en><head><title>t</title></head><body><main><h1>ok</h1></main></body></html>";
  const s = http.createServer((q, r) => { r.writeHead(200, {"content-type": "text/html"}); r.end(page); });
  s.listen(0, "127.0.0.1", () => require("fs").writeFileSync(process.argv[1], String(s.address().port)));
  setTimeout(() => process.exit(0), 90000).unref();
' "$SMOKE_PORT_FILE" &
SMOKE_PID=$!
for _ in $(seq 1 50); do [[ -s "$SMOKE_PORT_FILE" ]] && break; sleep 0.1; done
SMOKE_PORT="$(cat "$SMOKE_PORT_FILE")"
rm -f "$SMOKE_PORT_FILE"

SMOKE_OK=false
if [[ -n "$SMOKE_PORT" ]] && SMOKE_OUT="$(node "$CLI" --quiet a11y "http://127.0.0.1:$SMOKE_PORT/" --no-diff 2>&1)" \
    && [[ "$SMOKE_OUT" == A11y:* ]]; then
  SMOKE_OK=true
fi
kill "$SMOKE_PID" 2>/dev/null || true

if [[ "$SMOKE_OK" == true ]]; then
  info "Chrome launches and audits run: ${SMOKE_OUT%%$'\n'*}"
else
  error "Smoke-test audit failed: ${SMOKE_OUT:-no output}"
  if [[ "$OS" == "Linux" ]]; then
    error "On Linux, headless Chrome may need extra system libraries or a CHROME_PATH."
  fi
  exit 1
fi

echo ""
info "Installed. Run: source ${RC_FILES[0]}   (or open a new terminal)"
info "Try:  lightcap a11y https://example.com"
echo ""
info "To let Claude use the CLI when the MCP server isn't registered, add this to ~/.claude/CLAUDE.md:"
echo ""
echo "  - For Lighthouse audits, if the \`lightcap\` MCP tools aren't available, use the \`lightcap\` CLI via Bash"
echo "    (\`lightcap --quiet audit <url>\`, \`lightcap --quiet a11y <url>\`, \`lightcap status\`)."
echo "    Output is the same compressed text the MCP tools return. Run \`lightcap --help\` for options."
echo ""
