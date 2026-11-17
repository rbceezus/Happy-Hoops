// Renderização da partida: câmera estilo 2K (atrás do ataque, de frente para a cesta), interpolação de snapshots,
// HUD, medidor de arremesso e efeitos sonoros por evento.
import * as THREE from 'three';
import { BAL } from '../../shared/balance';
import { contestLevel } from '../../shared/contest';
import { ARC_R, HOOP, clamp, dist, isBeyondArc, lerp, nrm } from '../../shared/court';
import { AthSnap, AthleteInfo, F, GameEvent, InputFrame, Snapshot } from '../../shared/types';
import * as audio from './audio';
import { AthleteModel, buildAthlete } from './athlete';
import { Controls } from './input';
import { Scene3D, buildScene } from './scene';

export interface Session {
  sendInput(f: InputFrame): void;
  rtt(): number;
}

const TEAM_COLORS = [0xe8631a, 0x1f6fe0];
const TEAM_CSS = ['#ff8a3d', '#4d95ff'];

// Câmera "broadcast" de meia quadra
const CAM = { x: 0, y: 5.2, z: 13.8, fov: 47, lookY: 1.5, lookZ: 3.4, follow: 0.4, maxX: 4.2 };

interface Interp { a: AthSnap[]; ball: Snapshot['ball']; flagsFrom: AthSnap[] }

const ease01 = (t: number) => t * t * (3 - 2 * t);

export class GameView {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private S: Scene3D;
  private cam: THREE.PerspectiveCamera;
  private models: AthleteModel[] = [];
  private buf: { s: Snapshot; at: number }[] = [];
  private latest: Snapshot | null = null;
  private renderT = 0;
  private lastFrame = performance.now();
  private raf = 0;
  private camPos = new THREE.Vector3(CAM.x, CAM.y, CAM.z);
  private camLook = new THREE.Vector3(0, CAM.lookY, CAM.lookZ);
  private slowUntil = 0;
  private punch = 0;
  private events: { t: number; e: GameEvent }[] = [];
  private controls: Controls;
  private sendTimer = 0;
  private hud: HTMLElement;
  private els!: Record<string, HTMLElement>;
  private shootT0: number | null = null;
  private shootZone: { green: number; zone: string; ideal: number; max: number } | null = null;
  private meterFade = 0;
  private bouncePhase = 0;
  private ballSpin = new THREE.Vector3();
  private prevPos: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
  private vel: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
  private shake = 0;
  private lastBall = new THREE.Vector3();
  private toastTimer = 0;
  private disposed = false;
  private pred: { x: number; z: number; vx: number; vz: number; id: number } | null = null;
  private lastInput: InputFrame = { mx: 0, mz: 0, run: false, contest: false, ev: [] };
  low = false;

  constructor(
    private root: HTMLElement,
    private teams: [AthleteInfo[], AthleteInfo[]],
    private seat: 0 | 1,
    private names: [string, string],
    private session: Session,
  ) {
    try { this.low = localStorage.getItem('hh_low') === '1' || /[?&]q=low/.test(location.search); } catch { /* ok */ }
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    root.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !this.low, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.S = buildScene();
    if (this.low) this.S.setQuality(true);
    this.cam = new THREE.PerspectiveCamera(CAM.fov, 16 / 9, 0.1, 400);
    this.cam.position.copy(this.camPos);

    for (let t = 0; t < 2; t++) for (let s = 0; s < 2; s++) {
      const m = buildAthlete(teams[t][s], TEAM_COLORS[t]);
      this.models.push(m);
      this.S.scene.add(m.root);
    }
    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    root.appendChild(this.hud);
    this.buildHud();

    this.controls = new Controls(root);
    this.controls.hasPossession = () => this.latest?.poss === this.seat;
    this.controls.onMute = () => this.toggleMute();
    this.controls.onShoot = (down, t0, kind) => this.onShoot(down, t0, kind);
    this.controls.setFlush(() => this.sendInput());
    this.sendTimer = window.setInterval(() => this.sendInput(), 33);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  // -------------------------------------------------------------- rede
  private sendInput() {
    if (this.disposed) return;
    const f = this.controls.frame();
    this.lastInput = { mx: f.mx, mz: f.mz, run: f.run, contest: f.contest, ev: [] };
    this.session.sendInput(f);
  }

  pushSnapshot(s: Snapshot) {
    const at = performance.now();
    if (!this.latest) this.renderT = s.t - 0.06;
    this.latest = s;
    this.buf.push({ s, at });
    if (this.buf.length > 40) this.buf.shift();
    for (const e of s.ev) this.events.push({ t: s.t, e });
    // eventos de retorno imediato (HUD) ficam para o loop; dados fixos
    this.updateScoreboard(s);
    this.updateTips(s);
  }

  get score(): [number, number] { return this.latest?.sc ?? [0, 0]; }

  setEnabled(on: boolean) { this.controls.enabled = on; if (!on) this.controls.reset(); }

  // -------------------------------------------------------------- HUD
  private buildHud() {
    this.hud.innerHTML = `
      <div class="sb">
        <div class="sb-team t0"><span class="poss" data-k="poss0">●</span><span class="nm" data-k="n0"></span><span class="pts" data-k="s0">0</span></div>
        <div class="sb-mid"><div class="clk" data-k="clk">12</div><div class="tgt" data-k="tgt">até 5</div></div>
        <div class="sb-team t1"><span class="pts" data-k="s1">0</span><span class="nm" data-k="n1"></span><span class="poss" data-k="poss1">●</span></div>
      </div>
      <div class="tips" data-k="tips"></div>
      <div class="toast" data-k="toast"></div>
      <div class="banner" data-k="banner"></div>
      <div class="meter" data-k="meter"><div class="mz" data-k="mz"></div><div class="mf" data-k="mf"></div><div class="mk"></div></div>
      <div class="grade" data-k="grade"></div>
      <div class="cards" data-k="cards"></div>
      <button class="mute" data-k="mute" title="Som (M)">🔊</button>
      <button class="qual" data-k="qual" title="Qualidade gráfica">Gráficos: ${this.low ? 'baixo' : 'alto'}</button>`;
    this.els = {};
    this.hud.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => { this.els[e.dataset.k!] = e; });
    this.els.n0.textContent = this.names[0];
    this.els.n1.textContent = this.names[1];
    this.els.n0.style.color = TEAM_CSS[0];
    this.els.n1.style.color = TEAM_CSS[1];
    this.els.mute.onclick = () => this.toggleMute();
    this.els.qual.onclick = () => {
      this.low = !this.low;
      try { localStorage.setItem('hh_low', this.low ? '1' : '0'); } catch { /* ok */ }
      this.els.qual.textContent = `Gráficos: ${this.low ? 'baixo' : 'alto'}`;
      this.renderer.setPixelRatio(this.low ? 1 : Math.min(devicePixelRatio, 2));
      this.S.setQuality(this.low);
    };
    // cartões dos meus 2 atletas
    const mine = this.teams[this.seat];
    this.els.cards.innerHTML = mine.map((a, i) => `
      <div class="pc" data-slot="${i}" style="--c:${TEAM_CSS[this.seat]}" title="Clique ou tecle ${i + 1} para controlar ${a.apelido}">
        <kbd class="pc-key">${i + 1}</kbd>
        <div class="pc-num">${a.numero}</div>
        <div class="pc-body"><div class="pc-nm">${a.apelido}</div><div class="pc-bar"><i data-st="${i}"></i></div></div>
        <div class="pc-ovr">${a.overall}</div>
      </div>`).join('');
    this.bindCards();
  }

  private bindCards() {
    this.els.cards.querySelectorAll<HTMLElement>('.pc').forEach((el) => {
      el.onclick = () => this.controls.inject({ k: 'select', slot: Number(el.dataset.slot) as 0 | 1 });
    });
  }

  private tipsKey = '';
  private updateTips(s: Snapshot) {
    const me = s.a[this.seat * 2 + s.ctl[this.seat]];
    const hasBall = !!(me[4] & F.BALL);
    const off = s.poss === this.seat;
    const loose = s.ball.st === 'loose' || s.ball.st === 'shot';
    let key = 'none';
    if (s.ph === 'check') key = off ? 'check' : 'wait';
    else if (s.ph === 'live') key = hasBall ? (s.clear ? 'clear' : 'ball') : loose ? 'reb' : off ? 'off' : 'def';
    if (key === this.tipsKey) return;
    this.tipsKey = key;
    const K = (t: string) => `<kbd>${t}</kbd>`;
    const row = (k: string, d: string) => `<span class="tip">${k}<em>${d}</em></span>`;
    const T: Record<string, [string, string, string]> = {
      check: ['ATAQUE', 'Você começa com a bola', row(K('Enter'), 'dar o check e iniciar a jogada')],
      wait: ['DEFESA', 'O adversário vai dar o check', row(K('WASD'), 'posicione-se') + row(K('Tab'), 'trocar de defensor')],
      ball: ['ATAQUE · COM A BOLA', 'Vá para a cesta ou crie espaço', row(K('WASD'), 'mover') + row(K('Shift'), 'correr') + row(K('Espaço'), 'arremessar (solte no verde)') + row(K('Q') + K('E'), 'crossover') + row(K('R'), 'giro') + row(K('X'), 'segure: enterrar, solte no aro') + row(K('F'), 'passe') + row(K('G'), 'pingado')],
      clear: ['ATAQUE · LIMPE A BOLA', 'Depois do rebote, saia do arco para poder arremessar', row(K('WASD'), 'ir para fora do arco') + row(K('Shift'), 'correr') + row(K('F'), 'passar') + row(K('Q') + K('E'), 'crossover')],
      off: ['ATAQUE · SEM A BOLA', 'Posicione-se e prepare o rebote', row(K('WASD'), 'mover') + row(K('Espaço'), 'pular (rebote)') + row(K('Tab') + '/' + K('1') + K('2'), 'trocar de jogador')],
      def: ['DEFESA', 'Marque, contesta e dê toco', row(K('WASD'), 'marcar') + row(K('Shift'), 'correr') + row(K('Clique dir.') + '/' + K('C'), 'segure: contestar (chegue perto!)') + row(K('Espaço'), 'pule no arremesso/enterrada (toco)') + row(K('Tab'), 'trocar de defensor')],
      reb: ['REBOTE', 'Bola no ar!', row(K('WASD'), 'chegar na bola') + row(K('Espaço'), 'pule quando a bola descer') + row(K('Tab'), 'trocar de jogador')],
    };
    const t = T[key];
    this.els.tips.innerHTML = t ? `<div class="tip-h ${key === 'def' || key === 'wait' ? 'd' : key === 'reb' ? 'r' : 'a'}"><b>${t[0]}</b><span>${t[1]}</span></div><div class="tip-r">${t[2]}</div>` : '';
    this.els.tips.classList.toggle('show', !!t);
  }

  private toggleMute() {
    audio.setMuted(!audio.muted);
    this.els.mute.textContent = audio.muted ? '🔇' : '🔊';
  }

  private toast(text: string, cls = '', ms = 1400) {
    const el = this.els.toast;
    el.textContent = text;
    el.className = `toast show ${cls}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { el.className = 'toast'; }, ms);
  }

  private updateScoreboard(s: Snapshot) {
    this.els.s0.textContent = String(s.sc[0]);
    this.els.s1.textContent = String(s.sc[1]);
    this.els.tgt.textContent = `até ${s.tgt}`;
    this.els.poss0.style.opacity = s.poss === 0 ? '1' : '0';
    this.els.poss1.style.opacity = s.poss === 1 ? '1' : '0';
    this.els.clk.textContent = s.ph === 'live' ? String(Math.ceil(s.clk)) : s.ph === 'check' ? 'CHECK' : '';
    this.els.clk.classList.toggle('low', s.ph === 'live' && s.clk <= 3);
    const banner = this.els.banner;
    if (s.ph === 'check') {
      banner.textContent = s.poss === this.seat ? 'Pressione ENTER para o check' : 'Defenda! O adversário vai dar o check';
      banner.className = 'banner show';
    } else if (s.ph === 'live' && s.clear && s.poss === this.seat) {
      banner.textContent = 'LIMPE A BOLA';
      banner.className = 'banner show warn';
    } else banner.className = 'banner';
    this.els.cards.querySelectorAll<HTMLElement>('.pc').forEach((el) => {
      const slot = Number(el.dataset.slot);
      el.classList.toggle('on', s.ctl[this.seat] === slot);
      const st = s.a[this.seat * 2 + slot][8];
      (el.querySelector('[data-st]') as HTMLElement).style.width = `${st}%`;
      (el.querySelector('[data-st]') as HTMLElement).style.background = st < 30 ? '#ff4d4d' : '';
    });
  }

  // -------------------------------------------------------------- arremesso (medidor)
  private onShoot(down: boolean, t0: number, kind: 'shot' | 'dunk') {
    const s = this.latest;
    if (!s) return;
    if (down) {
      const me = s.a[this.seat * 2 + s.ctl[this.seat]];
      if (!(me[4] & F.BALL) || s.ph !== 'live') { this.shootT0 = null; return; }
      const info = this.teams[this.seat][s.ctl[this.seat]];
      const pos = this.pred ? { x: this.pred.x, z: this.pred.z } : { x: me[0], z: me[1] };
      const dh = dist(pos.x, pos.z, HOOP.x, HOOP.z);
      if (kind === 'dunk') {
        if (dh > BAL.dunk.range) { this.shootT0 = null; return; }
        const n = nrm(info.attrs.finishing);
        this.shootT0 = t0;
        this.shootZone = { green: BAL.dunk.green.base + BAL.dunk.green.perAttr * n, zone: 'dunk', ideal: BAL.dunk.T * BAL.dunk.releaseU * 1000, max: BAL.dunk.maxHoldMs };
        return;
      }
      const zone = isBeyondArc(pos.x, pos.z) ? 'tres' : dh <= BAL.shot.finishingRange ? 'finishing' : 'media';
      const key = zone === 'tres' ? 'arremesso3' : zone === 'media' ? 'arremessoMedia' : 'finishing';
      const n = nrm(info.attrs[key]);
      const green = (BAL.shot.green.base + BAL.shot.green.perAttr * n) * BAL.shot.zoneWindow[zone];
      this.shootT0 = t0;
      this.shootZone = { green, zone, ideal: BAL.shot.idealMs, max: BAL.shot.maxHoldMs };
    } else if (this.shootT0 !== null && this.shootZone) {
      const hold = performance.now() - this.shootT0;
      const err = hold - this.shootZone.ideal;
      const ae = Math.abs(err), g = this.shootZone.green * (1 - BAL.shot.greenShrink * this.lastLevel);
      const grade = ae <= g ? ['PERFEITO!', 'perfect'] : ae <= g * BAL.shot.goodMult ? ['BOM', 'good'] : err < 0 ? ['CEDO', 'bad'] : ['TARDE', 'bad'];
      this.els.grade.textContent = grade[0];
      this.els.grade.className = `grade show ${grade[1]}`;
      window.setTimeout(() => { this.els.grade.className = 'grade'; }, 700);
      this.shootT0 = null;
      this.meterFade = performance.now() + 250;
    }
  }

  private lastLevel = 0;

  // -------------------------------------------------------------- loop
  private resize = () => {
    const w = this.root.clientWidth || window.innerWidth, h = this.root.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.low ? 1 : Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    // mantém o enquadramento horizontal em telas mais estreitas
    this.cam.fov = w / h < 1.6 ? CAM.fov + (1.6 - w / h) * 22 : CAM.fov;
    this.cam.updateProjectionMatrix();
  };

  private interp(): Interp | null {
    const b = this.buf;
    if (!b.length) return null;
    const t = this.renderT;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].s.t > t) i--;
    const A = b[Math.max(0, i - 1)].s;
    const B = b[i].s;
    const span = B.t - A.t;
    const k = i === 0 || span <= 0 ? 1 : clamp((t - A.t) / span, 0, 1.0);
    const a: AthSnap[] = B.a.map((q, j) => {
      const p = A.a[j];
      const jump = Math.hypot(q[0] - p[0], q[1] - p[1]) > 2.5;
      if (jump) return q;
      let dr = q[2] - p[2];
      while (dr > Math.PI) dr -= 2 * Math.PI;
      while (dr < -Math.PI) dr += 2 * Math.PI;
      return [lerp(p[0], q[0], k), lerp(p[1], q[1], k), p[2] + dr * k, lerp(p[3], q[3], k), k > 0.5 ? q[4] : p[4],
        lerp(p[5], q[5], k), q[6] < 0 ? q[6] : p[6] < 0 ? q[6] : lerp(p[6], q[6], k), lerp(p[7], q[7], k), q[8]] as AthSnap;
    });
    const pb = A.ball, qb = B.ball;
    const bj = Math.hypot(qb.x - pb.x, qb.z - pb.z) > 3;
    const ball = {
      x: bj ? qb.x : lerp(pb.x, qb.x, k), y: bj ? qb.y : lerp(pb.y, qb.y, k), z: bj ? qb.z : lerp(pb.z, qb.z, k),
      h: k > 0.5 ? qb.h : pb.h, st: k > 0.5 ? qb.st : pb.st,
    };
    return { a, ball, flagsFrom: B.a };
  }

  private frame = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const last = this.buf[this.buf.length - 1];
    if (last) {
      // relógio de renderização: acompanha o servidor com atraso de ~70 ms
      const target = last.s.t + (now - last.at) / 1000 - 0.07;
      const slow = now < this.slowUntil;
      let err = target - this.renderT;
      if (Math.abs(err) > 0.6) { this.renderT = target; err = 0; }
      this.renderT += dt * (slow ? 0.4 : 1) + (slow ? 0 : clamp(err * dt * 3, -dt * 0.5, dt * 0.9));
    }
    this.processEvents();
    const it = this.interp();
    if (it && this.latest) this.render(it, dt, now);
    this.renderer.render(this.S.scene, this.cam);
  };

  private processEvents() {
    while (this.events.length && this.events[0].t <= this.renderT + 0.02) {
      const { e } = this.events.shift()!;
      this.fire(e);
    }
  }

  private nameOf(id: number | undefined) {
    if (id === undefined || id < 0) return '';
    return this.teams[Math.floor(id / 2)][id % 2].apelido;
  }

  private fire(e: GameEvent) {
    switch (e.e) {
      case 'swish': if (e.v) audio.swish(1); else audio.swish(0.55); break;
      case 'rim': audio.rim(e.v ?? 0.7); break;
      case 'board': audio.board(e.v ?? 0.7); break;
      case 'bounce': audio.bounce(e.v ?? 0.5); break;
      case 'block':
        audio.block(); this.punch = 1;
        this.toast(`TOCO! ${this.nameOf(e.a)}`, 'block', 1500);
        break;
      case 'ankle':
        audio.ankle(); this.slowUntil = performance.now() + 700; this.punch = 1.6;
        this.toast(`ANKLE BREAKER! ${this.nameOf(e.v)} sobre ${this.nameOf(e.a)}`, 'ankle', 1900);
        break;
      case 'score':
        audio.cheer();
        this.toast(`${e.v === 2 ? '+2 TRÊS!' : '+1'} ${this.nameOf(e.a)}`, e.v === 2 ? 'three' : 'score', 1700);
        break;
      case 'dunk':
        if (e.v) {
          audio.dunk(); this.punch = 2; this.shake = 1;
          this.toast(`${e.m === 'green' ? 'ENTERRADA PERFEITA!' : 'ENTERRADA!'} ${this.nameOf(e.a)}`, 'dunk', 1900);
        } else this.toast(`Enterrada no aro! ${this.nameOf(e.a)}`, 'block', 1300);
        break;
      case 'pass': audio.whoosh(); break;
      case 'check': audio.whistle(); break;
      case 'buzzer': audio.buzzer(); break;
      case 'violation':
        if (e.m === 'LONGE') { this.toast('Longe da cesta para enterrar', 'warn', 1300); break; }
        if (e.m === 'TROCA') { this.toast('Passe a bola (F) para trocar de jogador', 'warn', 1500); break; }
        audio.violation();
        if (e.m) this.toast(e.m === 'LIMPE A BOLA' ? 'LIMPE A BOLA!' : e.m === 'RELÓGIO' ? 'Estourou o relógio de posse' : e.m === 'FORA' ? 'Bola fora' : e.m, 'warn', 1400);
        break;
      case 'rebound': this.toast(`Rebote ${this.nameOf(e.a)}`, '', 900); break;
      default: break;
    }
  }

  private heldBallPos(a: AthSnap, scale: number, t: number): THREE.Vector3 {
    const rot = a[2];
    const fx = Math.sin(rot), fz = Math.cos(rot);
    const sx = Math.cos(rot), sz = -Math.sin(rot);
    const f = a[4];
    if (f & F.DUNK) {
      const u = a[7];
      const y = lerp(1.0, 2.35, ease01(clamp((u - 0.12) / 0.45, 0, 1))) * scale + a[3];
      return new THREE.Vector3(a[0] + fx * 0.2 - sx * 0.12, y, a[1] + fz * 0.2 - sz * 0.12);
    }
    if (f & F.SHOOT && f & F.LAYUP) {
      const u = clamp(Math.max(0, a[6]) / (BAL.shot.idealMs / 1000), 0, 1);
      const y = lerp(1.15, 2.45, ease01(u)) * scale + a[3];
      return new THREE.Vector3(a[0] + fx * lerp(0.3, 0.38, u) - sx * 0.1 * u, y, a[1] + fz * lerp(0.3, 0.38, u) - sz * 0.1 * u);
    }
    if (f & F.SHOOT) {
      const u = clamp(Math.max(0, a[6]) / (BAL.shot.idealMs / 1000), 0, 1);
      const y = lerp(1.2, 2.15, Math.min(1, u * 1.1)) * scale + a[3];
      return new THREE.Vector3(a[0] + fx * lerp(0.28, 0.2, u), y, a[1] + fz * lerp(0.28, 0.2, u));
    }
    const ph = t * Math.PI * 3.2;
    const bounce = Math.abs(Math.sin(ph));
    let side = -0.3; // bola na mão direita
    if (f & F.CROSS) side = -0.3 * Math.cos(a[7] * Math.PI);
    const ahead = 0.34 + Math.min(0.18, a[5] * 0.04);
    return new THREE.Vector3(a[0] + fx * ahead + sx * side, 0.13 + bounce * 0.82 * scale, a[1] + fz * ahead + sz * side);
  }

  private render(it: Interp, dt: number, now: number) {
    const s = this.latest!;
    const t = now / 1000;
    const myCtl = s.ctl[this.seat];
    const myId = this.seat * 2 + myCtl;

    // predição local do atleta controlado (reduz a sensação de atraso)
    this.predict(it, s, dt);

    for (let i = 0; i < 4; i++) {
      const a = it.a[i];
      const m = this.models[i];
      let x = a[0], z = a[1];
      if (this.pred && this.pred.id === i) { x = this.pred.x; z = this.pred.z; }
      m.root.position.set(x, 0, z);
      // velocidade medida na tela (suavizada), decomposta em frente/lateral do atleta
      const pv = this.prevPos[i];
      const rvx = (x - pv[0]) / Math.max(dt, 0.001), rvz = (z - pv[1]) / Math.max(dt, 0.001);
      pv[0] = x; pv[1] = z;
      if (Math.hypot(rvx, rvz) < 12) {
        const k = 1 - Math.exp(-12 * dt);
        this.vel[i][0] += (rvx - this.vel[i][0]) * k; this.vel[i][1] += (rvz - this.vel[i][1]) * k;
      }
      const [vx, vz] = this.vel[i];
      const vf = vx * Math.sin(a[2]) + vz * Math.cos(a[2]);
      const vl = vx * Math.cos(a[2]) - vz * Math.sin(a[2]);
      m.pose({ speed: Math.hypot(vx, vz), flags: a[4], shotT: a[6], anim: a[7], y: a[3], rot: a[2], dt, t, vf, vl, defending: Math.floor(i / 2) !== s.poss });
      m.setMarker(i === myId ? "active" : Math.floor(i / 2) === this.seat ? "mate" : "none");
    }

    // bola
    const bl = it.ball;
    const ball = this.S.ball;
    if (bl.st === 'held' && bl.h >= 0) {
      const a = it.a[bl.h];
      const info = this.teams[Math.floor(bl.h / 2)][bl.h % 2];
      const scale = BAL.height[info.altura] ?? 1;
      const p = this.heldBallPos(a, scale, t);
      if (this.pred && this.pred.id === bl.h) { p.x += this.pred.x - a[0]; p.z += this.pred.z - a[1]; }
      ball.position.copy(p);
      const ph = t * Math.PI * 3.2;
      const prev = this.bouncePhase;
      this.bouncePhase = ph % Math.PI;
      if (prev > this.bouncePhase && !(a[4] & F.SHOOT)) audio.bounce(0.3);
    } else {
      ball.position.set(bl.x, bl.y, bl.z);
    }
    const dv = ball.position.clone().sub(this.lastBall);
    if (dv.length() < 3) {
      this.ballSpin.set(dv.z, 0, -dv.x).multiplyScalar(1 / 0.12);
      ball.rotation.x += this.ballSpin.x; ball.rotation.z += this.ballSpin.z;
    }
    this.lastBall.copy(ball.position);
    // rede balança quando a bola passa
    const dn = Math.hypot(bl.x - HOOP.x, bl.z - HOOP.z);
    const nearNet = dn < 0.4 && bl.y < HOOP.y + 0.2 && bl.y > HOOP.y - 0.5;
    this.S.net.scale.y = lerp(this.S.net.scale.y, nearNet ? 1.35 : 1, 1 - Math.exp(-14 * dt));
    this.S.net.scale.x = this.S.net.scale.z = lerp(this.S.net.scale.x, nearNet ? 0.8 : 1, 1 - Math.exp(-14 * dt));

    this.updateCamera(it, dt, s);
    this.updateMeter(it, s, now);
  }

  // -------------------------------------------------------------- predição do atleta local
  private predict(it: Interp, s: Snapshot, dt: number) {
    const id = this.seat * 2 + s.ctl[this.seat];
    const latest = s.a[id];
    const f = latest[4];
    const blocked = s.ph !== 'live' || f & (F.SHOOT | F.FALLEN | F.SPIN | F.CROSS | F.JUMP | F.STUN) || !this.controls.enabled;
    if (blocked) { this.pred = null; return; }
    if (!this.pred || this.pred.id !== id) {
      this.pred = { x: latest[0], z: latest[1], vx: 0, vz: 0, id };
    }
    const p = this.pred;
    const inp = this.lastInput;
    const info = this.teams[this.seat][s.ctl[this.seat]];
    const m = Math.hypot(inp.mx, inp.mz);
    const dx = m > 0.05 ? inp.mx / m : 0, dz = m > 0.05 ? inp.mz / m : 0;
    const offense = s.poss === this.seat;
    const stam = latest[8];
    const wantsRun = inp.run && m > 0.05 && stam > BAL.move.runMinStamina;
    let top = wantsRun ? BAL.move.run : BAL.move.walk;
    top *= offense ? 0.97 + 0.06 * nrm(info.attrs.drible) : 0.93 + BAL.defense.speedPer * nrm(info.attrs.defesa);
    if (inp.contest && !offense && !(f & F.BALL)) top *= BAL.move.contestSlow;
    if (stam < BAL.move.tooTired) top *= 0.88 + 0.12 * (stam / BAL.move.tooTired);
    const tvx = dx * top * Math.min(1, m), tvz = dz * top * Math.min(1, m);
    const acc = BAL.move.accel * dt;
    const ex = tvx - p.vx, ez = tvz - p.vz;
    const el = Math.hypot(ex, ez);
    if (el > acc) { p.vx += (ex / el) * acc; p.vz += (ez / el) * acc; } else { p.vx = tvx; p.vz = tvz; }
    p.x += p.vx * dt; p.z += p.vz * dt;
    // reconcilia: posição do servidor extrapolada pela idade do snapshot + meia latência
    const n = this.buf.length;
    let sx = latest[0], sz = latest[1];
    if (n >= 2) {
      const A = this.buf[n - 2], B = this.buf[n - 1];
      const span = Math.max(0.001, B.s.t - A.s.t);
      const vx = (B.s.a[id][0] - A.s.a[id][0]) / span, vz = (B.s.a[id][1] - A.s.a[id][1]) / span;
      const age = (performance.now() - B.at) / 1000 + this.session.rtt() / 2000;
      sx += vx * Math.min(age, 0.3); sz += vz * Math.min(age, 0.3);
    }
    const errx = sx - p.x, errz = sz - p.z;
    const e = Math.hypot(errx, errz);
    if (e > 1.4) { p.x = sx; p.z = sz; } else { const r = Math.min(1, dt * 8); p.x += errx * r; p.z += errz * r; }
    p.x = clamp(p.x, -7.08, 7.08); p.z = clamp(p.z, -1.15, 11.98);
  }

  private updateCamera(it: Interp, dt: number, s: Snapshot) {
    const bl = it.ball;
    const focusX = clamp(bl.x * CAM.follow, -CAM.maxX, CAM.maxX);
    // aproxima quando a ação está no garrafão
    const inPaint = clamp(1 - (bl.z - 2) / 6, 0, 1);
    const dive = inPaint * 1.4 + (this.punch > 0 ? this.punch * 0.8 : 0);
    const tx = focusX;
    const ty = CAM.y - inPaint * 0.55 - this.punch * 0.35;
    const tz = CAM.z - dive;
    const k = 1 - Math.exp(-4 * dt);
    this.camPos.x += (tx - this.camPos.x) * k;
    this.camPos.y += (ty - this.camPos.y) * k;
    this.camPos.z += (tz - this.camPos.z) * k;
    const lx = focusX * 0.75;
    this.camLook.x += (lx - this.camLook.x) * k;
    this.camLook.y += (CAM.lookY + (bl.y > 3 ? Math.min(0.8, (bl.y - 3) * 0.3) : 0) - this.camLook.y) * k;
    this.camLook.z += (CAM.lookZ - inPaint * 0.8 - this.camLook.z) * k;
    this.cam.position.copy(this.camPos);
    if (this.shake > 0) { this.cam.position.x += (Math.random() - 0.5) * 0.25 * this.shake; this.cam.position.y += (Math.random() - 0.5) * 0.2 * this.shake; this.shake = Math.max(0, this.shake - dt * 2.2); }
    this.cam.lookAt(this.camLook);
    this.punch = Math.max(0, this.punch - dt * 1.4);
    void s;
  }

  private updateMeter(it: Interp, s: Snapshot, now: number) {
    const meter = this.els.meter;
    const active = this.shootT0 !== null || now < this.meterFade;
    if (!active || !this.shootZone) { meter.classList.remove('show'); return; }
    const id = this.seat * 2 + s.ctl[this.seat];
    const a = it.a[id];
    const wx = this.pred && this.pred.id === id ? this.pred.x : a[0];
    const wz = this.pred && this.pred.id === id ? this.pred.z : a[1];
    const v = new THREE.Vector3(wx + 0.9, 1.0, wz).project(this.cam);
    const w = this.root.clientWidth, h = this.root.clientHeight;
    meter.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
    meter.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
    meter.classList.add('show');
    const max = this.shootZone.max;
    const t = this.shootT0 !== null ? now - this.shootT0 : max;
    const ideal = (this.shootZone.ideal / max) * 100;
    const opp = (1 - this.seat) as 0 | 1;
    const me = it.a[id];
    const lvl = contestLevel(wx, wz, [0, 1].map((k) => {
      const q = it.a[opp * 2 + k];
      return { x: q[0], z: q[1], contesting: !!(q[4] & F.CONTEST), airborne: !!(q[4] & F.JUMP), fallen: !!(q[4] & F.FALLEN), def: this.teams[opp][k].attrs.defesa };
    }));
    void me;
    this.lastLevel = lvl;
    const g = this.shootZone.green * (1 - BAL.shot.greenShrink * lvl);
    this.els.mz.classList.toggle('tight', lvl > 0.35);
    const mz = this.els.mz;
    mz.style.bottom = `${ideal - (g / max) * 100}%`;
    mz.style.height = `${(g / max) * 200}%`;
    this.els.mf.style.height = `${clamp((t / max) * 100, 0, 100)}%`;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.sendTimer);
    window.removeEventListener('resize', this.resize);
    this.controls.dispose();
    this.models.forEach((m) => m.dispose());
    this.renderer.dispose();
    this.canvas.remove();
    this.hud.remove();
  }
}

export { ARC_R };
