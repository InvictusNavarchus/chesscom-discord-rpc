import { error, log, warn } from './logger';
import type { GamePayload, PlayerData, PlayingAs } from './types';

function getElementText(el: Element | null): string {
  if (!el) return '';
  if (el instanceof HTMLElement) return el.innerText.trim();
  return (el.textContent || '').trim();
}

function getPlayerData(playerContainer: Element | null, identifier: string): PlayerData | null {
  if (!playerContainer) {
    warn(`Container missing for ${identifier}.`);
    return null;
  }

  const nameEl =
    playerContainer.querySelector('[data-test-element="user-tagline-username"]') ||
    playerContainer.querySelector('[class*="user-username"]');
  const ratingEl =
    playerContainer.querySelector('[data-cy="user-tagline-rating"]') ||
    playerContainer.querySelector('[class*="user-rating"]');

  if (!nameEl) warn(`Name element missing for ${identifier}.`);
  if (!ratingEl) warn(`Rating element missing for ${identifier}.`);

  return {
    name: nameEl ? getElementText(nameEl) : 'Unknown',
    rating: ratingEl ? getElementText(ratingEl).replace(/[()]/g, '').trim() : '?',
  };
}

function getClockTime(clockEl: Element | null): string {
  if (!clockEl) return '0:00';
  const timeEl =
    clockEl.querySelector('[role="timer"]') ||
    clockEl.querySelector('.clock-time-monospace');
  return timeEl ? getElementText(timeEl) : '0:00';
}

export function scrapeGame(): GamePayload | null {
  log('Scraping DOM...');

  // 1. Find local username to handle board flips
  const localUserEl = document.querySelector('[data-user-activity-key="profile"]');
  const localUsername = localUserEl ? getElementText(localUserEl) : null;

  if (!localUsername) warn('Could not find local username in the sidebar.');

  // 2. Find main player containers
  const topPlayerEl =
    document.querySelector('.player-top') || document.getElementById('board-layout-player-top');
  const bottomPlayerEl =
    document.querySelector('.player-bottom') || document.getElementById('board-layout-player-bottom');

  if (!topPlayerEl || !bottomPlayerEl) {
    log('Not currently in a game (player containers not found).');
    return null;
  }

  // 3. Determine colors (color class sits on the clock component inside each player row)
  const topClockEl =
    topPlayerEl.querySelector('.clock-component') || document.querySelector('.clock-top');
  const bottomClockEl =
    bottomPlayerEl.querySelector('.clock-component') || document.querySelector('.clock-bottom');

  const topIsWhite = topClockEl ? topClockEl.classList.contains('clock-white') : false;
  const bottomIsWhite = bottomClockEl ? bottomClockEl.classList.contains('clock-white') : false;

  if (!topIsWhite && !bottomIsWhite) {
    warn('Could not determine player colors. Waiting for clocks to render.');
    return null;
  }

  // 4. Extract Names and Ratings
  const topData = getPlayerData(topPlayerEl, 'Top Player');
  const bottomData = getPlayerData(bottomPlayerEl, 'Bottom Player');

  if (!topData || !bottomData) {
    error('Critical DOM mismatch. Aborting this cycle.');
    return null;
  }

  // 5. Extract Clocks
  topData.time = getClockTime(topClockEl);
  bottomData.time = getClockTime(bottomClockEl);

  // Whose turn it is, useful signal from clock-player-turn
  topData.turn = topClockEl ? topClockEl.classList.contains('clock-player-turn') : false;
  bottomData.turn = bottomClockEl ? bottomClockEl.classList.contains('clock-player-turn') : false;

  // 6. Map to White/Black
  const whiteData = topIsWhite ? topData : bottomData;
  const blackData = topIsWhite ? bottomData : topData;

  // 7. Determine exactly what the local player is doing
  let playingAs: PlayingAs = 'spectating';
  if (localUsername) {
    // Use case-insensitive matching just to be safe
    if (whiteData.name.toLowerCase() === localUsername.toLowerCase()) {
      playingAs = 'white';
    } else if (blackData.name.toLowerCase() === localUsername.toLowerCase()) {
      playingAs = 'black';
    } else {
      log(`Local user (${localUsername}) is not playing. Spectating match.`);
    }
  } else {
    // Fallback if the sidebar doesn't load for some reason
    playingAs = topIsWhite ? 'black' : 'white';
  }

  // 8. Construct Payload
  return {
    white: whiteData,
    black: blackData,
    playingAs,
    url: window.location.href,
    inGame: true,
  };
}
