import { UPDATE_INTERVAL_MS } from './config';
import { info, log } from './logger';
import { scrapeGame } from './scraper';
import { sendGameUpdate } from './adapters/rpc';

info('Userscript initialized. Waiting for game...');

function scrapeAndSend(): void {
  const payload = scrapeGame();
  if (!payload) return;

  log('Generated Payload:', payload);
  sendGameUpdate(payload);
}

// Start loop
setInterval(scrapeAndSend, UPDATE_INTERVAL_MS);
