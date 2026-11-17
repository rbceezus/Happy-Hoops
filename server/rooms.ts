// Salas, lobby, escolha de atletas e loop de jogo autoritativo.
import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { BAL } from '../shared/balance';
import type { ClientMsg, RoomPhase, RoomView, ServerMsg } from '../shared/protocol';
import { Game } from '../shared/sim';
import { AthleteInfo, InputEvent, InputFrame, Team, emptyInput } from '../shared/types';
import { listAthletes } from './db';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PICK_SECONDS = 30;
const COUNTDOWN_SECONDS = 3;
const RECONNECT_MS = 30_000;
const IDLE_MS = 10 * 60 * 1000;
const MAX_ROOMS = 300;

interface Seat {
  name: string;
  token: string;
  ws: WebSocket | null;
  options: AthleteInfo[];
  picked: number[];
  ready: boolean;
  rematch: boolean;
  disconnectedAt: number;
  msgCount: number;
}

const EV_KINDS = new Set(['shootDown', 'shootUp', 'pass', 'cross', 'spin', 'switch', 'select', 'dunk', 'dunkUp', 'check']);

export function sanitizeInput(raw: unknown): InputFrame | null {
  const f = raw as Partial<InputFrame> | null;
  if (!f || typeof f !== 'object') return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  const out: InputFrame = { mx: num(f.mx), mz: num(f.mz), run: !!f.run, contest: !!f.contest, ev: [] };
  if (Array.isArray(f.ev)) {
    for (const e of f.ev.slice(0, 8) as InputEvent[]) {
      if (!e || typeof e !== 'object' || !EV_KINDS.has((e as { k: string }).k)) continue;
      if (e.k === 'shootUp' || e.k === 'dunkUp') out.ev.push({ k: e.k, hold: Math.max(0, Math.min(2000, Number(e.hold) || 0)) });
      else if (e.k === 'pass') out.ev.push({ k: 'pass', kind: e.kind === 'bounce' ? 'bounce' : 'chest' });
      else if (e.k === 'select') out.ev.push({ k: 'select', slot: e.slot === 1 ? 1 : 0 });
      else if (e.k === 'cross') out.ev.push({ k: 'cross', dir: e.dir < 0 ? -1 : 1 });
      else out.ev.push({ k: e.k } as InputEvent);
    }
  }
  return out;
}

function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

export class Room {
  seats: (Seat | null)[] = [null, null];
  phase: RoomPhase = 'waiting';
  game: Game | null = null;
  deadline = 0;
  lastActive = Date.now();
  paused = false;
  notice = '';
  winner = -1;
  wo = false;
  teams: [AthleteInfo[], AthleteInfo[]] | null = null;
  private tickCount = 0;
  private acc = 0;
  private lastTime = 0;

  constructor(public code: string) {}

  // ------------------------------------------------------------- lobby
  addSeat(ws: WebSocket, name: string): Seat | null {
    const idx = this.seats[0] ? (this.seats[1] ? -1 : 1) : 0;
    if (idx < 0) return null;
    const seat: Seat = {
      name: name.slice(0, 16) || (idx === 0 ? 'Jogador 1' : 'Jogador 2'), token: randomBytes(12).toString('hex'), ws,
      options: [], picked: [], ready: false, rematch: false, disconnectedAt: 0, msgCount: 0,
    };
    this.seats[idx] = seat;
    this.lastActive = Date.now();
    return seat;
  }

  seatOf(ws: WebSocket): 0 | 1 | -1 {
    return this.seats[0]?.ws === ws ? 0 : this.seats[1]?.ws === ws ? 1 : -1;
  }

  startPick(): string | null {
    const pool = listAthletes(true);
    if (pool.length < 2) {
      this.phase = 'waiting';
      this.notice = pool.length === 0
        ? 'Nenhum atleta cadastrado ainda. O criador precisa cadastrar atletas em /admin (mínimo 2, ideal 5 ou mais).'
        : 'Só há 1 atleta ativo. Cadastre pelo menos 2 em /admin (ideal 5 ou mais).';
      return this.notice;
    }
    this.notice = '';
    this.phase = 'pick';
    this.game = null; this.teams = null; this.winner = -1; this.wo = false; this.paused = false;
    for (const s of this.seats) {
      if (!s) continue;
      s.options = shuffle(pool).slice(0, 5);
      s.picked = []; s.ready = false; s.rematch = false;
    }
    this.deadline = Date.now() + PICK_SECONDS * 1000;
    return null;
  }

  pick(seat: Seat, ids: number[]) {
    if (this.phase !== 'pick' || seat.ready) return;
    const valid = [...new Set(ids)].filter((id) => seat.options.some((o) => o.id === id)).slice(0, 2);
    seat.picked = valid;
  }

  setReady(seat: Seat, ready: boolean) {
    if (this.phase !== 'pick') return;
    if (ready && seat.picked.length !== 2) return;
    seat.ready = ready;
    this.checkAllReady();
  }

  private checkAllReady() {
    if (this.seats[0]?.ready && this.seats[1]?.ready) {
      this.phase = 'countdown';
      this.deadline = Date.now() + COUNTDOWN_SECONDS * 1000;
      this.teams = [0, 1].map((i) => this.seats[i]!.picked.map((id) => this.seats[i]!.options.find((o) => o.id === id)!)) as [AthleteInfo[], AthleteInfo[]];
    }
  }

  private autoFill(seat: Seat) {
    if (seat.picked.length < 2) {
      const best = [...seat.options].sort((a, b) => b.overall - a.overall);
      const keep = seat.picked.map((id) => seat.options.find((o) => o.id === id)!).filter(Boolean);
      for (const o of best) { if (keep.length >= 2) break; if (!keep.includes(o)) keep.push(o); }
      seat.picked = keep.map((o) => o.id);
    }
    seat.ready = true;
  }

  rematch(seat: Seat) {
    if (this.phase !== 'over') return;
    seat.rematch = true;
    if (this.seats[0]?.rematch && this.seats[1]?.rematch) this.startPick();
  }

  // ------------------------------------------------------------- conexão
  disconnect(ws: WebSocket) {
    const i = this.seatOf(ws);
    if (i < 0) return;
    const s = this.seats[i]!;
    s.ws = null; s.disconnectedAt = Date.now();
    this.lastActive = Date.now();
    if (this.phase === 'playing' || this.phase === 'countdown') {
      this.paused = true;
      this.deadline = Date.now() + RECONNECT_MS;
    } else if (this.phase === 'pick') {
      // volta para a espera enquanto o outro não retorna
      this.deadline = Date.now() + RECONNECT_MS;
    }
  }

  reconnect(ws: WebSocket, token: string): Seat | null {
    for (const s of this.seats) {
      if (s && s.token === token) {
        s.ws = ws; s.disconnectedAt = 0;
        if (this.seats.every((x) => x && x.ws)) {
          if (this.paused) { this.paused = false; this.deadline = this.phase === 'countdown' ? Date.now() + COUNTDOWN_SECONDS * 1000 : 0; }
          if (this.phase === 'pick') this.deadline = Date.now() + PICK_SECONDS * 1000;
        }
        this.lastActive = Date.now();
        return s;
      }
    }
    return null;
  }

  removeSeat(i: number) {
    this.seats[i] = null;
    this.phase = 'waiting';
    this.game = null; this.teams = null; this.paused = false; this.deadline = 0;
    for (const s of this.seats) if (s) { s.ready = false; s.picked = []; s.options = []; s.rematch = false; }
    // quem sobrou vira anfitrião (assento 0) para simplificar
    if (!this.seats[0] && this.seats[1]) { this.seats[0] = this.seats[1]; this.seats[1] = null; }
  }

  get empty() { return !this.seats[0] && !this.seats[1]; }

  // ------------------------------------------------------------- jogo
  private startGame() {
    this.game = new Game(this.teams!, { firstPoss: Math.random() < 0.5 ? 0 : 1 });
    this.phase = 'playing';
    this.tickCount = 0; this.acc = 0; this.lastTime = performance.now();
    this.broadcastRoom();
  }

  input(seatIdx: 0 | 1, f: InputFrame) {
    if (this.phase === 'playing' && this.game && !this.paused) this.game.setInput(seatIdx as Team, f);
  }

  /** chamado a cada ~8ms pelo servidor */
  update(now: number) {
    const wall = Date.now();
    // quem ficou desconectado por muito tempo fora de partida é removido
    if (this.phase === 'pick' || this.phase === 'waiting' || this.phase === 'over') {
      for (let i = 0; i < 2; i++) {
        const s = this.seats[i];
        if (s && !s.ws && s.disconnectedAt && wall - s.disconnectedAt > RECONNECT_MS) { this.removeSeat(i); this.broadcastRoom(); }
      }
    }
    // fases por tempo
    if (this.phase === 'pick' && !this.paused && wall >= this.deadline && this.seats.every((s) => s && s.ws)) {
      for (const s of this.seats) if (s) this.autoFill(s);
      this.checkAllReady();
      this.broadcastRoom();
    }
    if (this.phase === 'countdown' && !this.paused && wall >= this.deadline) this.startGame();

    // reconexão: W.O.
    if ((this.phase === 'playing' || this.phase === 'countdown') && this.paused && wall >= this.deadline) {
      const gone = this.seats.findIndex((s) => s && !s.ws);
      this.winner = gone === 0 ? 1 : 0; this.wo = true; this.phase = 'over'; this.paused = false;
      if (this.game) { this.game.winner = this.winner; }
      this.broadcastRoom();
      return;
    }

    if (this.phase === 'playing' && this.game && !this.paused) {
      const dt = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= BAL.tick && steps < 6) {
        this.game.step(BAL.tick);
        this.acc -= BAL.tick;
        steps++;
        this.tickCount++;
        if (this.tickCount % 2 === 0) this.send(this.game.snapshot());
        if (this.game.phase === 'over') {
          this.send(this.game.snapshot());
          this.phase = 'over'; this.winner = this.game.winner; this.broadcastRoom();
          break;
        }
      }
    } else {
      this.lastTime = now;
    }
  }

  private send(s: ReturnType<Game['snapshot']>) {
    const m = JSON.stringify({ t: 'snap', s } satisfies ServerMsg);
    for (const seat of this.seats) if (seat?.ws && seat.ws.readyState === 1) seat.ws.send(m);
  }

  // ------------------------------------------------------------- visão
  view(i: 0 | 1): RoomView | null {
    const s = this.seats[i];
    if (!s) return null;
    return {
      t: 'room', code: this.code, seat: i, token: s.token, phase: this.phase,
      players: this.seats.map((x) => (x ? { name: x.name, connected: !!x.ws, ready: x.ready, picked: x.picked.length } : null)),
      options: s.options, picked: s.picked,
      teams: this.phase === 'countdown' || this.phase === 'playing' || this.phase === 'over' ? this.teams ?? undefined : undefined,
      deadline: this.phase === 'waiting' || this.phase === 'playing' || this.phase === 'over' ? (this.paused ? this.deadline : 0) : this.deadline,
      paused: this.paused, winner: this.phase === 'over' ? this.winner : undefined, wo: this.wo,
      rematch: this.seats.map((x) => !!x?.rematch),
      notice: this.notice || undefined, roster: this.phase === 'waiting' ? listAthletes(true).length : undefined,
    };
  }

  broadcastRoom() {
    for (const i of [0, 1] as const) {
      const s = this.seats[i];
      const v = this.view(i);
      if (s?.ws && v && s.ws.readyState === 1) s.ws.send(JSON.stringify(v));
    }
  }
}

export class RoomManager {
  rooms = new Map<string, Room>();
  private byWs = new WeakMap<WebSocket, Room>();

  private newCode(): string {
    for (let k = 0; k < 50; k++) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
    throw new Error('sem códigos livres');
  }

  private err(ws: WebSocket, msg: string) { ws.send(JSON.stringify({ t: 'err', msg } satisfies ServerMsg)); }

  handle(ws: WebSocket, msg: ClientMsg) {
    switch (msg.t) {
      case 'ping': ws.send(JSON.stringify({ t: 'pong', c: msg.c } satisfies ServerMsg)); return;
      case 'create': {
        if (this.byWs.has(ws)) return this.err(ws, 'Você já está em uma sala.');
        if (this.rooms.size >= MAX_ROOMS) return this.err(ws, 'Servidor cheio, tente em instantes.');
        const room = new Room(this.newCode());
        this.rooms.set(room.code, room);
        room.addSeat(ws, String(msg.name ?? ''));
        this.byWs.set(ws, room);
        room.broadcastRoom();
        return;
      }
      case 'join': {
        if (this.byWs.has(ws)) return this.err(ws, 'Você já está em uma sala.');
        const room = this.rooms.get(String(msg.code ?? '').toUpperCase().trim());
        if (!room) return this.err(ws, 'Sala não encontrada.');
        if (room.seats[0] && room.seats[1]) return this.err(ws, 'Sala cheia.');
        const seat = room.addSeat(ws, String(msg.name ?? ''));
        if (!seat) return this.err(ws, 'Sala cheia.');
        this.byWs.set(ws, room);
        room.notice = '';
        room.broadcastRoom();
        return;
      }
      case 'rejoin': {
        const room = this.rooms.get(String(msg.code ?? '').toUpperCase());
        const seat = room?.reconnect(ws, String(msg.token ?? ''));
        if (!room || !seat) { ws.send(JSON.stringify({ t: 'left' } satisfies ServerMsg)); return; }
        this.byWs.set(ws, room);
        room.broadcastRoom();
        return;
      }
    }
    const room = this.byWs.get(ws);
    if (!room) return;
    const si = room.seatOf(ws);
    if (si < 0) return;
    const i = si as 0 | 1;
    const seat = room.seats[i]!;
    room.lastActive = Date.now();
    switch (msg.t) {
      case 'start': {
        if (room.phase !== 'waiting') break;
        if (i !== 0) { this.err(ws, 'Só o anfitrião pode iniciar a partida.'); break; }
        if (!room.seats[0] || !room.seats[1]) { this.err(ws, 'Aguarde o adversário entrar.'); break; }
        if (!room.seats[1].ws) { this.err(ws, 'O adversário está desconectado.'); break; }
        room.startPick();
        room.broadcastRoom();
        break;
      }
      case 'pick': if (Array.isArray(msg.ids)) { room.pick(seat, msg.ids.map(Number)); room.broadcastRoom(); } break;
      case 'ready': room.setReady(seat, !!msg.ready); room.broadcastRoom(); break;
      case 'input': { const f = sanitizeInput(msg.f); if (f) room.input(i, f); break; }
      case 'rematch': room.rematch(seat); room.broadcastRoom(); break;
      case 'leave': this.leave(ws); ws.send(JSON.stringify({ t: 'left' } satisfies ServerMsg)); break;
    }
  }

  leave(ws: WebSocket) {
    const room = this.byWs.get(ws);
    if (!room) return;
    const i = room.seatOf(ws);
    this.byWs.delete(ws);
    if (i >= 0) {
      const wasPlaying = room.phase === 'playing' || room.phase === 'countdown';
      const other = room.seats[1 - i];
      room.seats[i]!.ws = null;
      if (wasPlaying && other) {
        // quem sai de propósito perde por W.O.
        room.winner = 1 - i; room.wo = true; room.phase = 'over'; room.paused = false;
        room.seats[i] = null;
        room.broadcastRoom();
        return;
      }
      room.removeSeat(i);
    }
    if (room.empty) this.rooms.delete(room.code);
    else { room.phase = 'waiting'; room.broadcastRoom(); }
  }

  closed(ws: WebSocket) {
    const room = this.byWs.get(ws);
    if (!room) return;
    room.disconnect(ws);
    room.broadcastRoom();
  }

  /** manutenção periódica */
  update(now: number) {
    const wall = Date.now();
    for (const [code, room] of this.rooms) {
      room.update(now);
      const connected = room.seats.some((s) => s?.ws);
      if (!connected && wall - room.lastActive > (room.phase === 'playing' ? 60_000 : 60_000)) this.rooms.delete(code);
      else if (wall - room.lastActive > IDLE_MS && room.phase !== 'playing') this.rooms.delete(code);
    }
  }
}
