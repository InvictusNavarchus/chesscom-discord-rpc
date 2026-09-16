import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Chess.com & Lichess Discord RPC Exporter',
        namespace: 'http://tampermonkey.net/',
        version: pkg.version,
        description: 'Extracts live game data from Chess.com and Lichess and sends it to a local server for Discord RPC',
        match: [
          'https://www.chess.com/game/*',
          'https://www.chess.com/play/*',
          'https://lichess.org/*',
          'https://www.lichess.org/*',
        ],

        grant: ['GM_xmlhttpRequest'],
        connect: ['127.0.0.1'],
      },
      build: {
        fileName: 'chesscom-rpc-exporter.user.js',
      },
    }),
  ],
});
