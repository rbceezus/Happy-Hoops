// Modelo 3D low-poly do atleta (cor de pele, cabelo, altura e uniforme configuráveis) + animação procedural.
import * as THREE from 'three';
import { AthleteInfo, F } from '../../shared/types';
import { BAL } from '../../shared/balance';

const mats = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string | number, rough = 0.7): THREE.MeshStandardMaterial {
  const k = `${color}|${rough}`;
  let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }); mats.set(k, m); }
  return m;
}

export function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  parent?.add(o);
  return o;
}

export function numberTexture(n: number, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.font = 'bold 96px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function labelSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.75)';
  g.strokeText(text, 128, 34);
  g.fillStyle = '#fff';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.5, 0.375, 1);
  s.renderOrder = 10;
  return s;
}

export interface AthletePose {
  speed: number; flags: number; shotT: number; anim: number; y: number; rot: number; dt: number; t: number;
  /** velocidade para frente / lateral (+ = lado esquerdo do atleta), em m/s */
  vf?: number; vl?: number;
  defending?: boolean;
}

export type Marker = 'active' | 'mate' | 'foe' | 'none';

export interface AthleteModel {
  root: THREE.Group;
  pose(p: AthletePose): void;
  setMarker(kind: Marker): void;
  dispose(): void;
  height: number;
}

export const shade = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const seg = (u: number, a: number, b: number) => clamp01((u - a) / (b - a));
const ease = (t: number) => t * t * (3 - 2 * t);

/** Perfil de revolução (raio, altura) para membros e tronco com formas anatômicas. */
export function lathe(profile: [number, number][], seg = 20) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

export function buildAthlete(info: AthleteInfo, teamColor: number, opts: { label?: boolean } = {}): AthleteModel {
  if (riggedBuilder) return riggedBuilder(info, teamColor, opts);
  return buildProcedural(info, teamColor, opts);
}

export function buildProcedural(info: AthleteInfo, teamColor: number, opts: { label?: boolean } = {}): AthleteModel {
  const scale = BAL.height[info.altura] ?? 1;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skin = new THREE.MeshStandardMaterial({ color: info.corPele, roughness: 0.48, metalness: 0 });
  const skinDark = mat(shade(info.corPele, 0.84), 0.55);
  const lips = mat(new THREE.Color(info.corPele).lerp(new THREE.Color('#9a4a44'), 0.32).getHex(), 0.45);
  const jersey = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.8, metalness: 0 });
  const trim = mat(0xffffff, 0.5);
  const shortsMat = new THREE.MeshStandardMaterial({ color: info.roupaBottom === 'jeans-azul' ? 0x2c5aa0 : info.roupaBottom === 'jeans-cinza' ? 0x6c7078 : 0x151517, roughness: 0.8, side: THREE.DoubleSide });
  const shoe = mat(info.calcado === 'tenis-azul' ? 0x1f4fae : 0x151517, 0.45);
  const accent = mat(teamColor, 0.4);
  const sole = mat(0x202026, 0.8);

  const sc = new THREE.Group();
  sc.scale.setScalar(scale);
  body.add(sc);

  const ell = (g: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, parent: THREE.Object3D) => {
    const o = mesh(g, m, x, y, z, parent);
    o.scale.set(sx, sy, sz);
    return o;
  };
  const sph = (r = 1) => new THREE.SphereGeometry(r, 20, 16);

  // ================= pelve / tronco =================
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.995;
  sc.add(pelvis);

  const shortsTop = ell(lathe([[0.001, 0.07], [0.165, 0.07], [0.178, 0.0], [0.2, -0.1], [0.215, -0.19]]), shortsMat, 1, 1, 0.76, 0, 0, 0, pelvis);
  void shortsTop;
  { const wb = mesh(new THREE.TorusGeometry(0.168, 0.011, 8, 28), trim, 0, 0.07, 0, pelvis); wb.rotation.x = Math.PI / 2; wb.scale.set(1, 0.76, 1); }

  const spine = new THREE.Group();
  spine.position.y = 0.06;
  pelvis.add(spine);
  // abdômen (regata)
  ell(lathe([[0.001, -0.02], [0.14, -0.02], [0.145, 0.08], [0.152, 0.2]]), jersey, 1, 1, 0.72, 0, 0, 0, spine);
  { const hem = mesh(new THREE.TorusGeometry(0.141, 0.008, 8, 28), trim, 0, -0.015, 0, spine); hem.rotation.x = Math.PI / 2; hem.scale.set(1, 0.72, 1); }

  const chest = new THREE.Group();
  chest.position.y = 0.2;
  spine.add(chest);
  ell(lathe([[0.152, 0.0], [0.178, 0.07], [0.2, 0.16], [0.192, 0.25], [0.15, 0.31], [0.07, 0.34], [0.001, 0.345]]), jersey, 1.08, 1, 0.68, 0, 0, 0, chest);
  // faixas laterais e gola
  for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.014, 0.4, 0.012), trim, 0.205 * sx, 0.15, 0.0, chest).castShadow = false;
  { const collar = mesh(new THREE.TorusGeometry(0.085, 0.013, 8, 24), trim, 0, 0.335, 0.012, chest); collar.rotation.x = Math.PI / 2; collar.scale.set(1, 0.85, 1); }
  // número
  const tex = numberTexture(info.numero, '#ffffff');
  const numMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const num = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.23), numMat);
  num.position.set(0, 0.15, -0.141);
  num.rotation.y = Math.PI;
  chest.add(num);
  const numF = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), numMat);
  numF.position.set(0, 0.13, 0.141);
  chest.add(numF);
  // trapézio + pescoço
  ell(sph(1), skin, 0.12, 0.05, 0.075, 0, 0.345, -0.005, chest);
  mesh(new THREE.CylinderGeometry(0.046, 0.056, 0.13, 14), skin, 0, 0.4, 0.005, chest);

  // ================= cabeça =================
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.008);
  chest.add(head);
  ell(sph(1), skin, 0.093, 0.114, 0.104, 0, 0, 0, head);
  ell(sph(1), skin, 0.074, 0.062, 0.082, 0, -0.068, 0.018, head); // mandíbula
  ell(sph(1), skin, 0.03, 0.018, 0.03, -0.055, -0.045, 0.075, head); // bochechas
  ell(sph(1), skin, 0.03, 0.018, 0.03, 0.055, -0.045, 0.075, head);
  for (const sx of [-1, 1]) ell(sph(1), skinDark, 0.016, 0.03, 0.02, 0.095 * sx, -0.005, 0, head); // orelhas
  ell(sph(1), skinDark, 0.013, 0.016, 0.014, 0, -0.024, 0.102, head); // nariz
  ell(sph(1), skin, 0.009, 0.026, 0.01, 0, 0.0, 0.1, head); // ponte do nariz
  const eyeW = mat(0xffffff, 0.25), iris = mat(0x3a2418, 0.2), brow = mat(info.corCabelo === '#f5f5f5' ? 0x777777 : info.corCabelo, 0.8);
  for (const sx of [-1, 1]) {
    ell(sph(1), eyeW, 0.019, 0.012, 0.008, 0.036 * sx, 0.018, 0.094, head);
    ell(sph(1), iris, 0.009, 0.009, 0.008, 0.036 * sx, 0.018, 0.099, head);
    const b = mesh(new THREE.BoxGeometry(0.04, 0.0055, 0.008), brow, 0.037 * sx, 0.044, 0.096, head);
    b.rotation.z = -0.1 * sx; b.castShadow = false;
  }
  ell(sph(1), lips, 0.021, 0.0065, 0.008, 0, -0.06, 0.094, head).castShadow = false;
  addHair(head, info);

  // ================= braços =================
  const mkArm = (side: number) => {
    const sh = new THREE.Group();
    sh.position.set(0.195 * side, 0.28, 0);
    chest.add(sh);
    ell(sph(1), skin, 0.058, 0.064, 0.056, 0.008 * side, -0.01, 0, sh); // deltoide
    mesh(lathe([[0.049, 0.02], [0.054, -0.06], [0.047, -0.17], [0.04, -0.29]]), skin, 0, 0, 0, sh);
    const el = new THREE.Group();
    el.position.y = -0.29;
    sh.add(el);
    mesh(sph(0.04), skin, 0, 0, 0, el);
    mesh(lathe([[0.041, 0.0], [0.044, -0.05], [0.036, -0.17], [0.03, -0.27]]), skin, 0, 0, 0, el);
    mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.045, 14), trim, 0, -0.235, 0, el); // munhequeira
    const hand = new THREE.Group();
    hand.position.y = -0.285;
    el.add(hand);
    ell(sph(1), skin, 0.036, 0.05, 0.021, 0, -0.035, 0, hand);
    const th = mesh(new THREE.CapsuleGeometry(0.011, 0.04, 4, 8), skin, 0.032 * side, -0.02, 0.012, hand);
    th.rotation.z = 0.5 * side;
    for (let i = 0; i < 4; i++) ell(sph(1), skin, 0.007, 0.03, 0.01, (-0.021 + i * 0.014), -0.085 + Math.abs(i - 1.5) * -0.004, 0.0, hand);
    return { sh, el, hand };
  };
  const armL = mkArm(1), armR = mkArm(-1); // L = +x

  // ================= pernas =================
  const mkLeg = (side: number) => {
    const th = new THREE.Group();
    th.position.set(0.095 * side, -0.05, 0);
    pelvis.add(th);
    mesh(lathe([[0.094, 0.04], [0.096, -0.06], [0.082, -0.24], [0.062, -0.44]]), skin, 0, 0, 0, th);
    mesh(new THREE.CylinderGeometry(0.108, 0.128, 0.26, 18, 1, true), shortsMat, 0, -0.1, 0, th); // perna da bermuda
    const kn = new THREE.Group();
    kn.position.y = -0.44;
    th.add(kn);
    mesh(sph(0.062), skin, 0, 0, 0, kn);
    mesh(lathe([[0.058, 0.0], [0.066, -0.1], [0.056, -0.24], [0.037, -0.43]]), skin, 0, 0, 0, kn); // panturrilha
    mesh(new THREE.CylinderGeometry(0.055, 0.044, 0.17, 14), trim, 0, -0.33, 0, kn); // meião
    mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.025, 14), accent, 0, -0.255, 0, kn);
    const an = new THREE.Group();
    an.position.y = -0.43;
    kn.add(an);
    ell(sph(1), shoe, 0.062, 0.05, 0.13, 0, -0.035, 0.045, an); // cabedal
    ell(sph(1), shoe, 0.05, 0.045, 0.06, 0, -0.03, -0.045, an); // calcanhar
    ell(sph(1), accent, 0.064, 0.016, 0.07, 0, -0.03, 0.08, an); // detalhe
    mesh(new THREE.BoxGeometry(0.125, 0.022, 0.29), sole, 0, -0.07, 0.03, an);
    return { th, kn, an };
  };
  const legL = mkLeg(1), legR = mkLeg(-1);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);

  // ---- marcador de controle ----
  const marker = new THREE.Group();
  marker.visible = false;
  root.add(marker);
  const ringMat = new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.78, 40), ringMat);
  const ringOut = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.86, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.58, 40), new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
  for (const m of [disc, ring, ringOut]) { m.rotation.x = -Math.PI / 2; m.position.y = 0.2; marker.add(m); }
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 4), new THREE.MeshBasicMaterial({ color: teamColor, depthTest: false }));
  arrow.rotation.x = Math.PI;
  arrow.renderOrder = 11;
  const arrowEdge = new THREE.LineSegments(new THREE.EdgesGeometry(arrow.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
  arrowEdge.renderOrder = 12;
  arrow.add(arrowEdge);
  marker.add(arrow);
  let kind: Marker = 'none';

  if (opts.label !== false) {
    const label = labelSprite(`${info.numero} ${info.apelido}`);
    label.position.y = 2.3 * scale;
    root.add(label);
  }

  // ================= animação =================
  // Cada junta é suavizada (mola crítica) em direção ao alvo da pose atual, então as transições ficam fluidas.
  const J: Record<string, number> = {};
  const sm = (k: string, target: number, rate: number, dt: number) => {
    if (J[k] === undefined) J[k] = target;
    J[k] += (target - J[k]) * (1 - Math.exp(-rate * dt));
    return J[k];
  };
  let phase = Math.random() * 6;
  let prevY = 0;
  let landT = 0;
  let fall = 0;
  let idleT = Math.random() * 10;

  const model: AthleteModel = {
    root, height: 1.83 * scale,
    setMarker(k) {
      kind = k;
      marker.visible = k !== 'none';
      arrow.visible = k === 'active';
      ringOut.visible = k === 'active';
      ringMat.opacity = k === 'active' ? 0.95 : 0.4;
    },
    pose(p) {
      const dt = Math.min(0.05, Math.max(0.001, p.dt));
      const f = p.flags;
      const vf = p.vf ?? p.speed, vl = p.vl ?? 0;

      if (kind !== 'none') {
        const pulse = 1 + Math.sin(p.t * 6) * 0.05;
        if (kind === 'active') { marker.scale.setScalar(pulse * 1.05); arrow.position.y = 2.6 * scale + Math.sin(p.t * 5) * 0.08; }
        else marker.scale.setScalar(0.85);
      }

      const ball = !!(f & F.BALL), shoot = !!(f & F.SHOOT), dunk = !!(f & F.DUNK), air = !!(f & F.JUMP);
      const fallen = !!(f & F.FALLEN), contest = !!(f & F.CONTEST);
      const def = !!p.defending && !ball;
      const run = Math.min(1.15, p.speed / BAL.move.run);
      const fwd = Math.max(-0.7, Math.min(1.15, vf / BAL.move.run));
      const lat = Math.max(-1, Math.min(1, vl / 4.2));
      const slide = Math.abs(lat) * (1 - Math.min(1, Math.abs(fwd) * 0.6));
      const moving = p.speed > 0.35;

      // ciclo de passada
      phase += dt * (2.6 + p.speed * 1.75);
      idleT += dt;
      const A = Math.sin(phase), B = -A;
      const cA = Math.cos(phase), cB = -cA;
      const amp = moving && !air && !fallen ? Math.min(1, run * (1 - 0.55 * slide)) : 0;

      // aterrissagem
      if (prevY > 0.12 && p.y <= 0.02) landT = 0.3;
      prevY = p.y;
      landT = Math.max(0, landT - dt);
      const land = landT / 0.3;

      // ---- alvos base: em pé, relaxado, respiração leve
      const breathe = Math.sin(idleT * 2.2) * 0.012;
      let hipY = 0.995, lean = 0.04 + breathe, spineZ = 0, spineY = 0, chestY = 0, headX = 0, headY = 0;
      let thLx = 0, thRx = 0, thLz = 0.04, thRz = -0.04, knL = 0.06, knR = 0.06, anL = 0, anR = 0;
      let shLx = 0.06, shRx = 0.06, shLz = 0.13, shRz = -0.13, elL = -0.22, elR = -0.22, wrR = 0, wrL = 0;

      // ---- postura por papel
      let crouch = 0;
      if (def) { // defensor: base larga, joelhos flexionados, braços abertos
        crouch = 0.13; lean = 0.3; thLz = 0.2; thRz = -0.2; knL = knR = 0.75; thLx = thRx = -0.5;
        shLx = shRx = -0.5; shLz = 0.95; shRz = -0.95; elL = elR = -0.55; headX = -0.25;
      } else if (ball) { // atacante com a bola: baixo, protegendo
        crouch = 0.06; lean = 0.14; knL = knR = 0.4; thLx = thRx = -0.25; thLz = 0.1; thRz = -0.1; headX = -0.1;
      } else { // ataque sem bola: pronto para receber
        crouch = 0.05; lean = 0.1; knL = knR = 0.35; thLx = thRx = -0.2; shLx = shRx = -0.85; elL = elR = -1.0; shLz = 0.35; shRz = -0.35; headX = -0.08;
      }
      if (p.speed < 0.35 && !def && !ball) { crouch *= 0.6; }

      // ---- locomoção (sobrepõe a postura)
      if (amp > 0.02) {
        const sw = 0.95 * fwd; // amplitude do quadril (sinal: trás/frente)
        thLx += -A * sw * amp; thRx += -B * sw * amp;
        knL += amp * (0.3 + 1.2 * Math.max(0, cA * Math.sign(fwd || 1))); knR += amp * (0.3 + 1.2 * Math.max(0, cB * Math.sign(fwd || 1)));
        anL += -0.35 * A * amp; anR += -0.35 * B * amp;
        const as = 0.8 * fwd * amp;
        if (!ball && !def) { shLx = 0.1 + A * as * 1.0; shRx = 0.1 + B * as * 1.0; elL = elR = -(0.5 + 0.9 * amp); shLz = 0.14; shRz = -0.14; }
        else if (def) { shLx += A * 0.15 * amp; shRx += B * 0.15 * amp; }
        spineY = A * 0.22 * amp * Math.sign(fwd || 1); chestY = -spineY * 0.5;
        lean += 0.26 * Math.max(0, fwd) * amp + (fwd < 0 ? -0.05 : 0);
        hipY += Math.abs(cA) * 0.028 * amp - 0.02 * amp;
        headX -= lean * 0.7;
      }
      // deslize lateral (defesa)
      if (slide > 0.05) {
        const lead = lat > 0 ? 1 : -1; // +1 = perna esquerda (+x) lidera
        const w = Math.sin(phase * 1.4);
        thLz += (lead > 0 ? 0.22 + 0.2 * slide * (0.5 + 0.5 * w) : -0.05 * slide) * slide;
        thRz -= (lead < 0 ? 0.22 + 0.2 * slide * (0.5 + 0.5 * w) : -0.05 * slide) * slide;
        knL += 0.25 * slide; knR += 0.25 * slide; crouch += 0.03 * slide;
        spineZ = -lat * 0.12;
      }

      // ---- bola na mão: drible sincronizado com a bola
      if (ball && !shoot && !dunk) {
        const b = Math.sin(p.t * Math.PI * 3.2);
        const hand = Math.max(0, b);
        shRx = -0.45 - hand * 0.45; elR = -(0.55 + (1 - hand) * 0.25 + hand * 0.4); shRz = -0.28;
        shLx = -0.95; elL = -1.05; shLz = 0.45; // braço livre protege a bola
        if (f & F.CROSS) { shRx = -0.9; shRz = 0.15 + Math.sin(p.anim * Math.PI) * 0.5; spineY += (p.anim - 0.5) * -0.8; }
        if (f & F.SPIN) { lean += 0.1; knL += 0.2; knR += 0.2; }
      }

      // ---- contestar: braço bem alto, outro aberto
      if (contest && !air && !shoot) {
        shRx = -3.1; elR = -0.05; shRz = -0.12; shLx = -0.7; shLz = 1.0; elL = -0.3; lean = 0.2; crouch += 0.02;
      }

      // ---- arremesso / bandeja
      if (shoot && (f & F.LAYUP)) {
        // bandeja: passada com o joelho de impulsão alto, braço estendido até o aro, outro braço protege
        const t = Math.max(0, p.shotT);
        const gather = ease(seg(t, 0, 0.16)), rise = ease(seg(t, 0.12, 0.55));
        crouch = 0.1 * gather * (1 - rise); lean = 0.18 - 0.08 * rise;
        thRx = -1.45 * rise - 0.3 * gather * (1 - rise); knR = 1.7 * rise + 0.5 * gather * (1 - rise); anR = 0.4 * rise;
        thLx = 0.35 * rise - 0.2 * gather * (1 - rise); knL = 0.15 + 0.5 * gather * (1 - rise); anL = 0.7 * rise;
        thLz = 0.06; thRz = -0.06;
        shRx = -0.9 - 2.2 * rise; elR = -1.5 + 1.4 * rise; shRz = -0.08; wrR = rise * 0.5 + (f & F.REL ? 0.7 : 0);
        shLx = -1.0 - 0.4 * rise; shLz = 0.75; elL = -0.85;
        headX = -0.15 - 0.35 * rise; spineY = 0.12 * rise; chestY = -0.1 * rise;
      } else if (shoot) {
        // arremesso: agacha (carga) -> sobe com a bola acima da testa -> estende o braço -> follow-through com o punho dobrado
        const t = Math.max(0, p.shotT);
        const load = ease(seg(t, 0, 0.2)), rise = ease(seg(t, 0.2, 0.55));
        const rel = !!(f & F.REL);
        const follow = rel ? 1 : ease(seg(t, 0.55, 0.75));
        crouch = 0.15 * load * (1 - rise); lean = 0.1 - 0.13 * rise;
        knL = knR = 0.95 * load * (1 - rise) + 0.08; thLx = thRx = -0.55 * load * (1 - rise); thLz = 0.09; thRz = -0.09;
        anL = anR = 0.65 * rise; // ponta dos pés
        // ponto de arremesso: bola acima da testa, cotovelo embaixo da bola
        shRx = lerp3(-0.95, -2.35, -2.95, load, rise); elR = lerp3(-1.6, -1.95, -0.15, load, rise); shRz = -0.1;
        wrR = lerp3(-0.2, -0.9, -0.6, load, rise) + follow * 1.9; // punho engatilhado -> "pescoço de cisne"
        shLx = lerp3(-0.85, -2.2, -2.45, load, rise); elL = lerp3(-1.3, -1.55, -0.95, load, rise); shLz = 0.32 + rise * 0.1; wrL = -0.4;
        headX = -0.1 - 0.28 * rise; spineY = -0.1 * load; chestY = 0.15 * load;
      }

      // ---- enterrada
      if (dunk) {
        const u = p.anim;
        const load = ease(seg(u, 0, 0.16)), rise = ease(seg(u, 0.16, 0.6)), slam = ease(seg(u, 0.6, 0.78)), hang = ease(seg(u, 0.78, 1));
        crouch = 0.18 * load * (1 - rise);
        thLx = -0.9 * rise - 0.5 * load * (1 - rise); thRx = -0.3 * rise; knL = 1.2 * rise + 0.5 * load * (1 - rise); knR = 0.7 * rise + 0.5 * load * (1 - rise);
        thLz = 0.1; thRz = -0.1; anL = anR = 0.5 * rise;
        lean = 0.12 - 0.22 * rise + 0.1 * slam; spineZ = 0;
        const raise = -3.35 * rise - 0.55 * (1 - rise);
        shRx = raise + slam * 1.15 - hang * 0.3; elR = -(1.5 * (1 - rise) + 0.2 + slam * 0.7) + hang * 0.4; shRz = -0.18;
        shLx = -2.3 * rise - 0.9 * (1 - rise); shLz = 0.55 + 0.4 * rise; elL = -0.5;
        headX = -0.3 * rise;
        if (hang > 0) { knL = 0.6; knR = 0.5; thLx = -0.15; thRx = -0.1; }
      }

      // ---- no ar (pulo livre: rebote/toco)
      if (air && !shoot && !dunk) {
        thLx = -0.55; thRx = -0.1; knL = 0.95; knR = 0.65; anL = anR = 0.45; thLz = 0.1; thRz = -0.1;
        shLx = shRx = -3.0; elL = elR = -0.12; shLz = 0.25; shRz = -0.25; lean = 0.02; crouch = 0; headX = -0.3;
      }

      // ---- queda
      if (fallen) {
        shLx = shRx = -1.4; elL = elR = -0.3; shLz = 0.5; shRz = -0.5; thLx = 0.3; thRx = -0.2; knL = 0.5; knR = 0.2; lean = 0; crouch = 0;
      }

      // ---- aterrissagem amortece
      crouch += 0.16 * land;
      knL += 0.6 * land; knR += 0.6 * land; thLx -= 0.3 * land; thRx -= 0.3 * land; lean += 0.1 * land;

      // ---- aplica (suavizado)
      const r = shoot || dunk || air ? 26 : 16;
      hipY -= crouch;
      pelvis.position.y = sm('hip', hipY, 22, dt);
      spine.rotation.set(sm('lean', lean * 0.65, r, dt), sm('spY', spineY, r, dt), sm('spZ', spineZ, r, dt));
      chest.rotation.set(lean * 0.35, sm('chY', chestY, r, dt), 0);
      head.rotation.set(sm('hdX', headX, r, dt), sm('hdY', headY, r, dt), 0);
      legL.th.rotation.set(sm('tLx', thLx, r, dt), 0, sm('tLz', thLz, r, dt));
      legR.th.rotation.set(sm('tRx', thRx, r, dt), 0, sm('tRz', thRz, r, dt));
      legL.kn.rotation.x = sm('kL', knL, r, dt); legR.kn.rotation.x = sm('kR', knR, r, dt);
      legL.an.rotation.x = sm('aL', anL - 0.4 * (knL - 0.1), r, dt) * 0.5; legR.an.rotation.x = sm('aR', anR - 0.4 * (knR - 0.1), r, dt) * 0.5;
      armL.sh.rotation.set(sm('sLx', shLx, r, dt), 0, sm('sLz', shLz, r, dt)); armR.sh.rotation.set(sm('sRx', shRx, r, dt), 0, sm('sRz', shRz, r, dt));
      armL.el.rotation.x = sm('eL', elL, r, dt); armR.el.rotation.x = sm('eR', elR, r, dt);
      armL.hand.rotation.x = sm('wL', wrL, r, dt); armR.hand.rotation.x = sm('wR', wrR, r, dt);

      // ---- corpo todo: giro (spin), queda, inclinação em curvas
      body.rotation.y = p.rot + (f & F.SPIN ? p.anim * Math.PI * 2 : 0);
      fall += ((fallen ? 1 : 0) - fall) * (1 - Math.exp(-14 * dt));
      body.rotation.x = -fall * 1.45;
      body.position.y = fall * 0.2;
      body.rotation.z = sm('bz', -lat * 0.1 * Math.min(1, run + 0.3) + (f & F.CROSS ? Math.sin(p.anim * Math.PI) * -0.14 : 0), 12, dt);
      root.position.y = p.y;
      shadow.position.y = 0.02 - p.y;
      shadow.scale.setScalar(1 - Math.min(0.5, p.y * 0.6));
    },
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      tex.dispose();
    },
  };
  return model;
}

/** interpola em dois estágios: a (início) -> b (após load) -> c (após rise) */
function lerp3(a: number, b: number, c: number, t1: number, t2: number) {
  return (a + (b - a) * t1) + (c - (a + (b - a) * t1)) * t2;
}

/** Orelhas, nariz, olhos, sobrancelhas e boca para uma cabeça elipsoidal de raios (0.093, 0.114, 0.104). */
export function addFace(head: THREE.Group, info: AthleteInfo) {
  const skinDark = mat(shade(info.corPele, 0.84), 0.55);
  const lips = mat(new THREE.Color(info.corPele).lerp(new THREE.Color('#9a4a44'), 0.32).getHex(), 0.45);
  const skin = new THREE.MeshStandardMaterial({ color: info.corPele, roughness: 0.48 });
  const eyeW = mat(0xffffff, 0.25), iris = mat(0x3a2418, 0.2), brow = mat(info.corCabelo === '#f5f5f5' ? 0x777777 : info.corCabelo, 0.8);
  const sph = () => new THREE.SphereGeometry(1, 20, 16);
  const ell = (m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => { const o = mesh(sph(), m, x, y, z, head); o.scale.set(sx, sy, sz); return o; };
  for (const sx of [-1, 1]) ell(skinDark, 0.016, 0.03, 0.02, 0.095 * sx, -0.005, 0);
  ell(skinDark, 0.013, 0.016, 0.014, 0, -0.024, 0.102);
  ell(skin, 0.009, 0.026, 0.01, 0, 0.0, 0.1);
  for (const sx of [-1, 1]) {
    ell(eyeW, 0.019, 0.012, 0.008, 0.036 * sx, 0.018, 0.094);
    ell(iris, 0.009, 0.009, 0.008, 0.036 * sx, 0.018, 0.099);
    const b = mesh(new THREE.BoxGeometry(0.04, 0.0055, 0.008), brow, 0.037 * sx, 0.044, 0.096, head);
    b.rotation.z = -0.1 * sx; b.castShadow = false;
  }
  ell(lips, 0.021, 0.0065, 0.008, 0, -0.06, 0.094).castShadow = false;
}

// registro do construtor com esqueleto (rigged.ts); sem ele, usa o boneco procedural
type Builder = (info: AthleteInfo, teamColor: number, opts: { label?: boolean }) => AthleteModel;
let riggedBuilder: Builder | null = null;
export const registerRigBuilder = (b: Builder) => { riggedBuilder = b; };

// ================= cabelos =================
// Cada cabelo é uma malha moldada sobre a cabeça (elipsoide), com linha do cabelo suave,
// volume por região e textura (cachos) por deslocamento. Fora da área do couro cabeludo,
// os vértices afundam para dentro da cabeça e ficam invisíveis.
const HEAD_R = new THREE.Vector3(0.093, 0.114, 0.104);
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** 0..1: quanto o ponto (direção unitária) está dentro do couro cabeludo. */
function scalpMask(nx: number, ny: number, nz: number, front = 0.36) {
  void nx;
  const t = nz >= 0.55 ? front : nz >= -0.35 ? -0.05 + (front + 0.05) * ((nz + 0.35) / 0.9) : -0.6 + 0.55 * ((nz + 1) / 0.65);
  return sstep(t - 0.05, t + 0.07, ny);
}

/** ruído barato (cachos) */
const curl = (x: number, y: number, z: number, f: number) =>
  Math.sin(x * f + 1.3) * Math.sin(y * f * 1.1 + 0.7) * Math.sin(z * f * 0.9 + 2.1);

function hairShell(
  shape: (n: THREE.Vector3, m: number) => THREE.Vector3 | null,
  seg = 56,
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75));
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const m = scalpMask(n.x, n.y, n.z);
    const inside = new THREE.Vector3(n.x * HEAD_R.x, n.y * HEAD_R.y, n.z * HEAD_R.z).multiplyScalar(0.9);
    const out = shape(n, m) ?? inside;
    out.lerp(inside, 1 - m);
    pos.setXYZ(i, out.x, out.y, out.z);
  }
  g.computeVertexNormals();
  return g;
}

/** ponto na superfície da cabeça deslocado para fora por `t` metros */
const onHead = (n: THREE.Vector3, t: number) =>
  new THREE.Vector3(n.x * HEAD_R.x, n.y * HEAD_R.y, n.z * HEAD_R.z).addScaledVector(n, t);

export function addHair(head: THREE.Group, info: AthleteInfo) {
  const color = new THREE.Color(info.corCabelo);
  const curly = ['black', 'cacheado', 'dreads'].includes(info.estiloCabelo);
  const hair = new THREE.MeshStandardMaterial({ color, roughness: curly ? 0.95 : 0.55, metalness: 0 });
  const add = (g: THREE.BufferGeometry, x = 0, y = 0, z = 0) => mesh(g, hair, x, y, z, head);
  const strand = (r: number, len: number, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const c = add(new THREE.CapsuleGeometry(r, len, 4, 8), x, y - len / 2, z);
    c.rotation.set(rx, 0, rz);
    return c;
  };

  switch (info.estiloCabelo) {
    case 'careca': {
      const m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.16, roughness: 1, depthWrite: false });
      mesh(hairShell((n) => onHead(n, 0.002)), m, 0, 0, 0, head);
      break;
    }
    case 'raspado':
      add(hairShell((n) => onHead(n, 0.005 + 0.001 * curl(n.x, n.y, n.z, 60))));
      break;
    case 'curto':
      add(hairShell((n) => onHead(n, 0.016 + 0.014 * Math.max(0, n.y) + 0.003 * curl(n.x, n.y, n.z, 40))));
      break;
    case 'cacheado':
      add(hairShell((n) => onHead(n, 0.03 + 0.035 * Math.max(0, n.y) + 0.012 * Math.max(0, -n.z) + 0.009 * curl(n.x, n.y, n.z, 26))));
      break;
    case 'black': {
      // volume redondo e grande em volta da cabeça, com textura crespa
      const c = new THREE.Vector3(0, 0.045, -0.02);
      add(hairShell((n, m) => {
        const R = 0.175 + 0.02 * Math.max(0, n.y) + 0.012 * curl(n.x, n.y, n.z, 20) + 0.006 * curl(n.x, n.y, n.z, 47);
        const big = c.clone().addScaledVector(n, R);
        return onHead(n, 0.02).lerp(big, sstep(0.0, 0.85, m));
      }, 64));
      break;
    }
    case 'tranca': {
      // tranças nagô (fileiras da testa até a nuca) + tranças soltas atrás
      add(hairShell((n) => onHead(n, 0.007 + 0.012 * Math.pow(Math.max(0, Math.cos(n.x * Math.PI * 4.2)), 6))));
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.72 + (i / 8) * 0.56);
        strand(0.0115, 0.26 - Math.abs(i - 4) * 0.012, Math.cos(a) * 0.075, -0.02, Math.sin(a) * 0.085 - 0.015, 0.12, Math.cos(a) * 0.15);
      }
      break;
    }
    case 'dreads': {
      add(hairShell((n) => onHead(n, 0.02 + 0.01 * Math.max(0, n.y) + 0.005 * curl(n.x, n.y, n.z, 30))));
      for (let i = 0; i < 18; i++) {
        const a = Math.PI * (0.55 + (i / 17) * 0.9);
        const r = 0.098, len = 0.2 + ((i * 37) % 7) * 0.012;
        strand(0.016, len, Math.cos(a) * r, 0.02 - (i % 2) * 0.03, Math.sin(a) * r * 1.05 - 0.01, 0.15 + (i % 3) * 0.05, Math.cos(a) * 0.25);
      }
      break;
    }
    case 'moicano':
      add(hairShell((n) => {
        const crest = sstep(0.24, 0.1, Math.abs(n.x)) * Math.max(0, n.y + 0.2);
        return onHead(n, 0.004 + 0.07 * crest + 0.004 * curl(n.x, n.y, n.z, 50) * crest);
      }));
      break;
    case 'coque':
      add(hairShell((n) => onHead(n, 0.014 + 0.006 * Math.max(0, n.y))));
      mesh(new THREE.SphereGeometry(0.052, 18, 14), hair, 0, 0.115, -0.07, head);
      break;
    case 'rabo': {
      add(hairShell((n) => onHead(n, 0.013 + 0.004 * Math.max(0, n.y))));
      mesh(new THREE.TorusGeometry(0.022, 0.008, 6, 14), mat(0x222222), 0, 0.03, -0.112, head);
      const tail = strand(0.026, 0.2, 0, 0.03, -0.13, 0.35, 0);
      tail.scale.set(1, 1, 0.8);
      break;
    }
    case 'liso': {
      add(hairShell((n) => onHead(n, 0.016 + 0.01 * Math.max(0, n.y))));
      // cabelo caindo atrás até os ombros e mechas dos lados
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.104, 0.125, 0.32, 24, 1, true, Math.PI * 0.55, Math.PI * 0.9),
        new THREE.MeshStandardMaterial({ color, roughness: 0.55, side: THREE.DoubleSide }));
      back.position.set(0, -0.1, -0.012);
      back.castShadow = true;
      head.add(back);
      for (const sx of [-1, 1]) {
        const lock = mesh(new THREE.BoxGeometry(0.018, 0.2, 0.05), hair, 0.094 * sx, -0.06, 0.03, head);
        lock.rotation.z = 0.05 * sx;
      }
      break;
    }
  }
}
