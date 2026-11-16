// Simulação autoritativa do jogo (roda no servidor e também offline no cliente para o modo treino).
import { BAL } from './balance';
import {
  ARC_R, BALL_R, BOARD_HW, BOARD_Y0, BOARD_Y1, BOARD_Z, CHECK_POS, CLEAR_MARGIN, COURT, HOOP, RIM_R, RIM_TUBE,
  clamp, dist, isBeyondArc, lerp, nrm,
} from './court';
import { Rng } from './rng';
import {
  AthSnap, AthleteInfo, F, GameEvent, InputEvent, InputFrame, Phase, Snapshot, Team, emptyInput,
} from './types';

export type BallState = 'held' | 'pass' | 'shot' | 'loose' | 'dead' | 'homing';

export interface Ath {
  id: number;
  team: Team;
  slot: 0 | 1;
  info: AthleteInfo;
  scale: number;
  x: number; z: number; vx: number; vz: number; rot: number;
  y: number; vy: number; jumpT: number; // jumpT >= 0 => no ar (pulo livre)
  stamina: number; tired: boolean;
  shot: { t: number; released: boolean } | null;
  shotLand: number; // tempo restante de aterrissagem após soltar
  contesting: boolean;
  dash: { t: number; T: number; dx: number; dz: number; speed: number; kind: 'cross' | 'spin' } | null;
  dribCd: number;
  stunT: number; fallT: number; slowT: number;
  readyAt: number; noGrabUntil: number;
  aiBlockAt: number; aiJumpErr: number; aiContestRoll: boolean;
  speed: number;
  moving: boolean;
}

export interface Ball {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  st: BallState;
  holder: number;
  lastTouch: Team;
  // tiro
  shooter: number; shotTeam: Team; made: boolean; value: number; touched: boolean; scored: boolean; lastRimEv: number;
  // passe
  passFrom: number; passTo: number; passT: number; passD: number; passBounce: boolean; passSx: number; passSy: number; passSz: number; bounced: boolean;
  homingTo: number;
}

export interface GameOptions {
  seed?: number;
  firstPoss?: Team;
  /** times controlados por bot (sem humano) */
  bots?: [boolean, boolean];
}

const HAND_H = 2.0;

export class Game {
  t = 0;
  rng: Rng;
  ath: Ath[] = [];
  ball!: Ball;
  score: [number, number] = [0, 0];
  phase: Phase = 'check';
  poss: Team = 0;
  shotClock: number = BAL.shotClock;
  clockRun = false;
  checkT = BAL.checkAutoStart;
  scoreT = 0;
  needsClear = false;
  ctl: [number, number] = [0, 0];
  inputs: [InputFrame, InputFrame] = [emptyInput(), emptyInput()];
  winner = -1;
  events: GameEvent[] = [];
  reb: { t: number } | null = null;
  stats = { shots: [0, 0], made: [0, 0], blocks: [0, 0], ankles: [0, 0], rebounds: [0, 0], violations: 0, oob: 0 };
  /** atleta controlado por humano (mapeado por time) — o resto usa IA */
  constructor(public teams: [AthleteInfo[], AthleteInfo[]], opts: GameOptions = {}) {
    this.rng = new Rng(opts.seed);
    for (const team of [0, 1] as Team[]) {
      for (const slot of [0, 1] as (0 | 1)[]) {
        const info = teams[team][slot];
        this.ath.push({
          id: team * 2 + slot, team, slot, info, scale: BAL.height[info.altura] ?? 1,
          x: 0, z: 8, vx: 0, vz: 0, rot: 0, y: 0, vy: 0, jumpT: -1,
          stamina: BAL.move.staminaMax, tired: false, shot: null, shotLand: 0, contesting: false, dash: null,
          dribCd: 0, stunT: 0, fallT: 0, slowT: 0, readyAt: 0, noGrabUntil: 0,
          aiBlockAt: -1, aiJumpErr: 0, aiContestRoll: false, speed: 0, moving: false,
        });
      }
    }
    this.ball = {
      x: 0, y: 1, z: 8, vx: 0, vy: 0, vz: 0, st: 'held', holder: 0, lastTouch: 0,
      shooter: -1, shotTeam: 0, made: false, value: 1, touched: false, scored: false, lastRimEv: -1,
      passFrom: -1, passTo: -1, passT: 0, passD: 1, passBounce: false, passSx: 0, passSy: 0, passSz: 0, bounced: false,
      homingTo: -1,
    };
    this.startCheck(opts.firstPoss ?? (this.rng.next() < 0.5 ? 0 : 1));
  }

  // ---------------------------------------------------------------- utilidades
  private emit(e: GameEvent) { this.events.push(e); }
  drainEvents(): GameEvent[] { const e = this.events; this.events = []; return e; }
  private nr(a: Ath, k: keyof AthleteInfo['attrs']) { return nrm(a.info.attrs[k]); }
  private opp(t: Team): Team { return (1 - t) as Team; }
  teamAth(t: Team) { return [this.ath[t * 2], this.ath[t * 2 + 1]]; }
  controlled(t: Team) { return this.ath[t * 2 + this.ctl[t]]; }
  holder(): Ath | null { return this.ball.st === 'held' ? this.ath[this.ball.holder] : null; }
  hasBall(a: Ath) { return this.ball.st === 'held' && this.ball.holder === a.id; }
  mark(a: Ath) { return this.ath[this.opp(a.team) * 2 + a.slot]; }
  isOffense(a: Ath) { return a.team === this.poss; }
  airborne(a: Ath) { return a.jumpT >= 0; }

  // ---------------------------------------------------------------- estados de jogo
  startCheck(team: Team) {
    this.phase = 'check';
    this.poss = team;
    this.needsClear = false;
    this.checkT = BAL.checkAutoStart;
    this.shotClock = BAL.shotClock;
    this.clockRun = false;
    this.reb = null;
    const off = this.teamAth(team);
    const def = this.teamAth(this.opp(team));
    const hs = this.ctl[team] as 0 | 1;
    const handler = off[hs];
    const other = off[1 - hs];
    const wingX = this.rng.next() < 0.5 ? -5.8 : 5.8;
    this.place(handler, 0, CHECK_POS.z);
    this.place(other, wingX, 5.0);
    const dh = def[hs];
    const dother = def[1 - hs];
    this.place(dh, 0, CHECK_POS.z - 1.3);
    this.place(dother, wingX * 0.8, 3.8);
    for (const a of this.ath) {
      a.shot = null; a.shotLand = 0; a.dash = null; a.y = 0; a.vy = 0; a.jumpT = -1; a.stunT = 0; a.fallT = 0; a.slowT = 0;
      a.contesting = false; a.aiBlockAt = -1;
    }
    this.ctl[this.opp(team)] = dh.slot;
    const b = this.ball;
    b.st = 'held'; b.holder = handler.id; b.scored = false; b.made = false; b.touched = false; b.shooter = -1;
    b.lastTouch = team;
    this.syncHeldBall();
    handler.readyAt = 0;
    this.emit({ e: 'check', t: team });
  }

  private place(a: Ath, x: number, z: number) {
    a.x = x; a.z = z; a.vx = 0; a.vz = 0;
    a.rot = Math.atan2(-x, -z);
  }

  private goLive() {
    if (this.phase !== 'check') return;
    this.phase = 'live';
    this.clockRun = true;
    this.shotClock = BAL.shotClock;
  }

  private possessionGain(a: Ath, via: 'rebound' | 'pass' | 'check') {
    const prevPoss = this.poss;
    this.poss = a.team;
    this.ctl[a.team] = a.slot;
    const b = this.ball;
    b.st = 'held'; b.holder = a.id; b.lastTouch = a.team; b.vx = b.vy = b.vz = 0;
    this.reb = null;
    if (via === 'rebound') {
      const defReb = b.shotTeam !== a.team;
      this.needsClear = defReb && !isBeyondArc(a.x, a.z, CLEAR_MARGIN);
      this.stats.rebounds[a.team]++;
      a.readyAt = this.t + 0.15;
      this.emit({ e: 'rebound', a: a.id, t: a.team });
    }
    this.clockRun = true;
    this.shotClock = BAL.shotClock;
    if (prevPoss !== a.team || via === 'rebound') {
      // defesa passa a marcar quem tem a bola
      const d = this.mark(a);
      this.ctl[d.team] = d.slot;
    }
  }

  private turnover(toTeam: Team, msg: string) {
    this.emit({ e: 'violation', m: msg, t: toTeam });
    this.ball.st = 'loose'; // será reposicionada no check
    this.startCheck(toTeam);
  }

  // ---------------------------------------------------------------- entrada
  setInput(team: Team, frame: InputFrame) {
    const cur = this.inputs[team];
    cur.mx = frame.mx; cur.mz = frame.mz; cur.run = frame.run; cur.contest = frame.contest;
    for (const e of frame.ev) cur.ev.push(e);
  }

  private handleEvent(team: Team, ev: InputEvent) {
    const c = this.controlled(team);
    if (ev.k === 'check') {
      if (this.phase === 'check' && team === this.poss) this.goLive();
      return;
    }
    if (this.phase !== 'live' && this.phase !== 'score') return;
    if (this.phase === 'score') return;
    switch (ev.k) {
      case 'switch': {
        if (this.hasBall(c) || c.shot) return;
        this.ctl[team] = (1 - c.slot) as 0 | 1;
        break;
      }
      case 'shootDown': {
        if (c.fallT > 0) return;
        if (this.hasBall(c)) {
          if (c.shot || c.readyAt > this.t || c.dash) return;
          if (this.needsClear && !isBeyondArc(c.x, c.z, CLEAR_MARGIN)) {
            this.emit({ e: 'violation', m: 'LIMPE A BOLA', t: team, v: 0 });
            return;
          }
          c.shot = { t: 0, released: false };
          c.shotLand = 0;
        } else if (!c.shot && c.jumpT < 0 && c.y === 0) {
          this.startJump(c);
        }
        break;
      }
      case 'shootUp': {
        if (c.shot && !c.shot.released) this.release(c, ev.hold);
        break;
      }
      case 'pass': this.doPass(c, ev.kind); break;
      case 'cross': this.doDribble(c, 'cross', ev.dir); break;
      case 'spin': this.doDribble(c, 'spin', 0); break;
    }
  }

  private startJump(a: Ath) {
    a.jumpT = 0; a.vy = BAL.jump.vy;
  }

  // ---------------------------------------------------------------- dribles
  private doDribble(a: Ath, kind: 'cross' | 'spin', dir: number) {
    if (!this.hasBall(a) || a.shot || a.dribCd > 0 || a.fallT > 0) return;
    a.dribCd = BAL.drible.cooldown;
    let dx: number, dz: number;
    if (kind === 'cross') {
      dx = dir; dz = 0;
      a.dash = { t: 0, T: BAL.drible.crossT, dx, dz, speed: BAL.drible.crossSpeed, kind };
    } else {
      const sp = Math.hypot(a.vx, a.vz);
      if (sp > 0.5) { dx = a.vx / sp; dz = a.vz / sp; } else { dx = Math.sin(a.rot); dz = Math.cos(a.rot); }
      a.dash = { t: 0, T: BAL.drible.spinT, dx, dz, speed: BAL.drible.spinSpeed, kind };
    }
    // tentativa de quebrar o tornozelo do marcador
    const d = this.mark(a);
    const dd = dist(a.x, a.z, d.x, d.z);
    if (dd <= BAL.drible.range && d.fallT <= 0) {
      const chance = clamp(BAL.drible.base + BAL.drible.perDrible * this.nr(a, 'drible') - BAL.drible.perDef * this.nr(d, 'defesa'), 0.03, 0.9);
      const r = this.rng.next();
      if (r < chance) {
        if (r < chance * BAL.drible.ankleFrac) {
          d.fallT = BAL.drible.fallT; d.vx = d.vz = 0; d.shot = null; d.dash = null;
          this.stats.ankles[a.team]++;
          this.emit({ e: 'ankle', a: d.id, v: a.id, t: a.team });
        } else {
          d.stunT = BAL.drible.stunT;
        }
      } else {
        a.slowT = BAL.drible.failSlowT;
      }
    }
  }

  // ---------------------------------------------------------------- passe
  private doPass(a: Ath, kind: 'chest' | 'bounce') {
    if (!this.hasBall(a) || a.shot || a.fallT > 0) return;
    const to = this.ath[a.team * 2 + (1 - a.slot)];
    const b = this.ball;
    const n = this.nr(a, 'passe');
    let speed = BAL.pass.speed + BAL.pass.perAttr * n;
    // defensor no corredor do passe reto
    let delay = this.rng.next() < 0.55 + 0.45 * n ? 0 : BAL.pass.delay;
    if (kind === 'chest') {
      for (const d of this.teamAth(this.opp(a.team))) {
        if (this.segDist(a.x, a.z, to.x, to.z, d.x, d.z) < BAL.pass.laneRadius) {
          speed *= BAL.pass.laneSlow; delay = Math.max(delay, BAL.pass.delay);
          break;
        }
      }
    }
    b.st = 'pass'; b.passFrom = a.id; b.passTo = to.id; b.passBounce = kind === 'bounce'; b.passT = 0; b.bounced = false;
    b.passSx = b.x; b.passSy = b.y; b.passSz = b.z;
    const d0 = dist(b.x, b.z, to.x, to.z);
    b.passD = Math.max(0.3, d0) / speed;
    to.readyAt = this.t + b.passD + delay;
    b.lastTouch = a.team;
    this.ctl[a.team] = to.slot; // controle passa ao recebedor
    this.emit({ e: 'pass', a: a.id, v: kind === 'bounce' ? 1 : 0 });
  }

  private segDist(ax: number, az: number, bx: number, bz: number, px: number, pz: number) {
    const abx = bx - ax, abz = bz - az;
    const l2 = abx * abx + abz * abz || 1;
    const t = clamp(((px - ax) * abx + (pz - az) * abz) / l2, 0, 1);
    return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
  }

  // ---------------------------------------------------------------- arremesso
  private zoneOf(a: Ath): 'finishing' | 'media' | 'tres' {
    if (isBeyondArc(a.x, a.z)) return 'tres';
    return dist(a.x, a.z, HOOP.x, HOOP.z) <= BAL.shot.finishingRange ? 'finishing' : 'media';
  }

  private release(a: Ath, holdMsRaw: number) {
    const S = BAL.shot;
    const sh = a.shot!;
    sh.released = true;
    a.shotLand = Math.max(0, S.jumpApex * 2 * 1.22 - sh.t);
    const serverMs = sh.t * 1000;
    // compensação simples: o cliente mede o próprio tempo; limitamos a distância do relógio do servidor
    const holdMs = Math.abs(holdMsRaw - serverMs) <= 160 ? holdMsRaw : serverMs;
    const err = holdMs - S.idealMs;
    const zone = this.zoneOf(a);
    const attrKey = zone === 'tres' ? 'arremesso3' : zone === 'media' ? 'arremessoMedia' : 'finishing';
    const n = this.nr(a, attrKey);
    const g = (S.green.base + S.green.perAttr * n) * S.zoneWindow[zone];
    const ae = Math.abs(err);
    const grade: 'green' | 'good' | 'bad' | 'awful' = ae <= g ? 'green' : ae <= g * S.goodMult ? 'good' : ae <= g * S.badMult ? 'bad' : 'awful';

    const def = this.teamAth(this.opp(a.team));
    // --- toco
    const hx = a.x + (HOOP.x - a.x) * 0.0;
    for (const d of def) {
      if (!this.airborne(d) || d.fallT > 0) continue;
      const dd = dist(a.x, a.z, d.x, d.z);
      if (dd > BAL.block.range) continue;
      const toH = norm2(HOOP.x - a.x, HOOP.z - a.z);
      const toD = norm2(d.x - a.x, d.z - a.z);
      if (dd > 0.15 && toH.x * toD.x + toH.z * toD.z < 0.1) continue;
      const ft = clamp(1 - Math.abs(d.jumpT - BAL.block.jumpApexT) / BAL.block.timingWindow, 0, 1);
      if (ft < 0.15) continue;
      const fd = 1 - 0.6 * (dd / BAL.block.range);
      let chance = BAL.block.base + BAL.block.perAttr * this.nr(d, 'bloqueio') * ft * fd - BAL.block.shooterPenalty * n;
      if (zone === 'tres') chance *= BAL.block.threeMult;
      chance = clamp(chance, 0, BAL.block.maxChance);
      if (this.rng.next() < chance) {
        this.blockShot(a, d);
        return;
      }
    }

    // --- chance de acerto
    const [lo, hi] = S.base[zone];
    const base = lerp(lo, hi, n);
    let chance: number;
    if (grade === 'green') chance = base + (S.maxChance - base) * (S.greenPull.base + S.greenPull.perAttr * n);
    else if (grade === 'good') chance = base * S.goodMult2;
    else if (grade === 'bad') chance = base * S.badChance;
    else chance = base * S.awfulChance;
    // contestação
    let free = 1;
    for (const d of def) {
      if (d.fallT > 0) continue;
      const dd = dist(a.x, a.z, d.x, d.z);
      if (dd > S.contestRange) continue;
      const fd = clamp(1 - (dd - 0.6) / (S.contestRange - 0.6), 0, 1);
      const toH = norm2(HOOP.x - a.x, HOOP.z - a.z);
      const toD = norm2(d.x - a.x, d.z - a.z);
      const front = toH.x * toD.x + toH.z * toD.z > 0.2 ? 1 : 0.4;
      const hand = this.airborne(d) ? 1.1 : d.contesting ? 1 : S.handsDownFactor;
      free *= 1 - clamp(S.contestMax * this.nr(d, 'defesa') * fd * front * hand, 0, 0.95);
    }
    chance *= free;
    if (Math.hypot(a.vx, a.vz) > S.movingSpeed) chance *= S.movingPenalty;
    if (a.stamina < BAL.move.tooTired) chance *= 1 - 0.15 * (1 - a.stamina / BAL.move.tooTired);
    chance = clamp(chance, 0.02, grade === 'green' ? S.maxChance : 0.9);
    const made = this.rng.next() < chance;

    this.launchShot(a, made, grade, err, zone);
  }

  private blockShot(a: Ath, d: Ath) {
    const b = this.ball;
    b.st = 'loose';
    b.x = a.x; b.y = HAND_H * a.scale + a.y + 0.2; b.z = a.z;
    const away = norm2(a.x - HOOP.x, a.z - HOOP.z);
    b.vx = away.x * 3.5 + this.rng.range(-2.5, 2.5);
    b.vz = away.z * 3.5 + this.rng.range(0, 2);
    b.vy = this.rng.range(-0.5, 1.5);
    b.lastTouch = d.team; b.shotTeam = a.team; b.shooter = a.id; b.touched = true; b.made = false; b.scored = false;
    a.noGrabUntil = this.t + 0.4;
    this.clockRun = false;
    this.stats.shots[a.team]++;
    this.stats.blocks[d.team]++;
    this.emit({ e: 'block', a: d.id, v: a.id, t: d.team });
    this.reb = null;
    this.autoSwitchToBall();
  }

  private launchShot(a: Ath, made: boolean, grade: string, err: number, zone: string) {
    const b = this.ball;
    const rx = a.x, rz = a.z;
    const sx = rx + Math.sin(a.rot) * 0.2;
    const sz = rz + Math.cos(a.rot) * 0.2;
    const sy = HAND_H * a.scale + a.y + 0.15;
    let tx = HOOP.x, tz = HOOP.z;
    let touch = false;
    const away = norm2(sx - HOOP.x, sz - HOOP.z); // da cesta para o arremessador
    const side = { x: -away.z, z: away.x };
    if (made) {
      if (grade === 'green' || this.rng.next() < 0.6) {
        tx += this.rng.range(-0.015, 0.015); tz += this.rng.range(-0.015, 0.015);
      } else {
        // quica no aro e entra
        const off = this.rng.range(0.1, 0.13);
        const ang = this.rng.range(-0.7, 0.7);
        tx += (away.x * Math.cos(ang) + side.x * Math.sin(ang)) * off;
        tz += (away.z * Math.cos(ang) + side.z * Math.sin(ang)) * off;
        touch = true;
      }
    } else {
      const bad = grade === 'bad' || grade === 'awful';
      const mag = bad ? this.rng.range(0.45, 1.1) : this.rng.range(0.24, 0.42);
      const kind = this.rng.next();
      const early = err < 0;
      let dirx: number, dirz: number;
      if (bad) {
        // cedo = curto, tarde = longo
        const s = early ? 1 : -1;
        dirx = away.x * s; dirz = away.z * s;
      } else if (kind < 0.4) { dirx = away.x; dirz = away.z; } // curto
      else if (kind < 0.75) { dirx = -away.x; dirz = -away.z; } // longo
      else { const s = this.rng.next() < 0.5 ? 1 : -1; dirx = side.x * s; dirz = side.z * s; }
      tx += dirx * mag; tz += dirz * mag;
    }
    const dh = Math.hypot(tx - sx, tz - sz);
    const apex = HOOP.y + 1.15 + 0.045 * dh;
    const ya = Math.max(apex, sy + 0.5);
    const g = BAL.gravity;
    const vy0 = Math.sqrt(2 * g * (ya - sy));
    const t1 = vy0 / g;
    const t2 = Math.sqrt(2 * (ya - HOOP.y) / g);
    const T = t1 + t2;
    b.x = sx; b.y = sy; b.z = sz;
    b.vx = (tx - sx) / T; b.vz = (tz - sz) / T; b.vy = vy0;
    b.st = 'shot'; b.shooter = a.id; b.shotTeam = a.team; b.made = made; b.touched = false; b.scored = false;
    b.value = zone === 'tres' ? 2 : 1; b.lastTouch = a.team; b.holder = -1;
    this.clockRun = false;
    this.stats.shots[a.team]++;
    this.emit({ e: 'shot', a: a.id, v: b.value, m: grade });
  }

  // ---------------------------------------------------------------- loop principal
  step(dt: number = BAL.tick) {
    this.t += dt;
    for (const team of [0, 1] as Team[]) {
      const inp = this.inputs[team];
      const evs = inp.ev;
      inp.ev = [];
      for (const e of evs) this.handleEvent(team, e);
    }

    if (this.phase === 'check') {
      this.checkT -= dt;
      if (this.checkT <= 0) this.goLive();
      for (const a of this.ath) { a.vx = a.vz = 0; a.speed = 0; a.moving = false; }
      this.syncHeldBall();
      return;
    }

    this.updateClear();
    this.updateAthletes(dt);
    this.updateBall(dt);

    if (this.phase === 'live') {
      if (this.clockRun) {
        this.shotClock -= dt;
        if (this.shotClock <= 0) {
          this.stats.violations++;
          this.turnover(this.opp(this.poss), 'RELÓGIO');
        }
      }
    } else if (this.phase === 'score') {
      this.scoreT += dt;
      if (this.scoreT >= BAL.scoreDelay) {
        if (this.score[0] >= BAL.targetScore || this.score[1] >= BAL.targetScore) {
          this.phase = 'over';
          this.winner = this.score[0] > this.score[1] ? 0 : 1;
          this.emit({ e: 'buzzer', t: this.winner as Team });
        } else {
          this.startCheck(this.poss);
        }
      }
    }
  }

  private updateClear() {
    if (!this.needsClear) return;
    const h = this.holder();
    if (h && isBeyondArc(h.x, h.z, CLEAR_MARGIN)) this.needsClear = false;
  }

  // ---------------------------------------------------------------- atletas
  private updateAthletes(dt: number) {
    const live = this.phase === 'live';
    for (const a of this.ath) {
      a.dribCd = Math.max(0, a.dribCd - dt);
      a.stunT = Math.max(0, a.stunT - dt);
      a.slowT = Math.max(0, a.slowT - dt);
      a.fallT = Math.max(0, a.fallT - dt);

      // intenção de movimento
      let dx = 0, dz = 0, mag = 0, run = false;
      let contest = false;
      const isCtl = this.ctl[a.team] === a.slot;
      const inp = this.inputs[a.team];
      if (isCtl && live) {
        const m = Math.hypot(inp.mx, inp.mz);
        if (m > 0.05) { dx = inp.mx / m; dz = inp.mz / m; mag = Math.min(1, m); }
        run = inp.run;
        contest = inp.contest && !this.hasBall(a) && !this.isOffense(a);
      } else if (live) {
        const ai = this.aiMove(a);
        dx = ai.dx; dz = ai.dz; mag = ai.mag; run = ai.run;
        contest = ai.contest;
      } else if (this.phase === 'score') {
        // comemoração leve: parados
      }
      a.contesting = contest;

      // estamina
      const wantsRun = run && mag > 0.1 && !a.tired;
      if (wantsRun) {
        a.stamina = Math.max(0, a.stamina - BAL.move.runDrain * dt);
        if (a.stamina <= 0) a.tired = true;
      } else {
        a.stamina = Math.min(BAL.move.staminaMax, a.stamina + (mag > 0.1 ? BAL.move.regenWalk : BAL.move.regen + 6) * dt);
        if (a.tired && a.stamina > BAL.move.runMinStamina + 6) a.tired = false;
      }

      // velocidade desejada
      let top = wantsRun ? BAL.move.run : BAL.move.walk;
      const defSpeed = this.isOffense(a) ? 0.97 + 0.06 * this.nr(a, 'drible') : 0.93 + BAL.defense.speedPer * this.nr(a, 'defesa');
      top *= defSpeed;
      if (a.stunT > 0) top *= 0.25;
      if (a.slowT > 0) top *= 0.6;
      if (contest) top *= BAL.move.contestSlow;
      if (a.stamina < BAL.move.tooTired) top *= 0.88 + 0.12 * (a.stamina / BAL.move.tooTired);
      let tvx = dx * top * mag, tvz = dz * top * mag;

      if (a.fallT > 0) { tvx = 0; tvz = 0; }
      if (a.shot) { tvx = 0; tvz = 0; }
      if (this.airborne(a)) { tvx = a.vx; tvz = a.vz; } // sem controle no ar

      const acc = BAL.move.accel * dt * (a.shot ? 0.35 : a.fallT > 0 ? 1.2 : 1);
      const ex = tvx - a.vx, ez = tvz - a.vz;
      const el = Math.hypot(ex, ez);
      if (el > acc) { a.vx += (ex / el) * acc; a.vz += (ez / el) * acc; } else { a.vx = tvx; a.vz = tvz; }

      // dribles dão impulso
      if (a.dash) {
        a.dash.t += dt;
        const p = a.dash.t / a.dash.T;
        if (p >= 1) a.dash = null;
        else {
          const k = a.dash.kind === 'cross' ? 1 - p * 0.4 : 1 - p * 0.5;
          a.vx = a.dash.dx * a.dash.speed * k + dx * 0.8 * mag;
          a.vz = a.dash.dz * a.dash.speed * k + dz * 0.8 * mag;
          if (a.dash.kind === 'cross') { a.vx += a.dash.dx * 0; }
        }
      }

      a.x += a.vx * dt; a.z += a.vz * dt;
      a.speed = Math.hypot(a.vx, a.vz);
      a.moving = mag > 0.1;
      const r = BAL.move.radius;
      a.x = clamp(a.x, COURT.xMin + r, COURT.xMax - r);
      a.z = clamp(a.z, COURT.zMin + r, COURT.zMax - r);

      // pulo livre
      if (a.jumpT >= 0) {
        a.jumpT += dt;
        a.vy -= BAL.gravity * dt;
        a.y += a.vy * dt;
        if (a.y <= 0 && a.vy < 0) { a.y = 0; a.vy = 0; a.jumpT = -1; }
      }
      // arremesso: curva de pulo roteirizada
      if (a.shot) {
        a.shot.t += dt;
        const S = BAL.shot;
        const T = S.idealMs / 1000;
        const u = (a.shot.t - T) / T;
        a.y = Math.max(0, S.jumpApex * (1 - u * u));
        if (!a.shot.released && a.shot.t * 1000 >= S.maxHoldMs) this.release(a, S.maxHoldMs);
        if (a.shot && a.shot.t >= T * 2) { a.shot = null; a.y = 0; }
      }

      // orientação
      this.updateRot(a, dx, dz, mag, dt);
    }

    // colisões corpo a corpo
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const p = this.ath[i], q = this.ath[j];
      if (p.fallT > 0 || q.fallT > 0) continue;
      const d = dist(p.x, p.z, q.x, q.z);
      const min = BAL.move.radius * 2;
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2;
        const nx = (p.x - q.x) / d, nz = (p.z - q.z) / d;
        p.x += nx * push; p.z += nz * push; q.x -= nx * push; q.z -= nz * push;
      }
    }
    // saída da quadra: a bola é corrigida pelo clamp acima
  }

  private updateRot(a: Ath, dx: number, dz: number, mag: number, dt: number) {
    let target = a.rot;
    if (a.shot || (this.hasBall(a) && mag < 0.1)) target = Math.atan2(HOOP.x - a.x, HOOP.z - a.z);
    else if (!this.isOffense(a) && this.phase !== 'score') {
      const o = this.mark(a);
      target = Math.atan2(o.x - a.x, o.z - a.z);
      if (mag > 0.3 && Math.hypot(o.x - a.x, o.z - a.z) > 3) target = Math.atan2(dx, dz);
    } else if (mag > 0.1) target = Math.atan2(dx, dz);
    else if (Math.hypot(a.vx, a.vz) > 0.5) target = Math.atan2(a.vx, a.vz);
    if (a.dash?.kind === 'spin') { a.rot = target; return; }
    let d = target - a.rot;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const step = 14 * dt;
    a.rot += clamp(d, -step, step);
  }

  // ---------------------------------------------------------------- IA dos não controlados
  private aiMove(a: Ath): { dx: number; dz: number; mag: number; run: boolean; contest: boolean } {
    const none = { dx: 0, dz: 0, mag: 0, run: false, contest: false };
    const b = this.ball;
    if (a.fallT > 0 || a.shot) return none;
    const goTo = (x: number, z: number, stop = 0.35, run = false) => {
      const d = dist(a.x, a.z, x, z);
      if (d < stop) return { dx: 0, dz: 0, mag: 0, run: false, contest: false };
      return { dx: (x - a.x) / d, dz: (z - a.z) / d, mag: clamp(d / 1.2, 0.35, 1), run: run && d > 2.5, contest: false };
    };

    // bola solta / em voo de arremesso: disputa de rebote
    if (b.st === 'loose' || b.st === 'shot') {
      const mine = this.teamAth(a.team);
      const other = mine[1 - a.slot];
      const px = b.x, pz = clamp(b.z, COURT.zMin, COURT.zMax);
      const myD = dist(a.x, a.z, b.x, b.z);
      const otherD = dist(other.x, other.z, b.x, b.z);
      const iAmClosest = myD < otherD || (myD === otherD && a.slot === 0);
      // ataque e defesa caem no rebote só se estiver mais perto, o outro mantém posição
      if (b.st === 'loose' || iAmClosest || !this.isOffense(a)) {
        if (b.st === 'loose' ? iAmClosest : true) {
          // tenta cobrir o ponto de queda
          let tx = px, tz = pz;
          if (b.st === 'shot') { tx = HOOP.x + (a.x - HOOP.x) * 0.2; tz = HOOP.z + 0.5; }
          const g = goTo(tx, tz, 0.3, true);
          this.aiReboundJump(a);
          return g;
        }
      }
    }

    if (this.isOffense(a)) {
      const h = this.holder();
      if (h && h.team === a.team && h.id !== a.id) {
        const x = h.x >= 0 ? -5.9 : 5.9;
        return goTo(x, 4.6, 0.5);
      }
      if (b.st === 'pass' && b.passTo === a.id) return none;
      return none;
    }
    // defesa: homem a homem
    const o = this.mark(a);
    const gap = this.holder() === o ? BAL.defense.gap : 1.8;
    const dh = norm2(HOOP.x - o.x, HOOP.z - o.z);
    const tx = o.x + dh.x * gap, tz = o.z + dh.z * gap;
    const mv = goTo(tx, tz, 0.25, true);
    // contestação automática + toco de IA
    const dd = dist(a.x, a.z, o.x, o.z);
    let contest = false;
    if (o.shot && dd < 2.4) {
      if (a.aiBlockAt < 0 && o.shot.t < 0.2) {
        a.aiContestRoll = this.rng.next() < 0.55;
        const tryBlock = this.rng.next() < 0.25 + 0.5 * this.nr(a, 'bloqueio') && dd < 1.6;
        if (tryBlock) {
          const err = this.rng.range(-0.22, 0.22) * (1.25 - this.nr(a, 'defesa'));
          a.aiBlockAt = this.t + (BAL.shot.idealMs / 1000 - BAL.block.jumpApexT) + err - o.shot.t;
        } else a.aiBlockAt = this.t + 99;
      }
      contest = a.aiContestRoll || dd < 1.4;
      if (a.aiBlockAt > 0 && a.aiBlockAt < this.t + 50 && this.t >= a.aiBlockAt && a.jumpT < 0 && a.y === 0) {
        this.startJump(a); a.aiBlockAt = this.t + 99;
      }
    } else if (!o.shot) a.aiBlockAt = -1;
    return { ...mv, contest };
  }

  private aiReboundJump(a: Ath) {
    const b = this.ball;
    if (a.jumpT >= 0 || a.y > 0 || a.fallT > 0) return;
    const hd = dist(a.x, a.z, b.x, b.z);
    if (b.st === 'loose' || (b.touched && b.st === 'shot')) {
      if (hd < 1.7 && b.vy < 0.5 && b.y < 3.3 + a.aiJumpErr && b.y > 1.8) this.startJump(a);
    }
  }

  // ---------------------------------------------------------------- bola
  private syncHeldBall() {
    const b = this.ball;
    if (b.st !== 'held') return;
    const a = this.ath[b.holder];
    b.x = a.x + Math.sin(a.rot) * 0.35;
    b.z = a.z + Math.cos(a.rot) * 0.35;
    b.y = (a.shot ? HAND_H * a.scale + a.y : 1.0 * a.scale) ;
    b.vx = b.vy = b.vz = 0;
  }

  private chestPos(a: Ath, low = false) {
    return { x: a.x, y: (low ? 1.0 : 1.35) * a.scale + a.y, z: a.z };
  }

  private updateBall(dt: number) {
    const b = this.ball;
    switch (b.st) {
      case 'held': this.syncHeldBall(); return;
      case 'pass': this.updatePass(dt); return;
      case 'homing': this.updateHoming(dt); return;
      case 'dead':
      case 'loose':
      case 'shot': {
        const sub = 4;
        const h = dt / sub;
        for (let i = 0; i < sub; i++) this.ballPhysics(h);
        if (b.st === 'loose') this.updateLoose(dt);
        this.checkOOB();
        return;
      }
    }
  }

  private updatePass(dt: number) {
    const b = this.ball;
    b.passT += dt;
    const to = this.ath[b.passTo];
    const p = clamp(b.passT / b.passD, 0, 1);
    const tgt = this.chestPos(to, b.passBounce);
    if (b.passBounce) {
      const ty = 1.0 * to.scale + to.y;
      b.x = lerp(b.passSx, tgt.x, p); b.z = lerp(b.passSz, tgt.z, p);
      if (p < 0.6) b.y = BALL_R + (b.passSy - BALL_R) * (1 - p / 0.6) ** 1.6;
      else b.y = BALL_R + (ty - BALL_R) * Math.sin(((p - 0.6) / 0.4) * Math.PI / 2);
      if (p >= 0.6 && !b.bounced) { b.bounced = true; this.emit({ e: 'bounce', v: 0.7 }); }
    } else {
      b.x = lerp(b.passSx, tgt.x, p); b.z = lerp(b.passSz, tgt.z, p);
      b.y = lerp(b.passSy, tgt.y, p) + 0.3 * Math.sin(Math.PI * p);
    }
    if (p >= 1) {
      this.possessionGain(to, 'pass');
      to.readyAt = Math.max(to.readyAt, this.t);
    }
  }

  private updateHoming(dt: number) {
    const b = this.ball;
    const a = this.ath[b.homingTo];
    const tx = a.x, ty = 1.35 * a.scale + a.y, tz = a.z;
    const k = 1 - Math.exp(-18 * dt);
    b.x += (tx - b.x) * k; b.y += (ty - b.y) * k; b.z += (tz - b.z) * k;
    if (Math.hypot(tx - b.x, ty - b.y, tz - b.z) < 0.3) this.possessionGain(a, 'rebound');
  }

  private ballPhysics(dt: number) {
    const b = this.ball;
    const prevY = b.y;
    b.vy -= BAL.gravity * dt;
    // ímã suave para arremessos que "devem" entrar
    if (b.st === 'shot' && b.made && !b.scored && b.vy < 0) {
      const rr = Math.hypot(b.x - HOOP.x, b.z - HOOP.z);
      if (b.y < HOOP.y + 0.45 && b.y > HOOP.y - 0.6 && rr < 0.45) {
        const k = 38 * dt;
        b.vx += (HOOP.x - b.x) * k; b.vz += (HOOP.z - b.z) * k;
        b.vx *= 1 - 3 * dt; b.vz *= 1 - 3 * dt;
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;

    // aro (anel)
    if (b.st === 'shot' || b.st === 'loose') {
      const dx = b.x - HOOP.x, dz = b.z - HOOP.z;
      const rr = Math.hypot(dx, dz) || 1e-6;
      const px = HOOP.x + (dx / rr) * RIM_R, pz = HOOP.z + (dz / rr) * RIM_R;
      const ex = b.x - px, ey = b.y - HOOP.y, ez = b.z - pz;
      const d = Math.hypot(ex, ey, ez);
      const minD = BALL_R + RIM_TUBE;
      if (d < minD && d > 1e-6) {
        const nx = ex / d, ny = ey / d, nz = ez / d;
        const vn = b.vx * nx + b.vy * ny + b.vz * nz;
        b.x = px + nx * minD; b.y = HOOP.y + ny * minD; b.z = pz + nz * minD;
        if (vn < 0) {
          const e = 0.62;
          b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; b.vz -= (1 + e) * vn * nz;
          b.touched = true;
          if (-vn > 0.7 && this.t - b.lastRimEv > 0.07) {
            b.lastRimEv = this.t;
            this.emit({ e: 'rim', v: clamp(-vn / 6, 0.2, 1) });
            if (!this.reb) this.autoSwitchToBall();
          }
        }
      }
      // tabela
      if (Math.abs(b.x) <= BOARD_HW + BALL_R && b.y >= BOARD_Y0 - BALL_R && b.y <= BOARD_Y1 + BALL_R
        && b.z - BALL_R < BOARD_Z && b.z > BOARD_Z - 0.3 && b.vz < 0) {
        b.z = BOARD_Z + BALL_R;
        b.vz = -b.vz * 0.55; b.vx *= 0.9;
        b.touched = true;
        if (this.t - b.lastRimEv > 0.07) {
          b.lastRimEv = this.t;
          this.emit({ e: 'board', v: clamp(Math.abs(b.vz) / 5, 0.2, 1) });
          if (!this.reb) this.autoSwitchToBall();
        }
      }
    }

    // pontuação
    if (b.st === 'shot' && !b.scored && prevY >= HOOP.y && b.y < HOOP.y && b.vy < 0) {
      const rr = Math.hypot(b.x - HOOP.x, b.z - HOOP.z);
      if (rr < 0.19) this.scored();
    }
    // rede
    if (b.scored && b.y < HOOP.y && b.y > HOOP.y - 0.55) {
      b.vx *= 1 - 7 * dt; b.vz *= 1 - 7 * dt; if (b.vy < -3.2) b.vy = -3.2;
    }

    // chão
    if (b.y < BALL_R) {
      b.y = BALL_R;
      if (b.vy < 0) {
        b.vy = -b.vy * 0.74;
        b.vx *= 0.92; b.vz *= 0.92;
        if (Math.abs(b.vy) > 1.2) this.emit({ e: 'bounce', v: clamp(Math.abs(b.vy) / 6, 0.15, 1) });
        else b.vy = 0;
        if (b.st === 'shot' && !b.scored) { b.st = 'loose'; }
      }
    }
    // saiu do arremesso sem entrar e já tocou no aro, vira bola solta
    if (b.st === 'shot' && !b.scored && b.touched && !b.made) b.st = 'loose';
    if (b.st === 'shot' && b.made && b.touched && b.y < HOOP.y - 0.8 && !b.scored) b.st = 'loose';
  }

  private scored() {
    const b = this.ball;
    b.scored = true;
    const team = b.shotTeam;
    this.score[team] += b.value;
    this.stats.made[team]++;
    b.st = 'dead';
    this.phase = 'score';
    this.scoreT = 0;
    this.clockRun = false;
    this.poss = team; // posse fica com quem fez
    this.emit({ e: 'swish', v: b.touched ? 0 : 1, a: b.shooter, t: team });
    this.emit({ e: 'score', v: b.value, t: team, a: b.shooter });
  }

  private checkOOB() {
    const b = this.ball;
    if (this.phase !== 'live' || b.st === 'dead') return;
    const out = b.x < COURT.xMin - 0.2 || b.x > COURT.xMax + 0.2 || b.z < COURT.zMin - 0.2 || b.z > COURT.zMax + 0.2;
    if (out && b.y < 6) {
      this.stats.oob++;
      this.turnover(this.opp(b.lastTouch), 'FORA');
    }
  }

  /** Controle automático: atleta de cada time mais perto da bola (para rebotes). */
  private autoSwitchToBall() {
    const b = this.ball;
    for (const t of [0, 1] as Team[]) {
      const [p, q] = this.teamAth(t);
      const dp = dist(p.x, p.z, b.x, b.z), dq = dist(q.x, q.z, b.x, b.z);
      this.ctl[t] = dp <= dq ? 0 : 1;
    }
  }

  private reach(a: Ath) {
    return BAL.rebound.reach * a.scale + (BAL.rebound.heightBonus[a.info.altura] ?? 0) + (this.airborne(a) ? a.y : 0);
  }

  private grabbers(): Ath[] {
    const b = this.ball;
    const out: Ath[] = [];
    for (const a of this.ath) {
      if (a.fallT > 0 || a.noGrabUntil > this.t) continue;
      const hd = dist(a.x, a.z, b.x, b.z);
      const R = BAL.rebound.grabRadius + 0.2 * this.nr(a, 'rebote');
      if (hd > R) continue;
      if (b.y > this.reach(a)) continue;
      if (b.y < 0.25 && !(b.vy > 0)) { /* bola no chão ainda pode ser pega */ }
      if (b.vy > 2.2 && b.y > 2.0) continue;
      out.push(a);
    }
    return out;
  }

  private updateLoose(dt: number) {
    const b = this.ball;
    if (!this.reb) {
      if (this.grabbers().length) this.reb = { t: BAL.rebound.window };
      return;
    }
    this.reb.t -= dt;
    if (this.reb.t > 0) return;
    const cands = this.grabbers();
    this.reb = null;
    if (!cands.length) return;
    const R = BAL.rebound;
    let best: Ath | null = null, bestScore = -1;
    for (const a of cands) {
      const tm = this.airborne(a) ? clamp(1 - Math.abs(a.jumpT - BAL.block.jumpApexT) / BAL.block.timingWindow, 0, 1) : 0.2;
      const pos = clamp(1 - dist(a.x, a.z, b.x, b.z) / (R.grabRadius + 0.3), 0, 1);
      const sc = R.wTiming * tm + R.wAttr * this.nr(a, 'rebote') + R.wPos * pos + this.rng.range(0, 0.08);
      if (sc > bestScore) { bestScore = sc; best = a; }
    }
    if (best && bestScore >= R.minScore) {
      b.st = 'homing'; b.homingTo = best.id; b.lastTouch = best.team;
    }
  }

  // ---------------------------------------------------------------- snapshot
  snapshot(withEvents = true): Snapshot {
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const a: AthSnap[] = this.ath.map((p) => {
      let f = 0;
      if (this.hasBall(p)) f |= F.BALL;
      if (p.shot) f |= F.SHOOT;
      if (p.jumpT >= 0) f |= F.JUMP;
      if (p.contesting) f |= F.CONTEST;
      if (p.fallT > 0) f |= F.FALLEN;
      if (p.stunT > 0) f |= F.STUN;
      if (p.speed > BAL.move.walk * 1.15) f |= F.RUN;
      if (p.dash?.kind === 'spin') f |= F.SPIN;
      if (p.dash?.kind === 'cross') f |= F.CROSS;
      if (p.readyAt <= this.t) f |= F.READY;
      const anim = p.dash ? p.dash.t / p.dash.T : 0;
      return [r3(p.x), r3(p.z), r3(p.rot), r3(p.y), f, r3(p.speed), p.shot ? r3(p.shot.t) : -1, r3(anim), Math.round(p.stamina)];
    });
    const b = this.ball;
    return {
      t: r3(this.t), ph: this.phase, poss: this.poss, sc: [this.score[0], this.score[1]],
      clk: Math.max(0, r3(this.shotClock)), chk: Math.max(0, r3(this.checkT)), clear: this.needsClear,
      a, ctl: [this.ctl[0], this.ctl[1]],
      ball: { x: r3(b.x), y: r3(b.y), z: r3(b.z), h: b.st === 'held' ? b.holder : -1, st: b.st },
      ev: withEvents ? this.drainEvents() : [], win: this.winner, tgt: BAL.targetScore,
    };
  }
}

function norm2(x: number, z: number) {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}

export { ARC_R };
