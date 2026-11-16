// Cenário do jogo: baseado no artefato "Quadra – modelo 3D" (laje, gramado, arquibancada de madeira, café, prédios, árvores),
// com a meia quadra pintada (linhas, garrafão, arco de 3), cesta com altura oficial (3,05 m) e bola.
import * as THREE from 'three';
import {
  ARC_R, ARC_ZC, BOARD_HW, BOARD_Y0, BOARD_Y1, BOARD_Z, CHECK_POS, CORNER_X, COURT, FT_R, FT_Z, HOOP, KEY_HW, RIM_R,
} from '../../shared/court';

const SKY = 0xc9d3dc;

const mat = (c: number, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, ...o });

function add(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, shadow = true) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}

export interface Scene3D {
  scene: THREE.Scene;
  ball: THREE.Mesh;
  net: THREE.Mesh;
  hoopGroup: THREE.Group;
  setQuality(low: boolean): void;
  sun: THREE.DirectionalLight;
}

export function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9631e';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#1a0f08';
  g.lineWidth = 5;
  g.beginPath();
  for (const x of [0, 128, 256, 384, 512]) { g.moveTo(x, 0); g.lineTo(x, 256); }
  g.moveTo(0, 128); g.lineTo(512, 128);
  g.stroke();
  g.lineWidth = 4;
  for (const x of [64, 192, 320, 448]) {
    g.beginPath(); g.ellipse(x, 128, 62, 60, 0, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.beginPath(); g.ellipse(x + 0, 128, 62, 60, 0, Math.PI / 2, Math.PI * 1.5); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function courtTexture(): THREE.CanvasTexture {
  const S = 64; // pixels por metro
  const x0 = -9, x1 = 9, z0 = -3.5, z1 = 14.5;
  const W = (x1 - x0) * S, H = (z1 - z0) * S;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const X = (x: number) => (x - x0) * S;
  const Z = (z: number) => (z - z0) * S;
  // base
  g.fillStyle = '#c8bda4'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#a89f8c';
  g.fillRect(X(COURT.xMin), Z(COURT.zMin), (COURT.xMax - COURT.xMin) * S, (COURT.zMax - COURT.zMin) * S);
  // ruído leve de concreto polido
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '60,50,40'},${Math.random() * 0.05})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 2 + Math.random() * 6);
  }
  // garrafão pintado
  g.fillStyle = 'rgba(38,112,138,0.85)';
  g.fillRect(X(-KEY_HW), Z(COURT.zMin), KEY_HW * 2 * S, (FT_Z - COURT.zMin) * S);
  g.beginPath(); g.arc(X(0), Z(FT_Z), FT_R * S, 0, Math.PI * 2); g.fill();
  // área de dentro do arco (leve tom)
  g.fillStyle = 'rgba(38,112,138,0.12)';
  g.beginPath();
  g.moveTo(X(-CORNER_X), Z(COURT.zMin));
  g.lineTo(X(-CORNER_X), Z(ARC_ZC));
  g.arc(X(0), Z(0), ARC_R * S, Math.PI - Math.asin(ARC_ZC / ARC_R), Math.asin(ARC_ZC / ARC_R), true);
  g.lineTo(X(CORNER_X), Z(COURT.zMin));
  g.closePath(); g.fill();
  // linhas
  g.strokeStyle = '#f4f1e8'; g.fillStyle = '#f4f1e8'; g.lineWidth = 0.075 * S; g.lineJoin = 'round';
  g.strokeRect(X(COURT.xMin), Z(COURT.zMin), (COURT.xMax - COURT.xMin) * S, (COURT.zMax - COURT.zMin) * S);
  g.strokeRect(X(-KEY_HW), Z(COURT.zMin), KEY_HW * 2 * S, (FT_Z - COURT.zMin) * S);
  g.beginPath(); g.arc(X(0), Z(FT_Z), FT_R * S, 0, Math.PI * 2); g.stroke();
  // arco de 3
  g.beginPath();
  g.moveTo(X(-CORNER_X), Z(COURT.zMin));
  g.lineTo(X(-CORNER_X), Z(ARC_ZC));
  const a0 = Math.PI - Math.asin(ARC_ZC / ARC_R), a1 = Math.asin(ARC_ZC / ARC_R);
  g.arc(X(0), Z(0), ARC_R * S, a0, a1, true);
  g.lineTo(X(CORNER_X), Z(COURT.zMin));
  g.stroke();
  // semicírculo restrito
  g.beginPath(); g.arc(X(0), Z(0), 1.25 * S, 0, Math.PI, false); g.stroke();
  // círculo do meio (parte dentro da meia quadra)
  g.beginPath(); g.arc(X(0), Z(COURT.zMax), 1.8 * S, Math.PI, 0, false); g.stroke();
  // marca do check
  g.beginPath(); g.arc(X(CHECK_POS.x), Z(CHECK_POS.z), 0.22 * S, 0, Math.PI * 2); g.stroke();
  g.font = `bold ${0.5 * S}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = 'rgba(244,241,232,.55)';
  g.fillText('HAPPY HOOPS', X(0), Z(8.9));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  (t as unknown as { userData: Record<string, number> }).userData = { x0, x1, z0, z1 };
  return t;
}

export function buildScene(): Scene3D {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 70, 150);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8f6a, 0.65));
  const sun = new THREE.DirectionalLight(0xfff6e6, 0.85);
  sun.position.set(9, 28, 16);
  sun.target.position.set(0, 0, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 16, bottom: -9, near: 1, far: 70 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  // ---- ambiente do artefato (rotacionado: o aro da direita vira o aro do jogo) ----
  const env = new THREE.Group();
  env.rotation.y = Math.PI / 2;
  env.position.set(-2, 0, 13.28);
  scene.add(env);

  // gramado
  add(new THREE.BoxGeometry(80, 0.2, 70), mat(0x6f9a48, { roughness: 1 }), 0, -0.11, -12, env, false);
  for (let i = -10; i <= 10; i++) add(new THREE.BoxGeometry(4, 0.01, 70), mat(i % 2 ? 0x6a9544 : 0x76a24e, { roughness: 1 }), i * 4, 0, -12, env, false);

  // laje de concreto
  const slabShape = (k: number) => {
    const s = new THREE.Shape();
    s.moveTo(-26 + k, 12); s.lineTo(-26 + k, -3);
    s.bezierCurveTo(-20, -7 + k, -12, -9 + k, -4, -7 + k);
    s.bezierCurveTo(2, -5.5 + k * 0.5, 6, -2 + k, 12, -3.5 + k);
    s.bezierCurveTo(18, -5 + k, 22, -3 + k, 26 - k, -1);
    s.lineTo(26 - k, 12); s.lineTo(-26 + k, 12);
    return s;
  };
  const slab = (shape: THREE.Shape, color: number, y: number, h: number) => {
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }), mat(color, { roughness: 0.55 }));
    m.rotation.x = Math.PI / 2; m.position.y = y + h; m.receiveShadow = true; env.add(m);
  };
  slab(slabShape(0), 0xcfc3a8, 0, 0.14);
  slab(slabShape(2.2), 0x9d9588, 0.14, 0.01);

  // poste preto
  const pole = new THREE.Group(); env.add(pole); pole.position.set(-6.5, 0.14, -6.8);
  add(new THREE.CylinderGeometry(0.09, 0.11, 6.4, 12), mat(0x1c1e21, { roughness: 0.4 }), 0, 3.2, 0, pole);
  add(new THREE.BoxGeometry(1.1, 0.12, 0.12), mat(0x1c1e21), -0.45, 6.4, 0, pole);

  // calçada de pedra
  for (let x = 0; x < 8; x++) for (let z = 0; z < 10; z++) {
    add(new THREE.BoxGeometry(1.45, 0.08, 1.45), mat((x + z) % 2 ? 0x9a9c9a : 0xb4b6b2), -33 + x * 1.5, 0.04, -6 - z * 1.5, env, false);
  }
  // arquibancada de madeira
  const wood = mat(0x8a5a3a, { roughness: 0.8 }), corten = mat(0x6e4a38);
  for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(70, 0.45 + i * 0.45, 1.1), i === 2 ? corten : wood, 0, (0.45 + i * 0.45) / 2, -26 - i * 1.1, env);
  add(new THREE.BoxGeometry(70, 1.2, 2.2), mat(0x2f4a2a), 0, 1.9, -31.4, env);
  for (let x = -34; x <= 34; x += 2.1) {
    const s = add(new THREE.SphereGeometry(1.1, 10, 8), mat(0x3d6b35), x, 2.7, -31.4, env);
    s.scale.y = 0.8;
  }
  // café
  add(new THREE.BoxGeometry(56, 3.4, 8), mat(0x20262b, { roughness: 0.2, metalness: 0.2 }), -2, 2.9, -38, env);
  for (let i = 0; i < 4; i++) {
    const sail = add(new THREE.BoxGeometry(11, 0.12, 9), mat(0xf3f3f0), -22 + i * 14, 4.6 + (i % 2) * 0.4, -35, env);
    sail.rotation.x = -0.18; sail.rotation.z = i % 2 ? 0.08 : -0.06;
    add(new THREE.CylinderGeometry(0.07, 0.07, 3, 8), mat(0xdddddd), -22 + i * 14, 3.1, -31, env);
  }
  // prédios
  const building = (x: number, z: number, w: number, h: number, d: number, col = 0xb9bec2) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); env.add(g);
    add(new THREE.BoxGeometry(w, h, d), mat(col), 0, h / 2, 0, g);
    const wm = mat(0xf1f3f4), gl = mat(0x4b5359, { roughness: 0.2 });
    for (let fy = 3; fy < h - 1; fy += 3.2) for (let fx = -w / 2 + 2; fx < w / 2 - 1; fx += 2.6) {
      add(new THREE.BoxGeometry(1.8, 1.9, 0.12), gl, fx, fy, d / 2 + 0.02, g, false);
      add(new THREE.BoxGeometry(0.18, 2.3, 0.2), wm, fx + 1.1, fy, d / 2 + 0.05, g, false);
    }
  };
  building(-18, -52, 44, 18, 10); building(26, -56, 36, 26, 10, 0xaeb4b9); building(-48, -48, 22, 14, 10, 0xc4c8ca);
  // árvores
  const tree = (x: number, z: number, h = 7) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); env.add(g);
    add(new THREE.CylinderGeometry(0.1, 0.17, h, 8), mat(0x4a4036), 0, h / 2, 0, g);
    const leaf = mat(0x93b84a, { roughness: 1 });
    for (let i = 0; i < 10; i++) {
      const a = i * 2.4, r = 0.7 + (((i * 37) % 10) / 10) * 1.7;
      const s = add(new THREE.SphereGeometry(1 + ((i * 13) % 7) / 9, 10, 8), leaf, Math.cos(a) * r, h + (((i * 17) % 10) / 10) * 1.8, Math.sin(a) * r, g);
      s.scale.y = 0.5;
    }
  };
  [[-30, -28, 8], [-16, -31, 7], [6, -30, 8], [18, -31, 7.5], [30, -29, 8], [-24, -14, 6], [22, -12, 5.5]].forEach((t) => tree(t[0], t[1], t[2]));

  // ---- quadra pintada ----
  const tex = courtTexture();
  const ud = (tex as unknown as { userData: { x0: number; x1: number; z0: number; z1: number } }).userData;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(ud.x1 - ud.x0, ud.z1 - ud.z0),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set((ud.x0 + ud.x1) / 2, 0.16, (ud.z0 + ud.z1) / 2);
  plane.receiveShadow = true;
  scene.add(plane);

  // ---- cesta (3,05 m) ----
  const hoopGroup = new THREE.Group();
  scene.add(hoopGroup);
  const steel = mat(0x333a40, { roughness: 0.4, metalness: 0.4 });
  add(new THREE.CylinderGeometry(0.11, 0.13, 3.9, 10), steel, 0, 1.95, -2.35, hoopGroup);
  add(new THREE.BoxGeometry(0.12, 0.12, 2.0), steel, 0, 3.6, -1.4, hoopGroup);
  const pad = add(new THREE.CylinderGeometry(0.2, 0.2, 1.0, 14), mat(0xe0531f), 0, 0.5, -2.35, hoopGroup);
  pad.castShadow = false;
  const bw = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD_HW * 2, BOARD_Y1 - BOARD_Y0, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xf2f6f8, transparent: true, opacity: 0.62, roughness: 0.15 }),
  );
  bw.position.set(0, (BOARD_Y0 + BOARD_Y1) / 2, BOARD_Z - 0.03);
  bw.castShadow = true;
  hoopGroup.add(bw);
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.59 * 2, 0.45 * 2, 0.06)),
    new THREE.LineBasicMaterial({ color: 0xe0531f }),
  );
  frame.position.set(0, HOOP.y + 0.3, BOARD_Z - 0.0);
  hoopGroup.add(frame);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, 0.014, 8, 28), mat(0xe0531f, { roughness: 0.4 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, HOOP.y, 0);
  rim.castShadow = true;
  hoopGroup.add(rim);
  add(new THREE.BoxGeometry(0.05, 0.05, 0.16), mat(0xe0531f), 0, HOOP.y, BOARD_Z + 0.1, hoopGroup);
  const net = new THREE.Mesh(
    new THREE.CylinderGeometry(RIM_R, 0.13, 0.42, 14, 4, true),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.85 }),
  );
  net.position.set(0, HOOP.y - 0.21, 0);
  hoopGroup.add(net);

  // ---- bola ----
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 20, 16),
    new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.55 }),
  );
  ball.castShadow = true;
  scene.add(ball);

  return {
    scene, ball, net, hoopGroup, sun,
    setQuality(low) {
      sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    },
  };
}
