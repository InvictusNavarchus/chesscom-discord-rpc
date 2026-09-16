import { DEBUG } from './config';

const PREFIX = '[ChessRPC]';

export function log(...args: unknown[]): void {
  if (DEBUG) console.log(PREFIX, ...args);
}

export function warn(...args: unknown[]): void {
  console.warn(PREFIX, ...args);
}

export function error(...args: unknown[]): void {
  console.error(PREFIX, ...args);
}

export function info(...args: unknown[]): void {
  console.info(PREFIX, ...args);
}
