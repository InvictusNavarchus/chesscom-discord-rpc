#!/usr/bin/env bash
#
# Install (or remove) the Chess.com Discord RPC bridge as a systemd user
# service. Safe to re-run: it re-renders the unit and restarts the service,
# so this is also how you apply an edit to chesscom-rpc.service.in.
#
#   ./install.sh              install and start
#   ./install.sh --uninstall  stop, disable, and remove the unit

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$REPO_ROOT/server"
UNIT_NAME="chesscom-rpc.service"
TEMPLATE="$SERVER_DIR/$UNIT_NAME.in"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$UNIT_DIR/$UNIT_NAME"
VENV_PY="$SERVER_DIR/.venv/bin/python"
PORT=3344

if [[ -t 1 ]]; then
    R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
else
    R=''; G=''; Y=''; B=''; N=''
fi

info() { printf '%s==>%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%swarn:%s %s\n' "$Y" "$N" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

require_systemd() {
    command -v systemctl >/dev/null 2>&1 \
        || die "systemctl not found; this installer targets systemd."
    # A user instance is not guaranteed to exist (containers, some remote
    # sessions). Fail here rather than emitting confusing errors later.
    systemctl --user show-environment >/dev/null 2>&1 \
        || die "no systemd user instance is running for '$(id -un)'."
}

uninstall() {
    require_systemd
    # Tolerate an already-absent unit: this is idempotency, not error hiding.
    systemctl --user disable --now "$UNIT_NAME" >/dev/null 2>&1 || true
    rm -f "$UNIT_PATH"
    systemctl --user daemon-reload
    info "Removed $UNIT_NAME. Your config.json and .venv were left alone."
    exit 0
}

case "${1-}" in
    "")           ;;
    --uninstall)  uninstall ;;
    -h|--help)    sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
    *)            die "unknown argument: $1 (try --help)" ;;
esac

require_systemd

[[ -f "$TEMPLATE" ]] || die "missing unit template: $TEMPLATE"

# The unit is rendered with sed using '|' as the delimiter.
case "$SERVER_DIR" in
    *"|"*) die "install path contains '|', which would corrupt the unit file: $SERVER_DIR" ;;
esac

# --- Dependencies -----------------------------------------------------------

if [[ ! -x "$VENV_PY" ]]; then
    command -v uv >/dev/null 2>&1 \
        || die ".venv is missing and 'uv' is not installed. Install uv, or create the venv yourself."
    info "No .venv found; creating it with 'uv sync'."
    (cd "$SERVER_DIR" && uv sync)
fi

[[ -x "$VENV_PY" ]] || die "expected a Python interpreter at $VENV_PY"

"$VENV_PY" -c 'import pypresence' >/dev/null 2>&1 \
    || die "pypresence is not installed in the venv. Run 'uv sync' in $SERVER_DIR."

# --- Configuration ----------------------------------------------------------

if [[ ! -f "$SERVER_DIR/config.json" ]]; then
    [[ -f "$SERVER_DIR/config.json.example" ]] \
        || die "neither config.json nor config.json.example exists in $SERVER_DIR"
    cp "$SERVER_DIR/config.json.example" "$SERVER_DIR/config.json"
    warn "Created config.json from the example. Check that client_id is your own Discord app."
fi

# main.py reads this at startup and dies on malformed JSON, which under
# Restart=always would be a silent restart loop. Catch it here instead.
"$VENV_PY" -c 'import json,sys; json.load(open(sys.argv[1]))' "$SERVER_DIR/config.json" \
    >/dev/null 2>&1 || die "config.json is not valid JSON."

# --- Port conflict ----------------------------------------------------------

# A manually started main.py holding :3344 would make the service fail to bind
# on every restart, forever, with Restart=always. Refuse rather than loop.
if command -v ss >/dev/null 2>&1 && ss -lntH "sport = :$PORT" 2>/dev/null | grep -q .; then
    if ! systemctl --user is-active --quiet "$UNIT_NAME" 2>/dev/null; then
        die "port $PORT is already in use, and not by $UNIT_NAME.
       A manually started main.py? Stop it first, or the service will
       restart-loop failing to bind."
    fi
fi

# --- Install ----------------------------------------------------------------

mkdir -p "$UNIT_DIR"
sed "s|@SERVER_DIR@|$SERVER_DIR|g" "$TEMPLATE" > "$UNIT_PATH"
info "Wrote $UNIT_PATH"

systemctl --user daemon-reload
systemctl --user enable "$UNIT_NAME" >/dev/null
# restart, not 'enable --now': --now won't restart an already-running service,
# so re-running after a template edit would leave the old unit live.
systemctl --user restart "$UNIT_NAME"

# --- Verify -----------------------------------------------------------------

sleep 1
if ! systemctl --user is-active --quiet "$UNIT_NAME"; then
    printf '\n'
    systemctl --user status "$UNIT_NAME" --no-pager --lines=20 || true
    die "$UNIT_NAME failed to start (status above)."
fi

if command -v ss >/dev/null 2>&1 && ! ss -lntH "sport = :$PORT" 2>/dev/null | grep -q .; then
    warn "service is active but nothing is listening on :$PORT yet."
fi

info "${B}$UNIT_NAME is running and enabled at login.${N}"
printf '\n'
printf '  Logs:    journalctl --user -u %s -f\n' "$UNIT_NAME"
printf '  Stop:    systemctl --user stop %s\n' "$UNIT_NAME"
printf '  Remove:  %s/install.sh --uninstall\n' "$REPO_ROOT"
printf '\n'
printf '  Discord does not need to be running: the bridge connects lazily on\n'
printf '  the first payload from the userscript.\n'
printf '\n'
printf '%sOne manual step remains -- this installs the server only.%s\n' "$Y" "$N"
printf '  Load %s/userscript/chesscom-rpc-exporter.user.js into Tampermonkey.\n' "$REPO_ROOT"
printf '  Reinstall it there after any change to that file: Tampermonkey pins\n'
printf '  the @connect grant, so a stale copy is blocked from reaching :%s.\n' "$PORT"
