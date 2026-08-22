// ==UserScript==
// @name         Chess.com Discord RPC Exporter
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Extracts live game data and sends it to a local server for Discord RPC
// @match        https://www.chess.com/game/*
// @match        https://www.chess.com/play/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration ---
    const LOCAL_PORT = 3344;
    const UPDATE_INTERVAL_MS = 2000; 
    const DEBUG = true; 
    // ---------------------

    // --- Logging Utilities ---
    const PREFIX = '[ChessRPC]';
    function log(...args) { if (DEBUG) console.log(PREFIX, ...args); }
    function warn(...args) { console.warn(PREFIX, ...args); }
    function error(...args) { console.error(PREFIX, ...args); }
    function info(...args) { console.info(PREFIX, ...args); }

    info("Userscript initialized. Waiting for game...");

    function getPlayerData(playerContainer, identifier) {
        if (!playerContainer) {
            warn(`Container missing for ${identifier}.`);
            return null;
        }
        
        const nameEl = playerContainer.querySelector('[data-test-element="user-tagline-username"]') ||
                       playerContainer.querySelector('[class*="user-username"]');
        const ratingEl = playerContainer.querySelector('[data-cy="user-tagline-rating"]') ||
                         playerContainer.querySelector('[class*="user-rating"]');
        
        if (!nameEl) warn(`Name element missing for ${identifier}.`);
        if (!ratingEl) warn(`Rating element missing for ${identifier}.`);

        return {
            name: nameEl ? nameEl.innerText.trim() : 'Unknown',
            rating: ratingEl ? ratingEl.innerText.replace(/[()]/g, '').trim() : '?'
        };
    }

    function scrapeAndSend() {
        log("Scraping DOM...");

        // 1. Find local username to handle board flips
        const localUserEl = document.querySelector('[data-user-activity-key="profile"]');
        const localUsername = localUserEl ? localUserEl.innerText.trim() : null;

        if (!localUsername) warn("Could not find local username in the sidebar.");

        // 2. Find main player containers
        const topPlayerEl = document.querySelector('.player-top') || document.getElementById('board-layout-player-top');
        const bottomPlayerEl = document.querySelector('.player-bottom') || document.getElementById('board-layout-player-bottom');
        
        if (!topPlayerEl || !bottomPlayerEl) {
            log("Not currently in a game (player containers not found).");
            return;
        }

        // 3. Determine colors (color class sits on the clock component inside each player row)
        const topClockEl = topPlayerEl.querySelector('.clock-component') ||
                           document.querySelector('.clock-top');
        const bottomClockEl = bottomPlayerEl.querySelector('.clock-component') ||
                              document.querySelector('.clock-bottom');

        const topIsWhite = topClockEl ? topClockEl.classList.contains('clock-white') : false;
        const bottomIsWhite = bottomClockEl ? bottomClockEl.classList.contains('clock-white') : false;
        
        if (!topIsWhite && !bottomIsWhite) {
            warn("Could not determine player colors. Waiting for clocks to render.");
            return;
        }

        // 4. Extract Names and Ratings
        const topData = getPlayerData(topPlayerEl, 'Top Player');
        const bottomData = getPlayerData(bottomPlayerEl, 'Bottom Player');

        if (!topData || !bottomData) {
            error("Critical DOM mismatch. Aborting this cycle.");
            return;
        }

        // 5. Extract Clocks (time lives in .clock-time-monospace[role="timer"])
        const getTime = (clockEl) => {
            if (!clockEl) return '0:00';
            const timeEl = clockEl.querySelector('[role="timer"]') ||
                           clockEl.querySelector('.clock-time-monospace');
            return timeEl ? timeEl.innerText.trim() : '0:00';
        };

        topData.time = getTime(topClockEl);
        bottomData.time = getTime(bottomClockEl);

        // Whose turn it is, useful signal from clock-player-turn
        topData.turn = topClockEl ? topClockEl.classList.contains('clock-player-turn') : false;
        bottomData.turn = bottomClockEl ? bottomClockEl.classList.contains('clock-player-turn') : false;

        // 6. Map to White/Black
        const whiteData = topIsWhite ? topData : bottomData;
        const blackData = topIsWhite ? bottomData : topData;

        // 7. Determine exactly what the local player is doing
        let playingAs = "spectating";
        if (localUsername) {
            // Use case-insensitive matching just to be safe
            if (whiteData.name.toLowerCase() === localUsername.toLowerCase()) {
                playingAs = "white";
            } else if (blackData.name.toLowerCase() === localUsername.toLowerCase()) {
                playingAs = "black";
            } else {
                log(`Local user (${localUsername}) is not playing. Spectating match.`);
            }
        } else {
            // Fallback if the sidebar doesn't load for some reason
            playingAs = topIsWhite ? "black" : "white";
        }

        // 8. Construct Payload
        const payload = {
            white: whiteData,
            black: blackData,
            playingAs: playingAs,
            url: window.location.href,
            inGame: true
        };

        log("Generated Payload:", payload);

        // 9. Send to Local Node Server
        GM_xmlhttpRequest({
            method: "POST",
            url: `http://localhost:${LOCAL_PORT}/update`,
            data: JSON.stringify(payload),
            headers: {
                "Content-Type": "application/json"
            },
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    log(`Success: Sent data to localhost:${LOCAL_PORT}. Server replied: ${response.responseText}`);
                } else {
                    warn(`Server rejected payload. HTTP ${response.status}: ${response.statusText}`);
                }
            },
            onerror: function(err) {
                error(`Network Error: Could not reach localhost:${LOCAL_PORT}. Is your Node.js server running?`);
            }
        });
    }

    // Start loop
    setInterval(scrapeAndSend, UPDATE_INTERVAL_MS);

})();