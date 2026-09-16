// Configuration mirrored in server/main.py.
// Both constants below are mirrored in server/main.py and cannot be shared
// with it -- this runs in the Tampermonkey sandbox, with no access to the
// server's config.json.

export const LOCAL_PORT = 3344; // must equal PORT in server/main.py

// Must stay comfortably below IDLE_TIMEOUT in server/main.py (30s). The
// server treats a gap in these posts as "game over" and clears the Discord
// presence, so raising this too far wipes the presence mid-game, silently.
export const UPDATE_INTERVAL_MS = 2000;

export const DEBUG = true;
