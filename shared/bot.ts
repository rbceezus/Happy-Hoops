// Bot simples: serve de adversário no modo treino e de jogador automático nos testes.
import { BAL } from './balance';
import { CLEAR_MARGIN, HOOP, clamp, dist, isBeyondArc } from './court';
import type { Game } from './sim';
import { InputFrame, Team, emptyInput } from './types';

export class Bot {
  private spot = { x: 0, z: 6 };
  private shotErr = 0;
  private lastShotT = -1;
  private jumpErr = 0;
  private checkWait = 0.8;
  private jumped = false;
  private lastPoss = -1;
  private nextPassAt = 0;
  constructor(public team: Team, public skill = 0.5) {}

  private newSpot(g: Game) {
    const ang = g.rng.range(-1.1, 1.1);
    const r = g.rng.next() < 0.55 ? g.rng.range(3.0, 5.2) : g.rng.range(6.9, 7.6);
    this.spot = { x: Math.sin(ang) * r, z: Math.max(0.8, Math.cos(ang) * r) };
    this.shotErr = g.rng.range(-1, 1) * (300 - 200 * this.skill);
  }

  frame(g: Game): InputFrame {
    const f = emptyInput();
    const me = g.controlled(this.team);
    const opp = g.teamAth(this.team === 0 ? 1 : 0);
    if (g.phase === 'check') {
      if (g.poss === this.team) {
        this.checkWait -= BAL.tick;
        if (this.checkWait <= 0) { f.ev.push({ k: 'check' }); this.checkWait = 0.8; }
      }
      return f;
    }
    if (g.phase !== 'live') return f;
    if (this.lastPoss !== g.poss) { this.lastPoss = g.poss; this.newSpot(g); this.nextPassAt = g.t + 1.5; }
    const b = g.ball;
    const go = (x: number, z: number, stop = 0.4, run = true) => {
      const d = dist(me.x, me.z, x, z);
      if (d > stop) { f.mx = (x - me.x) / d; f.mz = (z - me.z) / d; f.run = run && d > 2.5; }
    };

    if (me.dunk && me.dunk.hold === null) {
      if (me.dunk.e * 1000 >= me.dunk.T * BAL.dunk.releaseU * 1000 + this.shotErr * 0.8) f.ev.push({ k: 'dunkUp', hold: me.dunk.e * 1000 });
      return f;
    }
    if (g.hasBall(me)) {
      if (me.shot) {
        if (!me.shot.released && me.shot.t * 1000 >= BAL.shot.idealMs + this.shotErr) {
          f.ev.push({ k: 'shootUp', hold: me.shot.t * 1000 });
        }
        return f;
      }
      if (g.needsClear && !isBeyondArc(me.x, me.z, CLEAR_MARGIN)) {
        go(me.x * 0.6, 9.5, 0.2);
        return f;
      }
      if (g.t > this.nextPassAt && g.rng.next() < 0.004) {
        f.ev.push({ k: 'pass', kind: g.rng.next() < 0.5 ? 'chest' : 'bounce' });
        this.nextPassAt = g.t + 2;
        return f;
      }
      const near = opp.reduce((m, d) => Math.min(m, dist(me.x, me.z, d.x, d.z)), 9);
      if (near < 1.6 && me.dribCd <= 0 && g.rng.next() < 0.03) {
        if (g.rng.next() < 0.5) f.ev.push({ k: 'cross', dir: g.rng.next() < 0.5 ? -1 : 1 });
        else f.ev.push({ k: 'spin' });
      }
      if (dist(me.x, me.z, HOOP.x, HOOP.z) < 3.6 && me.readyAt <= g.t && !me.dash && g.rng.next() < 0.02) {
        f.ev.push({ k: 'dunk' });
        return f;
      }
      const d = dist(me.x, me.z, this.spot.x, this.spot.z);
      if (d > 0.6) { go(this.spot.x, this.spot.z, 0.5, true); return f; }
      if (me.readyAt <= g.t && !me.dash) f.ev.push({ k: 'shootDown' });
      return f;
    }

    // sem bola
    if (b.st === 'loose' || b.st === 'shot') {
      const [p, q] = g.teamAth(this.team);
      const other = me === p ? q : p;
      if (dist(me.x, me.z, b.x, b.z) <= dist(other.x, other.z, b.x, b.z) + 0.3) {
        go(b.x, clamp(b.z, 0.3, 11), 0.3);
        if (b.st === 'loose' && dist(me.x, me.z, b.x, b.z) < 1.5 && b.y < 3.0 && b.vy < 0.5 && me.jumpT < 0 && g.rng.next() < 0.5) {
          f.ev.push({ k: 'shootDown' });
        }
        if (b.st === 'shot') go(0, 1.2, 0.3);
      }
      return f;
    }
    if (g.poss === this.team) return f;
    // defesa
    const o = g.mark(me);
    const h = norm(HOOP.x - o.x, HOOP.z - o.z);
    go(o.x + h.x * 1.15, o.z + h.z * 1.15, 0.25);
    const dd = dist(me.x, me.z, o.x, o.z);
    f.contest = dd < 2.4;
    if (o.dunk && !this.jumped && dd < 2.2) { f.ev.push({ k: 'shootDown' }); this.jumped = true; }
    else if (o.shot && !o.shot.released) {
      if (o.shot.t === o.shot.t && !this.jumped && o.shot.t >= 0.12 + this.jumpErr && dd < 1.6 && g.rng.next() < 0.4 + 0.3 * this.skill) {
        f.ev.push({ k: 'shootDown' }); this.jumped = true;
      }
    } else if (!o.shot && !o.dunk) { this.jumped = false; this.jumpErr = g.rng.range(-0.1, 0.12); }
    return f;
  }
}

function norm(x: number, z: number) {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}
