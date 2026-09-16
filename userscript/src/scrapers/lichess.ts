import { error, log, warn } from '../logger';
import type { GamePayload, PlayerData, PlayingAs } from '../types';
import { getElementText } from './dom';

function getLichessPlayerData(container: Element | null, identifier: string): PlayerData | null {
  if (!container) {
    warn(`Container missing for ${identifier}.`);
    return null;
  }

  const nameEl = container.querySelector('a.user-link') || container.querySelector('.user-link');
  const ratingEl = container.querySelector('rating') || container.querySelector('.rating');

  if (!nameEl) warn(`Name element missing for ${identifier}.`);
  if (!ratingEl) warn(`Rating element missing for ${identifier}.`);

  return {
    name: nameEl ? getElementText(nameEl) : 'Unknown',
    rating: ratingEl ? getElementText(ratingEl).replace(/[()]/g, '').trim() : '?',
  };
}

function getLichessClockTime(clockEl: Element | null): string {
  if (!clockEl) return '0:00';
  const timeEl = clockEl.querySelector('.time');
  return timeEl ? getElementText(timeEl) : '0:00';
}

export function scrapeLichess(): GamePayload | null {
  log('Scraping Lichess DOM...');

  // 1. Check if in active round
  const roundApp = document.querySelector('.round__app');
  if (!roundApp) {
    log('Not currently in a game (round container not found).');
    return null;
  }

  // 2. Find player containers
  const topPlayerEl = document.querySelector('.ruser-top');
  const bottomPlayerEl = document.querySelector('.ruser-bottom');

  if (!topPlayerEl || !bottomPlayerEl) {
    log('Not currently in a game (player containers not found).');
    return null;
  }

  // 3. Determine player colors (clocks carry rclock-white / rclock-black)
  const topClockEl = document.querySelector('.rclock-top');
  const bottomClockEl = document.querySelector('.rclock-bottom');

  const topIsWhite = topClockEl ? topClockEl.classList.contains('rclock-white') : false;
  const bottomIsWhite = bottomClockEl ? bottomClockEl.classList.contains('rclock-white') : false;

  const boardWrap = document.querySelector('.cg-wrap');
  let resolvedTopIsWhite = topIsWhite;

  if (!topIsWhite && !bottomIsWhite) {
    if (boardWrap) {
      // Bottom player corresponds to board orientation
      const isOrientationWhite = boardWrap.classList.contains('orientation-white');
      resolvedTopIsWhite = !isOrientationWhite;
    } else {
      warn('Could not determine player colors. Waiting for clocks or board to render.');
      return null;
    }
  }

  // 4. Extract Names and Ratings
  const topData = getLichessPlayerData(topPlayerEl, 'Top Player');
  const bottomData = getLichessPlayerData(bottomPlayerEl, 'Bottom Player');

  if (!topData || !bottomData) {
    error('Critical DOM mismatch. Aborting this cycle.');
    return null;
  }

  // 5. Extract Clocks and Active Turn (running class)
  topData.time = getLichessClockTime(topClockEl);
  bottomData.time = getLichessClockTime(bottomClockEl);

  topData.turn = topClockEl ? topClockEl.classList.contains('running') : false;
  bottomData.turn = bottomClockEl ? bottomClockEl.classList.contains('running') : false;

  // 6. Map to White/Black
  const whiteData = resolvedTopIsWhite ? topData : bottomData;
  const blackData = resolvedTopIsWhite ? bottomData : topData;

  // 7. Determine local user and playing status
  const localUserEl = document.getElementById('user_tag') || document.querySelector('a#user_tag');
  const localUsername = localUserEl ? getElementText(localUserEl) : null;

  const isInteractive = Boolean(
    document.querySelector('.rcontrols .resign') ||
    document.querySelector('.cg-wrap.manipulable')
  );

  let playingAs: PlayingAs = 'spectating';
  if (localUsername) {
    if (whiteData.name.toLowerCase() === localUsername.toLowerCase()) {
      playingAs = 'white';
    } else if (blackData.name.toLowerCase() === localUsername.toLowerCase()) {
      playingAs = 'black';
    } else if (isInteractive && boardWrap) {
      playingAs = boardWrap.classList.contains('orientation-white') ? 'white' : 'black';
    } else {
      log(`Local user (${localUsername}) is not playing. Spectating match.`);
    }
  } else if (isInteractive && boardWrap) {
    playingAs = boardWrap.classList.contains('orientation-white') ? 'white' : 'black';
  }

  // 8. Public Game URL (strip player secret suffix down to 8-character game ID)
  const match = window.location.pathname.match(/^\/([a-zA-Z0-9]{8})/);
  const cleanUrl = match ? `${window.location.origin}/${match[1]}` : window.location.href;

  return {
    site: 'lichess',
    white: whiteData,
    black: blackData,
    playingAs,
    url: cleanUrl,
    inGame: true,
  };
}
