import { GM_xmlhttpRequest } from '$';
import { LOCAL_PORT } from '../config';
import { error, log, warn } from '../logger';
import type { GamePayload } from '../types';

export function sendGameUpdate(payload: GamePayload): void {
  GM_xmlhttpRequest({
    method: 'POST',
    url: `http://127.0.0.1:${LOCAL_PORT}/update`,
    data: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
    },
    onload(response) {
      if (response.status >= 200 && response.status < 300) {
        log(`Success: Sent data to 127.0.0.1:${LOCAL_PORT}. Server replied: ${response.responseText}`);
      } else {
        warn(`Server rejected payload. HTTP ${response.status}: ${response.statusText}`);
      }
    },
    onerror() {
      error(`Network Error: Could not reach 127.0.0.1:${LOCAL_PORT}. Is the RPC server running?`);
    },
  });
}
