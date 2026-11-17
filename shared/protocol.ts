import type { AthleteInfo, InputFrame, Snapshot } from './types';

export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'rejoin'; code: string; token: string }
  | { t: 'start' }
  | { t: 'pick'; ids: number[] }
  | { t: 'ready'; ready: boolean }
  | { t: 'input'; f: InputFrame }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'ping'; c: number };

export type RoomPhase = 'waiting' | 'pick' | 'countdown' | 'playing' | 'over';

export interface RoomPlayerView { name: string; connected: boolean; ready: boolean; picked: number }

export interface RoomView {
  t: 'room';
  code: string;
  seat: 0 | 1;
  token: string;
  phase: RoomPhase;
  players: (RoomPlayerView | null)[];
  options: AthleteInfo[]; // 5 opções do próprio jogador
  picked: number[];
  teams?: [AthleteInfo[], AthleteInfo[]];
  deadline?: number; // ms epoch (pick / countdown / reconexão)
  paused?: boolean;
  winner?: number;
  wo?: boolean;
  rematch?: boolean[];
  notice?: string; // aviso para ambos (ex.: faltam atletas cadastrados)
  roster?: number; // atletas ativos cadastrados
}

export type ServerMsg =
  | RoomView
  | { t: 'snap'; s: Snapshot }
  | { t: 'err'; msg: string }
  | { t: 'left' }
  | { t: 'pong'; c: number };
