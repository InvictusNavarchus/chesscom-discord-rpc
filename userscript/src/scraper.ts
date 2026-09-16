import type { GamePayload } from './types';
import { scrapeChesscom } from './scrapers/chesscom';
import { scrapeLichess } from './scrapers/lichess';

export function scrapeGame(): GamePayload | null {
  const hostname = window.location.hostname;

  if (hostname === 'lichess.org' || hostname.endsWith('.lichess.org')) {
    return scrapeLichess();
  }

  if (hostname === 'chess.com' || hostname.endsWith('.chess.com')) {
    return scrapeChesscom();
  }

  return null;
}
