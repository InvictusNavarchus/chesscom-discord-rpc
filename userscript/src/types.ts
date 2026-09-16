export type PlayingAs = 'white' | 'black' | 'spectating';

export interface PlayerData {
  name: string;
  rating: string;
  time?: string;
  turn?: boolean;
}

export interface GamePayload {
  white: PlayerData;
  black: PlayerData;
  playingAs: PlayingAs;
  url: string;
  inGame: boolean;
}
