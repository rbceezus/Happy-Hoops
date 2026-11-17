// Atleta com esqueleto real, seguindo o padrão do pmndrs/ecctrl (MIT):
//  - um modelo humano com esqueleto (AnimationLibrary do Quaternius, CC0) carregado uma vez e clonado por atleta;
//  - uma máquina de estados que mapeia o estado do jogador (parado/andar/correr/pulo/queda...) para clipes de animação
//    com transição suave (crossFade), como o `statusToActionMap` do ecctrl;
//  - ações específicas do basquete (drible, arremesso, bandeja, enterrada, contestação) sobrepostas aos ossos
//    com pesos suavizados, já que a biblioteca não tem animações de basquete.
// Cor de pele, cabelo, camisa, bermuda e tênis são aplicados por atleta.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BAL } from '../../shared/balance';
import { AthleteInfo, F } from '../../shared/types';
import { AthleteModel, AthletePose, Marker, addFace, addHair, labelSprite, lathe, mat, mesh, numberTexture, registerRigBuilder, shade } from './athlete';

const S = (n: string) => THREE.PropertyBinding.sanitizeNodeName(n);
const B = {
  root: S('root'), hips: S('DEF-hips'), sp1: S('DEF-spine.001'), sp2: S('DEF-spine.002'), sp3: S('DEF-spine.003'), neck: S('DEF-neck'), head: S('DEF-head'),
  shL: S('DEF-shoulder.L'), uaL: S('DEF-upper_arm.L'), faL: S('DEF-forearm.L'), haL: S('DEF-hand.L'),
  shR: S('DEF-shoulder.R'), uaR: S('DEF-upper_arm.R'), faR: S('DEF-forearm.R'), haR: S('DEF-hand.R'),
  thL: S('DEF-thigh.L'), snL: S('DEF-shin.L'), ftL: S('DEF-foot.L'), tsL: S('DEF-toe.L'),
  thR: S('DEF-thigh.R'), snR: S('DEF-shin.R'), ftR: S('DEF-foot.R'), tsR: S('DEF-toe.R'),
};
const PARENT: Record<string, string> = {
  [B.uaL]: B.shL, [B.faL]: B.uaL, [B.haL]: B.faL, [B.uaR]: B.shR, [B.faR]: B.uaR, [B.haR]: B.faR,
  [B.thL]: B.hips, [B.snL]: B.thL, [B.ftL]: B.snL, [B.thR]: B.hips, [B.snR]: B.thR, [B.ftR]: B.snR,
  [B.sp1]: B.hips, [B.sp2]: B.sp1, [B.sp3]: B.sp2, [B.neck]: B.sp3, [B.head]: B.neck,
};
// osso -> osso filho usado para achar a direção do membro (para "pendurar" a pose de referência na vertical)
const HANG: Record<string, string> = {
  [B.uaL]: B.faL, [B.faL]: B.haL, [B.uaR]: B.faR, [B.faR]: B.haR,
  [B.thL]: B.snL, [B.snL]: B.ftL, [B.thR]: B.snR, [B.snR]: B.ftR,
};

interface RigData {
  scene: THREE.Group;
  clips: Record<string, THREE.AnimationClip>;
  refW: Record<string, THREE.Quaternion>; // orientação mundial de referência (membros na vertical)
  refL: Record<string, THREE.Quaternion>; // orientação local de referência
}
let RIG: RigData | null = null;

export async function loadRig(url = '/models/athlete-rig.glb'): Promise<boolean> {
  if (RIG) return true;
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const scene = gltf.scene;
    const clips: Record<string, THREE.AnimationClip> = {};
    for (const c of gltf.animations) clips[c.name] = c;
    // pose de referência: primeiro quadro do Idle (braços e pernas "pendurados" na vertical)
    const ref = cloneSkinned(scene);
    const mixer = new THREE.AnimationMixer(ref);
    mixer.clipAction(clips.Idle_Loop).play();
    mixer.setTime(0);
    ref.updateMatrixWorld(true);
    const bones: Record<string, THREE.Object3D> = {};
    ref.traverse((o) => { if ((o as THREE.Bone).isBone) bones[o.name] = o; });
    const refW: Record<string, THREE.Quaternion> = {};
    for (const [k, b] of Object.entries(bones)) refW[k] = b.getWorldQuaternion(new THREE.Quaternion());
    const down = new THREE.Vector3(0, -1, 0);
    for (const [bn, child] of Object.entries(HANG)) {
      const a = bones[bn].getWorldPosition(new THREE.Vector3()), c = bones[child].getWorldPosition(new THREE.Vector3());
      const dir = c.sub(a).normalize();
      refW[bn] = new THREE.Quaternion().setFromUnitVectors(dir, down).multiply(refW[bn]);
    }
    const refL: Record<string, THREE.Quaternion> = {};
    for (const bn of Object.keys(bones)) {
      const p = PARENT[bn];
      refL[bn] = p && refW[p] ? refW[p].clone().invert().multiply(refW[bn]) : refW[bn].clone();
    }
    RIG = { scene, clips, refW, refL };
    registerRigBuilder(buildRigged);
    return true;
  } catch (e) {
    console.warn('Esqueleto não carregou; usando o boneco simples.', e);
    return false;
  }
}

/** textura de jeans (trama diagonal fina + variação de tom) */
function denimTexture(color: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const col = new THREE.Color(color);
  g.fillStyle = `#${col.getHexString()}`; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 2) { g.fillStyle = `rgba(255,255,255,${0.05 + (i % 8) * 0.004})`; g.fillRect(0, i, 128, 1); }
  for (let i = 0; i < 128; i += 2) { g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(i, 0, 1, 128); }
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.07})`; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 4); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const seg = (u: number, a: number, b: number) => clamp01((u - a) / (b - a));
const ease = (t: number) => t * t * (3 - 2 * t);
const lerp3 = (a: number, b: number, c: number, t1: number, t2: number) => (a + (b - a) * t1) + (c - (a + (b - a) * t1)) * t2;
const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const eul = new THREE.Euler();

function buildRigged(info: AthleteInfo, teamColor: number, opts: { label?: boolean } = {}): AthleteModel {
  const rig = RIG!;
  const hScale = BAL.height[info.altura] ?? 1;
  const root = new THREE.Group();
  const body = new THREE.Group(); // yaw do corpo (direção em que o atleta olha/anda)
  root.add(body);
  const sc = new THREE.Group();
  sc.scale.setScalar(hScale);
  body.add(sc);
  const model = cloneSkinned(rig.scene) as THREE.Group;
  sc.add(model);
  model.updateMatrixWorld(true);

  const bones: Record<string, THREE.Bone> = {};
  model.traverse((o) => { if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone; });

  // ---- pele
  const skin = new THREE.MeshStandardMaterial({ color: info.corPele, roughness: 0.5 });
  const skinJoint = new THREE.MeshStandardMaterial({ color: shade(info.corPele, 0.9), roughness: 0.55 });
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
    m.material = (m.material as THREE.Material).name === 'M_Joints' ? skinJoint : skin;
  });

  // ---- roupas (medidas na pose de referência do modelo e presas aos ossos)
  const trim = mat(0xffffff, 0.5);
  const teamBand = mat(teamColor, 0.45);
  const attach = (o: THREE.Object3D, bone: string) => { model.add(o); model.updateMatrixWorld(true); bones[bone].attach(o); return o; };
  const geo = (g: THREE.BufferGeometry, sx = 1, sy = 1, sz = 1, tx = 0, ty = 0, tz = 0) => { g.scale(sx, sy, sz); g.translate(tx, ty, tz); return g; };
  const cloth = (color: number, rough = 0.85, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });

  // --- camiseta (todas pretas)
  const blackTop = cloth(0x141416, 0.88);
  const sleeveMat = cloth(0x141416, 0.88, { side: THREE.DoubleSide });
  const isTank = info.roupaTop === 'regata-preta';
  const tex = numberTexture(info.numero, '#ffffff');
  if (isTank) {
    // regata: casca com cava funda, alças e número
    attach(mesh(geo(lathe([[0.001, 0.97], [0.158, 0.97], [0.16, 1.08], [0.168, 1.18], [0.19, 1.28], [0.2, 1.36], [0.178, 1.43], [0.105, 1.475], [0.001, 1.485]], 28), 1, 1, 0.9, 0, 0, 0.004), blackTop, 0, 0, 0, model), B.sp2);
    for (const sx of [-1, 1]) {
      const strap = mesh(new THREE.CapsuleGeometry(0.034, 0.1, 4, 10), blackTop, 0.125 * sx, 1.43, 0.0, model);
      strap.rotation.z = 0.7 * sx; strap.scale.set(1, 1, 0.9); attach(strap, B.sp3);
    }
    const numMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const numB = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), numMat);
    numB.position.set(0, 1.2, -0.13); numB.rotation.y = Math.PI; attach(numB, B.sp2);
    const numF = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), numMat);
    numF.position.set(0, 1.17, 0.145); attach(numF, B.sp2);
  } else {
    // t-shirt / polo: corpo mais folgado, mais comprido, com mangas curtas
    attach(mesh(geo(lathe([[0.001, 0.9], [0.172, 0.9], [0.176, 1.02], [0.182, 1.14], [0.2, 1.28], [0.215, 1.37], [0.207, 1.425], [0.172, 1.467], [0.1, 1.492], [0.001, 1.5]], 28), 1, 1, 0.9, 0, 0, 0.004), blackTop, 0, 0, 0, model), B.sp2);
    const hemT = mesh(geo(new THREE.TorusGeometry(0.172, 0.007, 8, 28), 1, 1, 0.9, 0, 0, 0.004), cloth(0x1b1b1e, 0.8), 0, 0.9, 0, model);
    hemT.rotation.x = Math.PI / 2; attach(hemT, B.sp2);
    // mangas (cilindros ao redor do braço, abertos nas pontas)
    for (const [sx, bone] of [[1, B.uaL], [-1, B.uaR]] as [number, string][]) {
      const len = info.roupaTop === 'polo-preta' ? 0.17 : 0.15;
      const x0 = 0.15, x1 = 0.192 + len + 0.012;
      const sl = mesh(new THREE.CylinderGeometry(0.1, 0.078, x1 - x0, 20, 1, true), sleeveMat, sx * ((x0 + x1) / 2), 1.441, -0.065, model);
      sl.rotation.z = Math.PI / 2; attach(sl, bone);
      const cap = mesh(new THREE.SphereGeometry(0.092, 18, 14), sleeveMat, sx * 0.19, 1.43, -0.065, model);
      attach(cap, bone);
      const cuff = mesh(new THREE.TorusGeometry(0.078, 0.006, 8, 20), cloth(0x1c1c20, 0.8), sx * x1, 1.441, -0.065, model);
      cuff.rotation.y = Math.PI / 2; attach(cuff, bone);
    }
    if (info.roupaTop === 'polo-preta') {
      // gola dobrada em V + botões
      for (const sx of [-1, 1]) {
        const flap = mesh(new THREE.BoxGeometry(0.075, 0.028, 0.012), cloth(0x1d1d21, 0.8), 0.045 * sx, 1.462, 0.058, model);
        flap.rotation.set(0.35, 0, -0.55 * sx); attach(flap, B.sp3);
      }
      const back = mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 22, Math.PI * 1.35), cloth(0x1d1d21, 0.8), 0, 1.472, -0.01, model);
      back.rotation.set(Math.PI / 2, 0, Math.PI * 0.82); back.scale.set(1, 0.88, 1); attach(back, B.sp3);
      const plac = mesh(new THREE.BoxGeometry(0.03, 0.15, 0.008), cloth(0x1f1f23, 0.8), 0, 1.38, 0.148, model);
      attach(plac, B.sp3);
      for (const y of [1.43, 1.37]) { const bt = mesh(new THREE.SphereGeometry(0.009, 8, 8), cloth(0x55555a, 0.4), 0, y, 0.153, model); attach(bt, B.sp3); }
    } else {
      // gola redonda de t-shirt
      const neck = mesh(new THREE.TorusGeometry(0.086, 0.012, 8, 24), cloth(0x1c1c20, 0.8), 0, 1.468, 0.006, model);
      neck.rotation.x = Math.PI / 2; neck.scale.set(1, 0.88, 1); attach(neck, B.sp3);
    }
  }

  // --- parte de baixo (calça preta / jeans cinza / jeans azul)
  const denim = info.roupaBottom !== 'calca-preta';
  const bottomColor = info.roupaBottom === 'jeans-azul' ? 0x2c5aa0 : info.roupaBottom === 'jeans-cinza' ? 0x6c7078 : 0x151517;
  const pantsMat = denim ? new THREE.MeshStandardMaterial({ color: 0xffffff, map: denimTexture(bottomColor), roughness: 0.92, side: THREE.DoubleSide }) : cloth(bottomColor, 0.85, { side: THREE.DoubleSide });
  const seam = cloth(denim ? (info.roupaBottom === 'jeans-azul' ? 0xd9b25a : 0xcfcfcf) : 0x2a2a2e, 0.6);
  attach(mesh(geo(lathe([[0.001, 1.01], [0.178, 1.01], [0.2, 0.95], [0.222, 0.86], [0.222, 0.76]], 28), 1, 1, 0.84), pantsMat, 0, 0, 0, model), B.hips);
  const belt = mesh(geo(new THREE.TorusGeometry(0.18, 0.011, 8, 28), 1, 1, 0.84), cloth(denim ? 0x3a2a1a : 0x222226, 0.6), 0, 1.0, 0, model);
  belt.rotation.x = Math.PI / 2; attach(belt, B.hips);
  if (denim) for (const sx of [-1, 1]) { // bolsos traseiros e costura
    const pk = mesh(new THREE.BoxGeometry(0.07, 0.075, 0.006), cloth(bottomColor, 0.9), 0.065 * sx, 0.9, -0.147, model);
    attach(pk, B.hips);
    const st = mesh(new THREE.BoxGeometry(0.074, 0.004, 0.007), seam, 0.065 * sx, 0.935, -0.149, model); attach(st, B.hips);
  }
  for (const [sx, thigh, shin] of [[1, B.thL, B.snL], [-1, B.thR, B.snR]] as [number, string, string][]) {
    const up = mesh(new THREE.CylinderGeometry(0.128, 0.092, 0.46, 22, 1, true), pantsMat, 0.089 * sx, 0.745, 0, model);
    attach(up, thigh);
    const hipJ = mesh(new THREE.SphereGeometry(0.125, 18, 14), pantsMat, 0.089 * sx, 0.9, 0, model);
    attach(hipJ, thigh);
    const knee = mesh(new THREE.SphereGeometry(0.088, 18, 14), pantsMat, 0.089 * sx, 0.532, 0, model);
    attach(knee, shin);
    // a canela do modelo desce inclinada para trás e a panturrilha é bem projetada atrás
    const low = mesh(new THREE.CylinderGeometry(0.112, 0.092, 0.47, 22, 1, true), pantsMat, 0.089 * sx, 0.31, -0.034, model);
    low.rotation.x = 0.09; attach(low, shin);
    const hemP = mesh(new THREE.TorusGeometry(0.092, 0.006, 8, 22), seam, 0.089 * sx, 0.083, -0.05, model);
    hemP.rotation.x = Math.PI / 2; attach(hemP, shin);
    // tênis
    const shoeColor = info.calcado === 'tenis-azul' ? 0x1f4fae : 0x151517;
    const shoeBody = cloth(shoeColor, 0.5), whiteSole = mat(0xf2f2f2, 0.6);
    const shoe = mesh(new THREE.SphereGeometry(1, 20, 14), shoeBody, 0.089 * sx, 0.06, 0.035, model);
    shoe.scale.set(0.072, 0.078, 0.17); attach(shoe, shin === B.snL ? B.ftL : B.ftR);
    const toe = mesh(new THREE.SphereGeometry(1, 16, 12), cloth(shoeColor, 0.45), 0.089 * sx, 0.05, 0.085, model);
    toe.scale.set(0.068, 0.034, 0.095); attach(toe, shin === B.snL ? B.ftL : B.ftR);
    const lace = mesh(new THREE.BoxGeometry(0.03, 0.008, 0.09), trim, 0.089 * sx, 0.112, 0.04, model);
    attach(lace, shin === B.snL ? B.ftL : B.ftR);
    const soleM = mesh(new THREE.BoxGeometry(0.125, 0.024, 0.3), whiteSole, 0.089 * sx, 0.011, 0.045, model);
    attach(soleM, shin === B.snL ? B.ftL : B.ftR);
  }
  // munhequeiras na cor do time (identificam o time, já que as roupas são pretas)
  for (const [sx, fore] of [[1, B.faL], [-1, B.faR]] as [number, string][]) {
    const wr = mesh(new THREE.CylinderGeometry(0.039, 0.039, 0.055, 14), teamBand, 0.69 * sx, 1.441, -0.067, model);
    wr.rotation.z = Math.PI / 2; attach(wr, fore);
  }

  // cabeça: rosto + cabelo (elipsoide de raios 0.093/0.114/0.104 escalonado para a cabeça do modelo)
  const headG = new THREE.Group();
  headG.position.set(0, 1.7, 0.009);
  headG.scale.set(0.935, 1.14, 1.048);
  model.add(headG);
  addFace(headG, info);
  addHair(headG, info);
  model.updateMatrixWorld(true);
  bones[B.head].attach(headG);
  // orelhas já vêm de addFace; pescoço/queixo são do próprio modelo

  // ---- sombra + marcador de controle
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; root.add(shadow);
  const marker = new THREE.Group(); marker.visible = false; root.add(marker);
  const ringMat = new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.78, 40), ringMat);
  const ringOut = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.86, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.58, 40), new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
  for (const m of [disc, ring, ringOut]) { m.rotation.x = -Math.PI / 2; m.position.y = 0.2; marker.add(m); }
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 4), new THREE.MeshBasicMaterial({ color: teamColor, depthTest: false }));
  arrow.rotation.x = Math.PI; arrow.renderOrder = 11;
  const arrowEdge = new THREE.LineSegments(new THREE.EdgesGeometry(arrow.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
  arrowEdge.renderOrder = 12; arrow.add(arrowEdge); marker.add(arrow);
  let kind: Marker = 'none';
  if (opts.label !== false) {
    const label = labelSprite(`${info.numero} ${info.apelido}`);
    label.position.y = 2.3 * hScale; root.add(label);
  }

  // ---- animação (máquina de estados no estilo do ecctrl)
  const mixer = new THREE.AnimationMixer(model);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const [n, c] of Object.entries(rig.clips)) actions[n] = mixer.clipAction(c);
  let curName = '';
  const ONCE = new Set(['Jump_Start', 'Jump_Land', 'Death01']);
  const play = (name: string, fade = 0.2, timeScale = 1) => {
    const next = actions[name];
    if (!next) return;
    if (name === curName) { next.timeScale = timeScale; return; }
    const prev = actions[curName];
    next.enabled = true;
    next.timeScale = timeScale;
    if (ONCE.has(name)) { next.reset().setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; } else next.reset().setLoop(THREE.LoopRepeat, Infinity);
    if (prev) next.crossFadeFrom(prev, fade, false);
    next.play();
    curName = name;
  };
  play('Idle_Loop', 0);

  // sobreposição de ossos: rotação Δ (eixos do atleta: x = esquerda, y = cima, z = frente), relativa à pose de referência do osso pai
  const qd = new THREE.Quaternion(), qa = new THREE.Quaternion(), qi = new THREE.Quaternion(), qid = new THREE.Quaternion();
  const absolute = (bone: string, x: number, y: number, z: number, w: number) => {
    if (w < 0.002) return;
    const p = PARENT[bone];
    qd.setFromEuler(eul.set(x, y, z, 'XYZ'));
    qa.copy(rig.refW[p]).invert().multiply(qd).multiply(rig.refW[p]).multiply(rig.refL[bone]);
    bones[bone].quaternion.slerp(qa, Math.min(1, w));
  };
  const additive = (bone: string, x: number, y: number, z: number, w = 1) => {
    if (Math.abs(x) + Math.abs(y) + Math.abs(z) < 1e-4) return;
    const p = PARENT[bone];
    qd.setFromEuler(eul.set(x, y, z, 'XYZ'));
    qa.copy(rig.refW[p]).invert().multiply(qd).multiply(rig.refW[p]);
    qi.copy(qid.identity()).slerp(qa, w);
    bones[bone].quaternion.premultiply(qi);
  };

  const J: Record<string, number> = {};
  const sm = (k: string, target: number, rate: number, dt: number) => {
    if (J[k] === undefined) J[k] = target;
    J[k] += (target - J[k]) * (1 - Math.exp(-rate * dt));
    return J[k];
  };
  let yaw = 0, airT = 0, landT = 0, prevY = 0, fallT = 0;
  let initYaw = true;

  const api: AthleteModel = {
    root, height: 1.83 * hScale,
    setMarker(k) {
      kind = k; marker.visible = k !== 'none';
      arrow.visible = k === 'active'; ringOut.visible = k === 'active'; ringMat.opacity = k === 'active' ? 0.95 : 0.4;
    },
    pose(p: AthletePose) {
      const dt = Math.min(0.05, Math.max(0.001, p.dt));
      const f = p.flags;
      const vf = p.vf ?? p.speed, vl = p.vl ?? 0;
      const ball = !!(f & F.BALL), shoot = !!(f & F.SHOOT), dunk = !!(f & F.DUNK), air = !!(f & F.JUMP);
      const layup = shoot && !!(f & F.LAYUP);
      const fallen = !!(f & F.FALLEN), contest = !!(f & F.CONTEST);
      const def = !!p.defending && !ball;
      const speed = p.speed;
      const moving = speed > 0.35;

      if (kind !== 'none') {
        const pulse = 1 + Math.sin(p.t * 6) * 0.05;
        if (kind === 'active') { marker.scale.setScalar(pulse * 1.05); arrow.position.y = 2.6 * hScale + Math.sin(p.t * 5) * 0.08; } else marker.scale.setScalar(0.85);
      }

      // ---------- direção do corpo: anda de frente; em deslize/ré o corpo vira para o movimento e o tronco compensa
      const phi = moving ? Math.atan2(vl, vf) : 0;
      const sideways = moving && (Math.abs(phi) > 0.7);
      const act = shoot || dunk || fallen;
      const targetYaw = act || !sideways ? p.rot : p.rot + phi;
      if (initYaw) { yaw = targetYaw; initYaw = false; }
      yaw += wrapPi(targetYaw - yaw) * (1 - Math.exp(-16 * dt));
      body.rotation.y = yaw + (f & F.SPIN ? p.anim * Math.PI * 2 : 0);
      const twist = Math.max(-1.35, Math.min(1.35, wrapPi(p.rot - yaw))); // quanto o tronco precisa girar para continuar olhando para o jogo

      // ---------- estado -> clipe (statusToActionMap)
      if (air) airT += dt; else airT = 0;
      if (prevY > 0.12 && p.y <= 0.02 && !shoot && !dunk) landT = 0.28;
      prevY = p.y;
      landT = Math.max(0, landT - dt);
      let want = 'Idle_Loop', ts = 1, fade = 0.22;
      if (fallen) { want = 'Death01'; ts = 2.6; fade = 0.08; fallT = 0.5; }
      else if (air && !shoot && !dunk) { want = airT < 0.14 ? 'Jump_Start' : 'Jump_Loop'; ts = want === 'Jump_Start' ? 2.2 : 1; fade = 0.08; }
      else if (landT > 0) { want = 'Jump_Land'; ts = 2.8; fade = 0.06; }
      else if (shoot || dunk) { want = 'Idle_Loop'; fade = 0.1; }
      else if (def && moving && speed < 3.6) { want = 'Crouch_Fwd_Loop'; ts = Math.max(0.6, speed / 2.2); }
      else if (def && !moving) { want = 'Crouch_Idle_Loop'; ts = 1; }
      else if (moving) {
        if (speed < 2.4) { want = 'Walk_Loop'; ts = Math.max(0.5, speed / 1.45); }
        else if (speed < 4.9) { want = 'Jog_Fwd_Loop'; ts = speed / 3.7; }
        else { want = 'Sprint_Loop'; ts = speed / 6.0; }
        if (sideways && Math.abs(phi) > 2.2) ts *= 0.85; // de costas é mais lento
      }
      if (fallT > 0 && !fallen) { fallT -= dt; if (fallT <= 0.2) fade = 0.35; }
      play(want, fade, ts);
      mixer.update(dt);

      // ---------- sobreposições de basquete (valores relativos à pose "pendurada")
      // os clipes de agachado são fundos; sobe o quadril para uma base de defesa de basquete
      const crouchBase = def && !air && !fallen && (curName === 'Crouch_Idle_Loop' || curName === 'Crouch_Fwd_Loop') ? 0.1 : 0;
      let hipDy = crouchBase, lean = 0, headX = 0;
      // alvos: [ombro x, ombro z, cotovelo x] por braço; pernas
      let shLx = 0, shLz = 0.1, elL = -0.2, shRx = 0, shRz = -0.1, elR = -0.2, wrR = 0, wrL = 0;
      let thLx = 0, thRx = 0, thLz = 0.05, thRz = -0.05, knL = 0.05, knR = 0.05, anL = 0, anR = 0;
      let wArms = 0, wLegs = 0, spY = 0, chY = 0;

      if (def && !fallen && !air) { // braços abertos, baixos
        wArms = moving ? 0.55 : 0.8; shLx = shRx = -0.55; shLz = 0.95; shRz = -0.95; elL = elR = -0.55; headX = -0.15; lean = 0.08;
      }
      if (!def && !ball && !fallen && !air && !shoot && !dunk && !moving) { // pronto para receber: mãos à frente
        wArms = 0.55; shLx = shRx = -0.85; elL = elR = -1.0; shLz = 0.3; shRz = -0.3;
      }
      if (ball && !shoot && !dunk && !fallen) { // quicando com a mão direita; esquerda protege
        const b = Math.sin(p.t * Math.PI * 3.2), hand = Math.max(0, b);
        wArms = 1; shRx = -0.45 - hand * 0.45; elR = -(0.55 + (1 - hand) * 0.25 + hand * 0.4); shRz = -0.28; wrR = -0.2 + hand * 0.5;
        shLx = -0.95; elL = -1.05; shLz = 0.45; lean = 0.14; headX = -0.08;
        if (f & F.CROSS) { shRx = -0.9; shRz = 0.15 + Math.sin(p.anim * Math.PI) * 0.5; spY = (p.anim - 0.5) * -0.8; }
        if (!moving) hipDy = -0.05;
      }
      if (contest && !air && !shoot && !fallen) { // braço bem alto, outro aberto
        wArms = 1; shRx = -3.1; elR = -0.05; shRz = -0.12; shLx = -0.7; shLz = 1.0; elL = -0.3; lean = Math.max(lean, 0.18);
      }
      if (air && !shoot && !dunk && !fallen) { // pulo (rebote/toco): braços para cima
        wArms = 1; shLx = shRx = -3.0; elL = elR = -0.12; shLz = 0.25; shRz = -0.25; headX = -0.25;
      }
      if (shoot && layup) { // bandeja
        const t = Math.max(0, p.shotT);
        const gather = ease(seg(t, 0, 0.16)), rise = ease(seg(t, 0.12, 0.55));
        wArms = wLegs = 1; hipDy = -0.1 * gather * (1 - rise); lean = 0.18 - 0.08 * rise;
        thRx = -1.45 * rise - 0.3 * gather * (1 - rise); knR = 1.7 * rise + 0.5 * gather * (1 - rise); anR = 0.4 * rise;
        thLx = 0.35 * rise - 0.2 * gather * (1 - rise); knL = 0.15 + 0.5 * gather * (1 - rise); anL = 0.7 * rise; thLz = 0.06; thRz = -0.06;
        shRx = -0.9 - 2.2 * rise; elR = -1.5 + 1.4 * rise; shRz = -0.08; wrR = rise * 0.5 + (f & F.REL ? 0.7 : 0);
        shLx = -1.0 - 0.4 * rise; shLz = 0.75; elL = -0.85; headX = -0.15 - 0.35 * rise; spY = 0.12 * rise; chY = -0.1 * rise;
      } else if (shoot) { // arremesso: carga -> subida -> extensão -> follow-through
        const t = Math.max(0, p.shotT);
        const load = ease(seg(t, 0, 0.2)), rise = ease(seg(t, 0.2, 0.55));
        const follow = f & F.REL ? 1 : ease(seg(t, 0.55, 0.75));
        wArms = wLegs = 1; hipDy = -0.15 * load * (1 - rise); lean = 0.1 - 0.13 * rise;
        knL = knR = 0.95 * load * (1 - rise) + 0.08; thLx = thRx = -0.55 * load * (1 - rise); thLz = 0.09; thRz = -0.09; anL = anR = 0.65 * rise;
        shRx = lerp3(-0.95, -2.35, -2.95, load, rise); elR = lerp3(-1.6, -1.95, -0.15, load, rise); shRz = -0.1; wrR = lerp3(-0.2, -0.9, -0.6, load, rise) + follow * 1.9;
        shLx = lerp3(-0.85, -2.2, -2.45, load, rise); elL = lerp3(-1.3, -1.55, -0.95, load, rise); shLz = 0.32 + rise * 0.1; wrL = -0.4;
        headX = -0.1 - 0.28 * rise; spY = -0.1 * load; chY = 0.15 * load;
      }
      if (dunk) { // enterrada
        const u = p.anim;
        const load = ease(seg(u, 0, 0.16)), rise = ease(seg(u, 0.16, 0.6)), slam = ease(seg(u, 0.6, 0.78)), hang = ease(seg(u, 0.78, 1));
        wArms = wLegs = 1; hipDy = -0.18 * load * (1 - rise);
        thLx = -0.9 * rise - 0.5 * load * (1 - rise); thRx = -0.3 * rise; knL = 1.2 * rise + 0.5 * load * (1 - rise); knR = 0.7 * rise + 0.5 * load * (1 - rise);
        thLz = 0.1; thRz = -0.1; anL = anR = 0.5 * rise; lean = 0.12 - 0.22 * rise + 0.1 * slam;
        shRx = (-3.35 * rise - 0.55 * (1 - rise)) + slam * 1.15 - hang * 0.3; elR = -(1.5 * (1 - rise) + 0.2 + slam * 0.7) + hang * 0.4; shRz = -0.18;
        shLx = -2.3 * rise - 0.9 * (1 - rise); shLz = 0.55 + 0.4 * rise; elL = -0.5; headX = -0.3 * rise;
        if (hang > 0) { knL = 0.6; knR = 0.5; thLx = -0.15; thRx = -0.1; }
      }
      if (fallen) wArms = wLegs = 0;

      // suaviza pesos e alvos (as transições entre ações ficam fluidas)
      const r = shoot || dunk ? 28 : 16;
      const wa = sm('wA', wArms, 14, dt), wl = sm('wL', wLegs, 14, dt);
      const v = (k: string, t: number, rate = r) => sm(k, t, rate, dt);
      // pernas
      absolute(B.thL, v('tLx', thLx), 0, v('tLz', thLz), wl); absolute(B.thR, v('tRx', thRx), 0, v('tRz', thRz), wl);
      absolute(B.snL, v('kL', knL), 0, 0, wl); absolute(B.snR, v('kR', knR), 0, 0, wl);
      absolute(B.ftL, v('aL', anL * 0.5 - 0.2 * knL), 0, 0, wl); absolute(B.ftR, v('aR', anR * 0.5 - 0.2 * knR), 0, 0, wl);
      // braços
      absolute(B.uaL, v('sLx', shLx), 0, v('sLz', shLz), wa); absolute(B.uaR, v('sRx', shRx), 0, v('sRz', shRz), wa);
      absolute(B.faL, v('eL', elL), 0, 0, wa); absolute(B.faR, v('eR', elR), 0, 0, wa);
      absolute(B.haL, v('wL2', wrL), 0, 0, wa); absolute(B.haR, v('wR', wrR), 0, 0, wa);
      // tronco e cabeça (aditivos sobre o clipe)
      const lv = v('lean', lean), tw = v('twist', twist * 0.9, 20);
      const sy = v('spY', spY), cy = v('chY', chY);
      additive(B.sp1, lv * 0.3, sy * 0.5 + tw * 0.25, 0); additive(B.sp2, lv * 0.35, sy * 0.5 + tw * 0.3, 0); additive(B.sp3, lv * 0.35, cy + tw * 0.35, 0);
      additive(B.neck, v('hdX', headX) * 0.5, tw * 0.1, 0); additive(B.head, v('hdX2', headX) * 0.5, tw * 0.1, 0);
      // altura do quadril (agachar / carga do arremesso)
      bones[B.hips].position.y += v('hip', hipDy, 20);

      root.position.y = p.y;
      shadow.position.y = 0.02 - p.y;
      shadow.scale.setScalar(1 - Math.min(0.5, p.y * 0.6));
    },
    dispose() {
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && !(o as THREE.SkinnedMesh).isSkinnedMesh) m.geometry.dispose(); });
      tex.dispose(); mixer.stopAllAction(); mixer.uncacheRoot(model);
    },
  };
  return api;
}
