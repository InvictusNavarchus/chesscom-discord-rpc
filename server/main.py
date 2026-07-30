import time
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pypresence import Presence

# --- Load Configuration ---
with open("config.json", "r") as f:
    config = json.load(f)

RPC = Presence(config["client_id"])
RPC.connect()
print("Connected to Discord.")

# Discord limits updates to once per 15 seconds
last_update = 0
start_time = int(time.time())

class ChessRPCServer(BaseHTTPRequestHandler):
    
    # Handle CORS preflight requests (just in case the browser enforces it)
    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # Handle the data payload from the Userscript
    def do_POST(self):
        global last_update
        
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

        # Throttle updates to avoid hitting Discord's rate limit
        now = time.time()
        if now - last_update < 15:
            return 

        if data.get("inGame"):
            playing_as = data.get("playingAs")
            white = data.get("white", {})
            black = data.get("black", {})
            url = data.get("url")

            # 1. Format text based on Spectating vs Playing
            game_mode = config.get("game_mode", "")

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

            # 2. Push Update to Discord
            try:
                RPC.update(
                    details=details,
                    state=state,
                    large_image=config.get("large_image"),
                    large_text=config.get("large_text"),
                    small_image=config.get("small_image"),
                    small_text=small_text,
                    start=start_time,
                    buttons=[{"label": "Watch Live", "url": url}]
                )
                
                last_update = now
                print(f"[Updated RPC] {details} | {state}")
                
            except Exception as e:
                print(f"[Error] Failed to update Discord RPC: {e}")

    # Suppress default HTTP request logging so it doesn't spam the console
    def log_message(self, format, *args):
        pass

# --- Start Server ---
if __name__ == '__main__':
    server_address = ('', 3344)
    httpd = HTTPServer(server_address, ChessRPCServer)
    print("Listening for Chess.com data on http://localhost:3344")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        httpd.server_close()