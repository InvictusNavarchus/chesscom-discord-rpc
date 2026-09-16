import json
import os
import signal
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from pypresence import Presence

# Resolve config against this file, not the process CWD: as a systemd unit we
# are not started from this directory.
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

with open(CONFIG_PATH, "r") as f:
    config = json.load(f)

# Loopback only: this accepts unauthenticated presence data, so it has no
# business being reachable from the LAN. Bound to the IPv4 literal rather than
# "localhost", which resolves to ::1 first under RFC 6724 -- the userscript
# posts to 127.0.0.1 to match.
HOST = "127.0.0.1"
# Duplicated as LOCAL_PORT in userscript/chesscom-rpc-exporter.user.js; the
# browser sandbox cannot read this file, so the two must be changed together.
# A mismatch is at least loud: the userscript logs a network error every 2s.
PORT = 3344

# Discord rate-limits activity updates to once per 15 seconds.
UPDATE_THROTTLE = 15

# The userscript posts every 2s while a game is on screen and simply stops
# posting otherwise -- it never sends an explicit "game over". Absence of
# payloads is therefore our only end-of-game signal, and it is the one that
# also covers a browser crash or a killed tab.
#
# This MUST stay comfortably above UPDATE_INTERVAL_MS in the userscript.
# Raise that interval past this value and the presence gets cleared in the
# middle of a live game -- with no error on either side, because from here an
# idle userscript and a finished game look identical.
IDLE_TIMEOUT = 30

# Discord is typically not up yet when this starts at login, and may restart
# underneath us. Don't hammer the IPC socket while it is away.
CONNECT_RETRY = 15

rpc = None
last_connect_attempt = 0.0
last_payload_at = 0.0
last_update = 0.0
game_start = None  # elapsed-time anchor; None means "no game on screen"


def ensure_rpc():
    """Return a connected Presence, or None if Discord isn't reachable yet."""
    global rpc, last_connect_attempt

    if rpc is not None:
        return rpc

    now = time.time()
    if now - last_connect_attempt < CONNECT_RETRY:
        return None
    last_connect_attempt = now

    try:
        candidate = Presence(config["client_id"])
        candidate.connect()
    except Exception as e:
        print(f"[Discord] Unreachable ({e}); retrying in {CONNECT_RETRY}s.")
        return None

    rpc = candidate
    print("[Discord] Connected.")
    return rpc


def drop_rpc():
    """Discard a dead connection so the next payload reconnects.

    Deliberately avoids Presence.close(), which writes a close frame to the
    very socket we just failed on; we only want the event loop's fd back.
    """
    global rpc
    if rpc is not None:
        try:
            rpc.loop.close()
        except Exception:
            pass
    rpc = None


def go_idle(reason):
    """Drop back to 'no game' and wipe the presence Discord is still showing."""
    global game_start

    if game_start is None:
        return
    game_start = None

    if rpc is None:
        return

    try:
        rpc.clear()
        print(f"[Discord] Presence cleared ({reason}).")
    except Exception as e:
        print(f"[Discord] Clear failed ({e}); dropping connection.")
        drop_rpc()


def check_idle():
    """Called from the serve_forever poll loop, on the main thread."""
    if game_start is None:
        return
    if time.time() - last_payload_at < IDLE_TIMEOUT:
        return
    go_idle(f"no data for {IDLE_TIMEOUT}s")


SUPPORTED_PLATFORMS = {"chesscom", "lichess"}


def resolve_platform(data):
    site = data.get("site")
    if site in SUPPORTED_PLATFORMS:
        return site
    return None


def build_activity(data):
    """Format the payload into Discord's details/state/small_text strings."""
    playing_as = data.get("playingAs")
    white = data.get("white", {})
    black = data.get("black", {})

    platform = resolve_platform(data)
    site_cfg = config.get("sites", {}).get(platform, {}) if platform else {}
    game_mode = site_cfg.get("game_mode", config.get("game_mode", ""))

    if playing_as == "spectating":
        details = f"Spectating a match | {game_mode}" if game_mode else "Spectating a match"
        state = f"{white.get('name')} vs {black.get('name')} | {white.get('time')} - {black.get('time')}"
        small_text = "Spectating"
    else:
        my_data = white if playing_as == "white" else black
        opp_data = black if playing_as == "white" else white

        details = f"Playing as {playing_as.capitalize()} ({my_data.get('rating')}) | {game_mode}" if game_mode else f"Playing as {playing_as.capitalize()} ({my_data.get('rating')})"
        state = f"vs {opp_data.get('name')} ({opp_data.get('rating')}) | {white.get('time')} - {black.get('time')}"
        small_text = f"Playing as {playing_as.capitalize()}"

    return details, state, small_text



class ChessRPCServer(HTTPServer):
    # serve_forever() calls this between polls, so the idle check runs on the
    # same thread as request handling -- no locking, and no asyncio loop shared
    # across threads.
    def service_actions(self):
        check_idle()


class ChessRPCHandler(BaseHTTPRequestHandler):

    # Handle CORS preflight requests (just in case the browser enforces it)
    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # Handle the data payload from the Userscript
    def do_POST(self):
        global last_payload_at, last_update, game_start

        # Send standard headers
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        # Read the payload
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)

        try:
            data = json.loads(post_data.decode('utf-8'))
        except json.JSONDecodeError:
            print("[Error] Received invalid JSON payload.")
            return

        now = time.time()

        # Recorded before any early return below: this is the liveness signal
        # check_idle() reads, and it must not depend on whether we ended up
        # pushing to Discord.
        last_payload_at = now

        if not data.get("inGame"):
            go_idle("userscript reports no game")
            return

        if game_start is None:
            game_start = int(now)
            print("[Game] Started.")

        # Throttle updates to avoid hitting Discord's rate limit
        if now - last_update < UPDATE_THROTTLE:
            return

        client = ensure_rpc()
        if client is None:
            return

        details, state, small_text = build_activity(data)

        platform = resolve_platform(data)
        site_cfg = config.get("sites", {}).get(platform, {}) if platform else {}

        large_image = site_cfg.get("large_image") or config.get("large_image")
        default_large_text = "Lichess.org" if platform == "lichess" else config.get("large_text")
        large_text = site_cfg.get("large_text") or default_large_text
        small_image = site_cfg.get("small_image") or config.get("small_image")

        try:
            client.update(
                details=details,
                state=state,
                large_image=large_image,
                large_text=large_text,
                small_image=small_image,
                small_text=small_text,
                start=game_start,
                buttons=[{"label": "Watch Live", "url": data.get("url")}]
            )


            last_update = now
            print(f"[Updated RPC] {details} | {state}")

        except Exception as e:
            print(f"[Error] Failed to update Discord RPC: {e}")
            drop_rpc()

    # Suppress default HTTP request logging so it doesn't spam the console
    def log_message(self, format, *args):
        pass


# --- Start Server ---
if __name__ == '__main__':
    # Route systemd's SIGTERM through the same path as Ctrl-C so a stopped
    # service still clears the presence on its way out.
    def on_sigterm(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, on_sigterm)

    server_address = (HOST, PORT)
    httpd = ChessRPCServer(server_address, ChessRPCHandler)
    print(f"Listening for chess data (Chess.com & Lichess) on http://{HOST}:{PORT}")

    try:

        httpd.serve_forever(poll_interval=2)
    except KeyboardInterrupt:
        print("\nShutting down.")
        go_idle("shutting down")
        httpd.server_close()
