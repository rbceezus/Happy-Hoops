// Pré-visualizações 3D do atleta: retratos (cartas) e visualização giratória (admin).
import * as THREE from 'three';
import { F } from '../../shared/types';
import type { AthleteInfo } from '../../shared/types';
import { buildAthlete } from './athlete';
import { ballTexture } from './scene';

function lights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.0));
  const d = new THREE.DirectionalLight(0xffffff, 1.4);
  d.position.set(2, 4, 4);
  scene.add(d);
}

const portraitCache = new Map<string, string>();
let pr: THREE.WebGLRenderer | null = null;

/** Retrato em dataURL (um renderer compartilhado, evita vários contextos WebGL). */
export function portrait(info: AthleteInfo, color = 0xe8631a, size = 220, framing: 'body' | 'head' = 'body'): string {
  const key = JSON.stringify([info.corPele, info.estiloCabelo, info.corCabelo, info.altura, info.numero, color, size, framing]);
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
  m.root.rotation.y = framing === 'head' ? 0.55 : 0.35;
  m.pose({ speed: 0, flags: 0, shotT: -1, anim: 0, y: 0, rot: 0, dt: 0.016, t: 0 });
  scene.add(m.root);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const hs = m.height / 1.83;
  if (framing === 'head') { cam.position.set(0, 1.8 * hs, 0.95); cam.lookAt(0, 1.75 * hs, 0); }
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

  constructor(private canvas: HTMLCanvasElement) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    lights(this.scene);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40), new THREE.MeshBasicMaterial({ color: 0x0b121b, transparent: true, opacity: 0.5 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.cam.position.set(0, 1.35, 4.4);
    this.cam.lookAt(0, 0.95, 0);
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
        this.model.pose({ speed: 0, flags: 0, shotT: -1, anim: 0, y: 0, rot: 0, dt: 0.016, t: this.t });
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

/** Atleta em destaque da página inicial: holofote, quicando a bola, fundo transparente. */
export class Hero3D {
  private r: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
  private model: ReturnType<typeof buildAthlete> | null = null;
  private ball: THREE.Mesh;
  private raf = 0;
  private t = 0;
  private last = performance.now();
  private yaw = -0.3;
  private scale = 1;
  private crossT = -1;

  constructor(private canvas: HTMLCanvasElement) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x221a10, 0.18));
    const spot = new THREE.SpotLight(0xfff3dc, 45, 14, 0.38, 0.7, 1.2);
    spot.position.set(0.3, 6.5, 1.6);
    spot.target.position.set(0, 0.9, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    this.scene.add(spot, spot.target);
    const rim = new THREE.DirectionalLight(0xffd27a, 2.4);
    rim.position.set(-3, 2.5, -3.5);
    const rim2 = new THREE.DirectionalLight(0xffffff, 1.2);
    rim2.position.set(3.5, 2, -3);
    this.scene.add(rim2);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0x9fc6ff, 0.35);
    fill.position.set(3, 1.5, 3);
    this.scene.add(fill);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.55 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 18), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.55 }));
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.cam.position.set(0.4, 1.05, 7.4);
    this.cam.lookAt(0, 0.92, 0);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.t += dt;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w && h && (canvas.width !== Math.round(w * Math.min(devicePixelRatio, 2)) || canvas.height !== Math.round(h * Math.min(devicePixelRatio, 2)))) {
        this.r.setPixelRatio(Math.min(devicePixelRatio, 2)); this.r.setSize(w, h, false);
        this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
      }
      // crossover de tempos em tempos
      if (this.crossT < 0 && Math.sin(this.t * 0.9) > 0.995) this.crossT = 0;
      let flags = F.BALL, anim = 0;
      if (this.crossT >= 0) { this.crossT += dt; anim = this.crossT / 0.35; flags |= F.CROSS; if (anim >= 1) this.crossT = -1; }
      if (this.model) {
        this.model.pose({ speed: 0, flags, shotT: -1, anim, y: 0, rot: this.yaw, dt, t: this.t, vf: 0, vl: 0, defending: false });
        const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), sx = Math.cos(this.yaw), sz = -Math.sin(this.yaw);
        const side = flags & F.CROSS ? 0.3 * Math.cos(anim * Math.PI) : 0.3;
        this.ball.position.set(fx * 0.36 + sx * side, 0.13 + Math.abs(Math.sin(this.t * Math.PI * 3.2)) * 0.82 * this.scale, fz * 0.36 + sz * side);
        this.ball.rotation.x += dt * 6;
      }
      this.r.render(this.scene, this.cam);
    };
    loop();
  }

  set(info: AthleteInfo, color = 0xe8631a) {
    if (this.model) { this.scene.remove(this.model.root); this.model.dispose(); }
    this.model = buildAthlete(info, color, { label: false });
    this.scale = this.model.height / 1.83;
    this.scene.add(this.model.root);
  }

  dispose() { cancelAnimationFrame(this.raf); this.r.dispose(); }
}
