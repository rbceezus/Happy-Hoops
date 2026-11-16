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

export interface AthleteModel {
  root: THREE.Group;
  /** gira o corpo (rotY) e anima */
  pose(p: AthletePose): void;
  setControlled(on: boolean): void;
  dispose(): void;
  height: number;
  ring: THREE.Mesh;
}

export function buildAthlete(info: AthleteInfo, teamColor: number, opts: { label?: boolean } = {}): AthleteModel {
  const scale = BAL.height[info.altura] ?? 1;
  const root = new THREE.Group();
  const body = new THREE.Group(); // recebe rotação e animação
  root.add(body);
  const skin = mat(info.corPele, 0.6);
  const jersey = mat(teamColor, 0.6);
  const shorts = mat(new THREE.Color(teamColor).multiplyScalar(0.7).getHex(), 0.6);
  const shoe = mat(0xf2f2f2, 0.5);
  const sole = mat(0x222222, 0.8);

  // escala geral por altura
  const sc = new THREE.Group();
  sc.scale.setScalar(scale);
  body.add(sc);

  // corpo (pivô no quadril)
  const hip = new THREE.Group();
  hip.position.y = 0.95;
  sc.add(hip);

  const torso = mesh(new THREE.BoxGeometry(0.42, 0.52, 0.24), jersey, 0, 0.3, 0, hip);
  mesh(new THREE.BoxGeometry(0.40, 0.2, 0.25), shorts, 0, -0.05, 0, hip);
  // número nas costas e frente
  const tex = numberTexture(info.numero, '#ffffff');
  const numMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const num = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), numMat);
  num.position.set(0, 0.32, -0.125);
  num.rotation.y = Math.PI;
  hip.add(num);
  const numF = num.clone();
  numF.scale.setScalar(0.45); numF.position.set(0, 0.28, 0.126); numF.rotation.y = 0;
  hip.add(numF);

  // pescoço + cabeça
  mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin, 0, 0.6, 0, hip);
  const head = new THREE.Group();
  head.position.set(0, 0.74, 0);
  hip.add(head);
  mesh(new THREE.SphereGeometry(0.115, 14, 12), skin, 0, 0, 0, head);
  const eye = mat(0x111111);
  mesh(new THREE.SphereGeometry(0.014, 6, 6), eye, -0.04, 0.015, 0.105, head);
  mesh(new THREE.SphereGeometry(0.014, 6, 6), eye, 0.04, 0.015, 0.105, head);
  addHair(head, info);

  // braços (pivô no ombro)
  const mkArm = (side: number) => {
    const g = new THREE.Group();
    g.position.set(0.26 * side, 0.5, 0);
    hip.add(g);
    mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.32, 8), skin, 0, -0.16, 0, g);
    const fore = new THREE.Group();
    fore.position.y = -0.32;
    g.add(fore);
    mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.3, 8), skin, 0, -0.15, 0, fore);
    mesh(new THREE.SphereGeometry(0.05, 8, 8), skin, 0, -0.32, 0, fore);
    return { g, fore };
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // pernas (pivô no quadril)
  const mkLeg = (side: number) => {
    const g = new THREE.Group();
    g.position.set(0.11 * side, -0.1, 0);
    hip.add(g);
    mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.42, 8), skin, 0, -0.21, 0, g);
    const shin = new THREE.Group();
    shin.position.y = -0.42;
    g.add(shin);
    mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.4, 8), skin, 0, -0.2, 0, shin);
    mesh(new THREE.BoxGeometry(0.11, 0.07, 0.24), shoe, 0, -0.41, 0.05, shin);
    mesh(new THREE.BoxGeometry(0.115, 0.025, 0.25), sole, 0, -0.455, 0.05, shin);
    return { g, shin };
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  // sombra simples
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);

  // anel de controle
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.62, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  root.add(ring);

  let label: THREE.Sprite | null = null;
  if (opts.label !== false) {
    label = labelSprite(`${info.numero} ${info.apelido}`);
    label.position.y = 2.25 * scale;
    root.add(label);
  }

  let phase = 0;
  let fall = 0;
  let crouch = 0;
  const lerp = THREE.MathUtils.lerp;

  const model: AthleteModel = {
    root, ring, height: 1.85 * scale,
    setControlled(on) {
      ring.visible = on;
      (ring.material as THREE.MeshBasicMaterial).color.setHex(teamColor);
    },
    pose(p) {
      const f = p.flags;
      body.rotation.y = p.rot + (f & F.SPIN ? p.anim * Math.PI * 2 : 0);
      const run = Math.min(1, p.speed / BAL.move.run);
      phase += p.dt * (4 + p.speed * 1.7);
      const sw = Math.sin(phase);
      const amp = run * 1.0;

      // queda (ankle breaker)
      const fallTarget = f & F.FALLEN ? 1 : 0;
      fall = lerp(fall, fallTarget, 1 - Math.exp(-14 * p.dt));
      body.rotation.x = -fall * 1.45;
      body.position.y = fall * 0.2;
      body.rotation.z = f & F.CROSS ? Math.sin(p.anim * Math.PI) * 0.18 : 0;

      // base: pernas e braços balançando
      let lL = sw * amp, lR = -sw * amp;
      let aL = -sw * amp * 0.9, aR = sw * amp * 0.9;
      let kneeL = Math.max(0, -sw) * amp * 1.0, kneeR = Math.max(0, sw) * amp * 1.0;
      let hipY = 0.95 + Math.abs(Math.cos(phase)) * 0.03 * amp;

      // postura: defensor agachado, atacante com bola semi-agachado
      const stance = f & F.BALL || f & F.SHOOT ? 0.04 : 0.08;
      crouch = lerp(crouch, run < 0.2 && !(f & (F.JUMP | F.FALLEN)) ? stance : 0, 1 - Math.exp(-8 * p.dt));
      hipY -= crouch * 1.2;

      let armLx = aL, armRx = aR, armLz = 0.15, armRz = -0.15, foreL = 0.2, foreR = 0.2;

      if (f & F.BALL && !(f & F.SHOOT)) {
        // quicando: braço direito faz o drible, esquerdo protege
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
  const hair = mat(info.corCabelo, 0.85);
  const cap = (r: number, y = 0.01, sy = 1) => {
    const m = mesh(new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, y, -0.005, head);
    m.scale.y = sy;
    return m;
  };
  switch (info.estiloCabelo) {
    case 'careca': break;
    case 'curto': cap(0.123); break;
    case 'black': {
      const m = mesh(new THREE.SphereGeometry(0.2, 14, 12), hair, 0, 0.05, -0.03, head);
      m.scale.set(1, 0.92, 1);
      break;
    }
    case 'tranca': {
      cap(0.125);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 1.7 + Math.PI * 0.65;
        const x = Math.cos(a) * 0.11, z = Math.sin(a) * 0.11 - 0.02;
        mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.3, 5), hair, x, -0.1, z, head);
      }
      break;
    }
    case 'moicano': {
      cap(0.118);
      mesh(new THREE.BoxGeometry(0.035, 0.09, 0.2), hair, 0, 0.12, -0.01, head);
      break;
    }
    case 'coque': {
      cap(0.123);
      mesh(new THREE.SphereGeometry(0.06, 10, 8), hair, 0, 0.12, -0.07, head);
      break;
    }
  }
}
