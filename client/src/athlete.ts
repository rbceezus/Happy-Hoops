// Modelo 3D low-poly do atleta (cor de pele, cabelo, altura e uniforme configuráveis) + animação procedural.
import * as THREE from 'three';
import { AthleteInfo, F } from '../../shared/types';
import { BAL } from '../../shared/balance';

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string | number, rough = 0.7): THREE.MeshStandardMaterial {
  const k = `${color}|${rough}`;
  let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }); mats.set(k, m); }
  return m;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  parent?.add(o);
  return o;
}

function numberTexture(n: number, color: string): THREE.CanvasTexture {
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

function labelSprite(text: string): THREE.Sprite {
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
}

export type Marker = 'active' | 'mate' | 'none';

export interface AthleteModel {
  root: THREE.Group;
  /** gira o corpo (rotY) e anima */
  pose(p: AthletePose): void;
  /** active = jogador que estou controlando; mate = meu outro atleta */
  setMarker(kind: Marker): void;
  dispose(): void;
  height: number;
}

const shade = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

export function buildAthlete(info: AthleteInfo, teamColor: number, opts: { label?: boolean } = {}): AthleteModel {
  const scale = BAL.height[info.altura] ?? 1;
  const root = new THREE.Group();
  const body = new THREE.Group(); // recebe rotação e animação
  root.add(body);
  const skin = mat(info.corPele, 0.55);
  const skinDark = mat(shade(info.corPele, 0.86), 0.6);
  const lips = mat(new THREE.Color(info.corPele).lerp(new THREE.Color('#b0453f'), 0.55).getHex(), 0.5);
  const jersey = mat(teamColor, 0.5);
  const trim = mat(0xffffff, 0.5);
  const shorts = mat(new THREE.Color(teamColor).multiplyScalar(0.62).getHex(), 0.55);
  const shoe = mat(0xf7f7f7, 0.4);
  const accent = mat(teamColor, 0.4);
  const sole = mat(0x1d1d22, 0.8);

  const sc = new THREE.Group();
  sc.scale.setScalar(scale);
  body.add(sc);

  const hip = new THREE.Group();
  hip.position.y = 0.95;
  sc.add(hip);

  const ell = (g: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, parent: THREE.Object3D) => {
    const o = mesh(g, m, x, y, z, parent);
    o.scale.set(sx, sy, sz);
    return o;
  };
  const sph = (r: number) => new THREE.SphereGeometry(r, 18, 14);
  const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 6, 14);

  // ---- tronco (regata) ----
  const torso = new THREE.Group();
  hip.add(torso);
  ell(sph(1), jersey, 0.215, 0.26, 0.128, 0, 0.35, 0, torso); // peito/ombros
  ell(new THREE.CylinderGeometry(0.16, 0.185, 0.26, 18), jersey, 1, 1, 0.72, 0, 0.12, 0, torso); // cintura
  const collar = mesh(new THREE.TorusGeometry(0.085, 0.014, 8, 20), trim, 0, 0.575, 0.0, torso);
  collar.rotation.x = Math.PI / 2; collar.scale.set(1, 0.9, 1);
  mesh(new THREE.BoxGeometry(0.02, 0.5, 0.01), trim, -0.215, 0.32, 0.0, torso).castShadow = false; // faixa lateral
  mesh(new THREE.BoxGeometry(0.02, 0.5, 0.01), trim, 0.215, 0.32, 0.0, torso).castShadow = false;
  // número
  const tex = numberTexture(info.numero, '#ffffff');
  const numMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const num = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), numMat);
  num.position.set(0, 0.34, -0.131);
  num.rotation.y = Math.PI;
  torso.add(num);
  const numF = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.11), numMat);
  numF.position.set(0, 0.28, 0.131);
  torso.add(numF);

  // bermuda
  ell(new THREE.CylinderGeometry(0.185, 0.21, 0.24, 18), shorts, 1, 1, 0.74, 0, -0.04, 0, hip);
  { const wb = mesh(new THREE.TorusGeometry(0.185, 0.012, 6, 24), trim, 0, 0.08, 0, hip); wb.rotation.x = Math.PI / 2; wb.scale.set(1, 0.74, 1); }

  // pescoço + cabeça
  mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.14, 12), skin, 0, 0.64, 0, hip);
  const head = new THREE.Group();
  head.position.set(0, 0.77, 0.005);
  hip.add(head);
  ell(sph(1), skin, 0.104, 0.125, 0.115, 0, 0, 0, head);
  ell(sph(1), skin, 0.085, 0.07, 0.09, 0, -0.07, 0.02, head); // queixo
  ell(sph(1), skinDark, 0.028, 0.034, 0.02, -0.105, -0.005, 0, head); // orelhas
  ell(sph(1), skinDark, 0.028, 0.034, 0.02, 0.105, -0.005, 0, head);
  ell(sph(1), skinDark, 0.02, 0.022, 0.02, 0, -0.018, 0.118, head); // nariz
  const white = mat(0xffffff, 0.3), pupil = mat(0x1a1210, 0.2), brow = mat(info.corCabelo === '#f5f5f5' ? 0x888888 : info.corCabelo, 0.8);
  for (const sx of [-1, 1]) {
    ell(sph(1), white, 0.022, 0.016, 0.01, 0.042 * sx, 0.02, 0.104, head);
    ell(sph(1), pupil, 0.012, 0.012, 0.01, 0.042 * sx, 0.02, 0.112, head);
    mesh(new THREE.BoxGeometry(0.05, 0.009, 0.01), brow, 0.042 * sx, 0.052, 0.104, head).castShadow = false;
  }
  mesh(new THREE.BoxGeometry(0.046, 0.009, 0.01), lips, 0, -0.058, 0.108, head).castShadow = false;
  addHair(head, info);

  // ---- braços (pivô no ombro) ----
  const mkArm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(0.255 * side, 0.5, 0);
    hip.add(g);
    mesh(sph(0.068), skin, 0, 0, 0, g);
    mesh(cap(0.05, 0.22), skin, 0, -0.17, 0, g);
    const fore = new THREE.Group();
    fore.position.y = -0.33;
    g.add(fore);
    mesh(sph(0.047), skin, 0, 0, 0, fore);
    mesh(cap(0.042, 0.2), skin, 0, -0.14, 0, fore);
    mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.05, 12), trim, 0, -0.23, 0, fore); // munhequeira
    ell(sph(1), skin, 0.05, 0.06, 0.035, 0, -0.31, 0, fore); // mão
    return { g, fore };
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // ---- pernas (pivô no quadril) ----
  const mkLeg = (side: number) => {
    const g = new THREE.Group();
    g.position.set(0.1 * side, -0.1, 0);
    hip.add(g);
    mesh(cap(0.083, 0.28), skin, 0, -0.2, 0, g);
    mesh(new THREE.CylinderGeometry(0.1, 0.115, 0.2, 14), shorts, 0, -0.07, 0, g);
    const shin = new THREE.Group();
    shin.position.y = -0.42;
    g.add(shin);
    mesh(sph(0.07), skin, 0, 0, 0, shin);
    mesh(cap(0.06, 0.26), skin, 0, -0.19, 0, shin);
    mesh(new THREE.CylinderGeometry(0.066, 0.07, 0.17, 12), trim, 0, -0.27, 0, shin); // meião
    mesh(new THREE.CylinderGeometry(0.067, 0.067, 0.03, 12), accent, 0, -0.2, 0, shin);
    ell(sph(1), shoe, 0.072, 0.055, 0.135, 0, -0.395, 0.04, shin);
    ell(sph(1), accent, 0.074, 0.02, 0.1, 0, -0.395, 0.08, shin);
    mesh(new THREE.BoxGeometry(0.135, 0.022, 0.28), sole, 0, -0.44, 0.04, shin);
    return { g, shin };
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  // sombra simples
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);

  // ---- marcador de controle: anel pulsante + seta ----
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

  let label: THREE.Sprite | null = null;
  if (opts.label !== false) {
    label = labelSprite(`${info.numero} ${info.apelido}`);
    label.position.y = 2.3 * scale;
    root.add(label);
  }

  let phase = 0;
  let fall = 0;
  let crouch = 0;
  const lerp = THREE.MathUtils.lerp;

  const model: AthleteModel = {
    root, height: 1.85 * scale,
    setMarker(k) {
      kind = k;
      marker.visible = k !== 'none';
      arrow.visible = k === 'active';
      ring.visible = disc.visible = k !== 'none';
      ringOut.visible = k === 'active';
      ringMat.opacity = k === 'active' ? 0.95 : 0.4;
    },
    pose(p) {
      const f = p.flags;
      if (kind !== 'none') {
        const pulse = 1 + Math.sin(p.t * 6) * 0.05;
        if (kind === 'active') { marker.scale.setScalar(pulse * 1.05); arrow.position.y = 2.6 * scale + Math.sin(p.t * 5) * 0.08 - 0.0; }
        else marker.scale.setScalar(0.85);
        marker.rotation.y = 0;
      }
      body.rotation.y = p.rot + (f & F.SPIN ? p.anim * Math.PI * 2 : 0);
      const run = Math.min(1, p.speed / BAL.move.run);
      phase += p.dt * (4 + p.speed * 1.7);
      const sw = Math.sin(phase);
      const amp = run * 1.0;

      const fallTarget = f & F.FALLEN ? 1 : 0;
      fall = lerp(fall, fallTarget, 1 - Math.exp(-14 * p.dt));
      body.rotation.x = -fall * 1.45;
      body.position.y = fall * 0.2;
      body.rotation.z = f & F.CROSS ? Math.sin(p.anim * Math.PI) * 0.18 : 0;

      let lL = sw * amp, lR = -sw * amp;
      let aL = -sw * amp * 0.9, aR = sw * amp * 0.9;
      let kneeL = Math.max(0, -sw) * amp * 1.0, kneeR = Math.max(0, sw) * amp * 1.0;
      let hipY = 0.95 + Math.abs(Math.cos(phase)) * 0.03 * amp;

      const stance = f & F.BALL || f & F.SHOOT ? 0.04 : 0.08;
      crouch = lerp(crouch, run < 0.2 && !(f & (F.JUMP | F.FALLEN)) ? stance : 0, 1 - Math.exp(-8 * p.dt));
      hipY -= crouch * 1.2;

      let armLx = aL, armRx = aR, armLz = 0.15, armRz = -0.15, foreL = 0.2, foreR = 0.2;

      if (f & F.BALL && !(f & F.SHOOT)) {
        const b = Math.sin(p.t * Math.PI * 3.2);
        armRx = -0.55 - Math.max(0, b) * 0.35; foreR = 0.6 + b * 0.3; armRz = -0.25;
        armLx = -0.9; foreL = 1.0; armLz = 0.45;
      }
      if (f & F.SHOOT) {
        const t = Math.max(0, p.shotT);
        const u = Math.min(1, t / (BAL.shot.idealMs / 1000));
        const bend = t < 0.18 ? Math.sin((t / 0.18) * Math.PI / 2) : Math.max(0, 1 - (t - 0.18) / 0.2);
        hipY -= bend * 0.18;
        lL = lR = 0; kneeL = kneeR = bend * 0.9 + (u > 0.55 ? -0.2 : 0);
        armRx = lerp(-1.1, -3.05, Math.min(1, u * 1.15)); foreR = lerp(1.6, 0.1, u); armRz = -0.1;
        armLx = lerp(-1.0, -2.6, u); foreL = lerp(1.4, 0.7, u); armLz = 0.25;
        body.rotation.x = 0;
      }
      if (f & F.JUMP) {
        lL = -0.3; lR = 0.2; kneeL = 0.8; kneeR = 0.6;
        armLx = -2.9; armRx = -2.9; foreL = foreR = 0.1; armLz = 0.2; armRz = -0.2;
      }
      if (f & F.CONTEST && !(f & F.JUMP)) {
        armRx = -3.0; foreR = 0.1; armRz = -0.15; armLx = -0.6; armLz = 0.9; foreL = 0.2;
        hipY -= 0.06;
      }
      if (f & F.FALLEN) { armLx = -1.5; armRx = -1.5; lL = 0.3; lR = -0.2; }

      hip.position.y = hipY;
      legL.g.rotation.x = lL; legR.g.rotation.x = lR;
      legL.shin.rotation.x = kneeL + crouch * 2.2; legR.shin.rotation.x = kneeR + crouch * 2.2;
      legL.g.rotation.x -= crouch * 1.1; legR.g.rotation.x -= crouch * 1.1;
      armL.g.rotation.set(armLx, 0, armLz); armR.g.rotation.set(armRx, 0, armRz);
      armL.fore.rotation.x = -foreL; armR.fore.rotation.x = -foreR;
      torso.rotation.x = (f & F.SHOOT) ? 0 : run * 0.12 + crouch * 1.4;
      head.rotation.x = -torso.rotation.x * 0.8; // cabeça olha para frente
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

function addHair(head: THREE.Group, info: AthleteInfo) {
  const hair = mat(info.corCabelo, 0.8);
  // calota inclinada para trás: libera a testa e cobre a nuca
  const cap = (r: number, theta: number, tilt = -0.5, sy = 1.04, dz = -0.008) => {
    const m = mesh(new THREE.SphereGeometry(r, 20, 14, 0, Math.PI * 2, 0, Math.PI * theta), hair, 0, 0.004, dz, head);
    m.scale.set(1, sy, 1.02);
    m.rotation.x = tilt;
    return m;
  };
  switch (info.estiloCabelo) {
    case 'careca': break;
    case 'curto': cap(0.121, 0.56); break;
    case 'black': {
      cap(0.19, 0.6, -0.55, 0.95, -0.03).position.y = 0.03;
      break;
    }
    case 'tranca': {
      cap(0.123, 0.58);
      for (let i = 0; i < 11; i++) {
        const a = (i / 10) * Math.PI * 1.6 + Math.PI * 0.7;
        const x = Math.cos(a) * 0.108, z = Math.sin(a) * 0.1 - 0.01;
        if (z > 0.03) continue;
        const b = mesh(new THREE.CapsuleGeometry(0.012, 0.26, 3, 6), hair, x, -0.1, z - 0.01, head);
        b.rotation.x = -0.06;
      }
      break;
    }
    case 'moicano': {
      cap(0.112, 0.5);
      const r = mesh(new THREE.BoxGeometry(0.036, 0.085, 0.19), hair, 0, 0.125, -0.012, head);
      r.rotation.x = -0.1;
      break;
    }
    case 'coque': {
      cap(0.123, 0.56);
      mesh(new THREE.SphereGeometry(0.058, 14, 10), hair, 0, 0.13, -0.075, head);
      break;
    }
  }
}
