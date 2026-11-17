// Pré-visualizações 3D do atleta: retratos (cartas) e visualização giratória (admin).
import * as THREE from 'three';
import type { AthleteInfo } from '../../shared/types';
import { buildAthlete } from './athlete';

function lights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.0));
  const d = new THREE.DirectionalLight(0xffffff, 1.4);
  d.position.set(2, 4, 4);
  scene.add(d);
}

const portraitCache = new Map<string, string>();
let pr: THREE.WebGLRenderer | null = null;

/** Retrato em dataURL (um renderer compartilhado, evita vários contextos WebGL). */
export function portrait(info: AthleteInfo, color = 0xe8631a, size = 220, framing: 'body' | 'head' | 'top' | 'bottom' | 'shoes' = 'body'): string {
  const key = JSON.stringify([info.corPele, info.estiloCabelo, info.corCabelo, info.altura, info.numero, info.roupaTop, info.roupaBottom, info.calcado, color, size, framing]);
  const hit = portraitCache.get(key);
  if (hit) return hit;
  if (!pr) {
    const c = document.createElement('canvas');
    pr = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
    pr.outputColorSpace = THREE.SRGBColorSpace;
  }
  pr.setSize(size, size, false);
  pr.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  lights(scene);
  const m = buildAthlete(info, color, { label: false });
  m.root.rotation.y = framing === 'head' ? 0.55 : framing === 'shoes' ? 0.7 : framing === 'bottom' ? 0.45 : 0.35;
  m.pose({ speed: 0, flags: 0, shotT: -1, anim: 0, y: 0, rot: 0, dt: 0.016, t: 0 });
  scene.add(m.root);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const hs = m.height / 1.83;
  if (framing === 'head') { cam.position.set(0, 1.8 * hs, 0.95); cam.lookAt(0, 1.75 * hs, 0); }
  else if (framing === 'top') { cam.position.set(0, 1.3 * hs, 2.1); cam.lookAt(0, 1.22 * hs, 0); }
  else if (framing === 'bottom') { cam.position.set(0, 0.62 * hs, 2.7); cam.lookAt(0, 0.55 * hs, 0); }
  else if (framing === 'shoes') { cam.position.set(0, 0.2 * hs, 1.35); cam.lookAt(0, 0.1 * hs, 0); }
  else { cam.position.set(0, 1.42, 3.0); cam.lookAt(0, 1.25, 0); }
  pr.render(scene, cam);
  const url = pr.domElement.toDataURL('image/png');
  m.dispose();
  portraitCache.set(key, url);
  return url;
}

export class Preview3D {
  private r: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private model: ReturnType<typeof buildAthlete> | null = null;
  private raf = 0;
  private t = 0;
  private drag = false;
  private lastX = 0;
  private yaw = 0.5;
  private auto = true;
  /** estado de pose controlável (depuração e testes) */
  poseState = { speed: 0, flags: 0, shotT: -1, anim: 0, y: 0, vf: 0, vl: 0, defending: false };

  constructor(private canvas: HTMLCanvasElement) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    lights(this.scene);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40), new THREE.MeshBasicMaterial({ color: 0x0b121b, transparent: true, opacity: 0.5 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.cam.position.set(0, 1.35, 4.4);
    this.cam.lookAt(0, 0.95, 0);
    (window as unknown as { __pv?: Preview3D }).__pv = this;
    canvas.addEventListener('pointerdown', (e) => { this.drag = true; this.auto = false; this.lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointerup', () => { this.drag = false; });
    canvas.addEventListener('pointermove', (e) => { if (this.drag) { this.yaw += (e.clientX - this.lastX) * 0.012; this.lastX = e.clientX; } });
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * devicePixelRatio || canvas.height !== h * devicePixelRatio) {
        this.r.setPixelRatio(devicePixelRatio); this.r.setSize(w, h, false);
        this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
      }
      this.t += 0.016;
      if (this.auto) this.yaw += 0.012;
      if (this.model) {
        this.model.root.rotation.y = this.yaw;
        this.model.pose({ ...this.poseState, rot: 0, dt: 0.016, t: this.t });
      }
      this.r.render(this.scene, this.cam);
    };
    loop();
  }

  set(info: AthleteInfo, color = 0xe8631a) {
    if (this.model) { this.scene.remove(this.model.root); this.model.dispose(); }
    this.model = buildAthlete(info, color, { label: false });
    this.scene.add(this.model.root);
  }

  dispose() { cancelAnimationFrame(this.raf); this.r.dispose(); }
}

/** Atleta em destaque da página inicial: holofote dourado, anéis no chão, leve movimento. */
export class Hero3D {
  private r: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(24, 1, 0.1, 60);
  private model: ReturnType<typeof buildAthlete> | null = null;
  private raf = 0;
  private t = 0;
  private last = performance.now();

  constructor(private canvas: HTMLCanvasElement) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.add(new THREE.HemisphereLight(0xfff1d6, 0x1a1408, 0.55));
    const key = new THREE.SpotLight(0xffe6b8, 55, 16, 0.5, 0.7, 1.2);
    key.position.set(1.2, 5.5, 3.6); key.target.position.set(0, 0.9, 0);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key, key.target);
    const rimL = new THREE.DirectionalLight(0xffc766, 1.8); rimL.position.set(-3.5, 2.4, -3);
    const rimR = new THREE.DirectionalLight(0xffd98f, 1.1); rimR.position.set(3.5, 2, -3);
    this.scene.add(rimL, rimR);
    // anéis dourados no chão
    for (const [r0, o] of [[0.75, 0.9], [1.1, 0.5], [1.55, 0.28]] as [number, number][]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 0.012, 96), new THREE.MeshBasicMaterial({ color: 0xe0b358, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004; this.scene.add(ring);
    }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), new THREE.ShadowMaterial({ opacity: 0.5 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    this.cam.position.set(0.15, 1.0, 5.0);
    this.cam.lookAt(0, 0.88, 0);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now; this.t += dt;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const dpr = Math.min(devicePixelRatio, 2);
      if (w && h && (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr))) {
        this.r.setPixelRatio(dpr); this.r.setSize(w, h, false);
        this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
      }
      if (this.model) {
        const yaw = -0.35 + Math.sin(this.t * 0.5) * 0.35;
        this.model.pose({ speed: 0, flags: 0, shotT: -1, anim: 0, y: 0, rot: yaw, dt, t: this.t, vf: 0, vl: 0, defending: false });
      }
      this.r.render(this.scene, this.cam);
    };
    loop();
  }

  set(info: AthleteInfo, color = 0xe8631a) {
    if (this.model) { this.scene.remove(this.model.root); this.model.dispose(); }
    this.model = buildAthlete(info, color, { label: false });
    this.scene.add(this.model.root);
  }

  dispose() { cancelAnimationFrame(this.raf); this.r.dispose(); }
}
