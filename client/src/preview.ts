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
export function portrait(info: AthleteInfo, color = 0xe8631a, size = 220): string {
  const key = JSON.stringify([info.corPele, info.estiloCabelo, info.corCabelo, info.altura, info.numero, color, size]);
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
  m.root.rotation.y = 0.35;
  m.pose({ speed: 0, flags: 0, shotT: -1, anim: 0, y: 0, rot: 0, dt: 0.016, t: 0 });
  scene.add(m.root);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(0, 1.42, 3.0);
  cam.lookAt(0, 1.25, 0);
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
