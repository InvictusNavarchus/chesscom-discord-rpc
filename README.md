# Chess.com Discord RPC

Shows your live Chess.com game as Discord Rich Presence.

Two halves that must both be running:

- **`userscript/`** — a Tampermonkey script that scrapes the board page every
  2s and POSTs the players, ratings and clocks to localhost.
- **`server/`** — a small Python HTTP listener that forwards those payloads to
  the Discord desktop client over its local IPC socket.

Chess.com is scraped from the DOM, so a site redesign can break extraction.
That surfaces as warnings in the browser console, not as a server error.

> All commands below are run from the repository root.

## Requirements

- Discord **desktop** client (the web app exposes no IPC socket)
- [Tampermonkey](https://www.tampermonkey.net/)
- [`uv`](https://docs.astral.sh/uv/), and Python ≥ 3.14

## Setup

### 1. Discord application

Create an app at the [Developer Portal](https://discord.com/developers/applications).
Take its **Application ID** for `client_id`, and upload your artwork under
**Rich Presence → Art Assets**; `large_image` / `small_image` are the asset
*names* you give them there, not URLs.

### 2. Configure

```bash
cp server/config.json.example server/config.json
```

| Key | Meaning |
| --- | --- |
| `client_id` | Your Discord Application ID |
| `game_mode` | Free text appended to the details line, e.g. `Rapid • 30` |
| `large_image` | Art asset name for the big icon |
| `large_text` | Tooltip on the big icon |
| `small_image` | Art asset name for the corner badge |

`config.json` is gitignored. `install.sh` will create it from the example if
it is missing, but the example's `client_id` is not yours — set it.

### 3. Install the server

```bash
./install.sh
```

Installs a **systemd user service** that starts at login. It creates the venv
if needed, validates `config.json`, refuses to install if something else holds
port 3344, and verifies the service actually came up.

`./install.sh --uninstall` reverses it. `config.json` and `.venv` are
left alone.

To run it by hand instead:

```bash
cd server && uv run main.py
```

### 4. Install the userscript

Open `userscript/chesscom-rpc-exporter.user.js` in Tampermonkey's editor and
save it. It activates on `chess.com/game/*` and `chess.com/play/*`.

> Reinstall this file after pulling changes to it. Tampermonkey pins the
> `@connect` grant at install time, so an old copy is *blocked* from reaching
> the server and simply logs a network error.

## Behavior

- **The server does not touch Discord until the userscript sends something.**
  No game, no connection, no presence — so autostarting it at login is safe.
- **Discord need not be running when the server starts.** It connects lazily
  and retries every 15s, so login ordering doesn't matter. A Discord restart
  is recovered from on the next payload.
- **Presence is cleared after 30s of silence.** The userscript never sends
  "game over" — it just stops posting — so the gap *is* the signal. This also
  covers a closed tab or a browser crash.
- **Updates are throttled to once per 15s**, Discord's rate limit.
- **Listens on `127.0.0.1` only.** It accepts unauthenticated payloads, so it
  is deliberately unreachable from the network.

## Operating

| Task | Command |
| --- | --- |
| Logs | `journalctl --user -u chesscom-rpc -f` |
| Restart after editing `main.py` or `config.json` | `systemctl --user restart chesscom-rpc` |
| Apply an edit to `server/chesscom-rpc.service.in` | `./install.sh` |
| Stop | `systemctl --user stop chesscom-rpc` |

Editing `server/main.py` needs only a restart; the unit references it by
path. Only template edits and moving the repo need `install.sh` re-run.

Because the unit is `Restart=always`, a startup crash loops every 5s and shows
as `activating (auto-restart)` rather than `failed` — which reads as "busy",
not "broken". Check the logs after any edit.

## Releasing

```bash
./bump.sh 0.2.0
```

Rewrites the version in `server/pyproject.toml`, the userscript's `@version`
header and `server/uv.lock`, then commits and tags. It refuses to run on a
dirty tree, and refuses if those files have already drifted apart rather than
papering over it.

It stops there — review, then push and publish with the commands it prints.

The userscript's `@version` is the one that will matter: add `@updateURL` and
Tampermonkey uses that number to decide whether anyone receives an update.

## Shared constants

Two values are duplicated between the server and the userscript. They cannot
be centralised: the userscript runs in Tampermonkey's sandbox and can never
read `config.json`.

| `server/main.py` | userscript | Constraint |
| --- | --- | --- |
| `PORT` | `LOCAL_PORT` | Must be equal |
| `IDLE_TIMEOUT` (30s) | `UPDATE_INTERVAL_MS` (2s) | Interval must stay well below the timeout |

The first fails loudly — a network error every 2s in the console. The second
fails **silently**: raise the interval past the timeout and the presence gets
cleared mid-game, because from the server's side an idle userscript and a
finished game are indistinguishable.
