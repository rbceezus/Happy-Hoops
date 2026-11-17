// Qualidade da animação: (1) velocidade dos clipes medida direto no .glb, (2) pé não escorrega em nenhuma velocidade,
// (3) sem troca de clipe "tremendo" quando a velocidade oscila.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLIP_SPEED, MAX_TS, MIN_TS, footSlip, locomotion, type Loco } from '../client/src/rig-data';
import { BAL } from '../shared/balance';

async function loadGltf() {
  const buf = readFileSync('client/public/models/athlete-rig.glb');
  return new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((res, rej) =>
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '', res as never, rej));
}

/** Velocidade de apoio medida: velocidade (para trás, em relação ao quadril) do pé que está mais baixo, nos quadros com o pé no chão. */
async function measuredSpeed(name: string) {
  const gltf = await loadGltf();
  const S = THREE.PropertyBinding.sanitizeNodeName;
  const bones: Record<string, THREE.Object3D> = {};
  gltf.scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones[o.name] = o; });
  const clip = gltf.animations.find((a) => a.name === name)!;
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(clip).play();
  const N = 240, dt = clip.duration / N;
  const pos = (n: string) => bones[S(n)].getWorldPosition(new THREE.Vector3());
  const P: { zl: number; zr: number; yl: number; yr: number }[] = [];
  for (let i = 0; i < N; i++) {
    mixer.setTime(dt * i); gltf.scene.updateMatrixWorld(true);
    const h = pos('DEF-hips'), L = pos('DEF-foot.L'), R = pos('DEF-foot.R'), tl = pos('DEF-toe.L'), tr = pos('DEF-toe.R');
    P.push({ zl: L.z - h.z, zr: R.z - h.z, yl: Math.min(L.y, tl.y), yr: Math.min(R.y, tr.y) });
  }
  const vs: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = P[(i + 1) % N], b = P[(i - 1 + N) % N], c = P[i];
    const useL = c.yl < c.yr;
    if ((useL ? c.yl : c.yr) > 0.05) continue;
    vs.push(-((useL ? a.zl - b.zl : a.zr - b.zr) / (2 * dt)));
  }
  return vs.reduce((s, x) => s + x, 0) / vs.length;
}

describe('animação', () => {
  for (const name of Object.keys(CLIP_SPEED) as (keyof typeof CLIP_SPEED)[]) {
    it(`velocidade do clipe ${name} bate com a tabela (${CLIP_SPEED[name]} m/s)`, async () => {
      const v = await measuredSpeed(name);
      expect(v).toBeGreaterThan(CLIP_SPEED[name] * 0.8);
      expect(v).toBeLessThan(CLIP_SPEED[name] * 1.25);
    });
  }

  it('pé não escorrega: em toda velocidade do jogo o deslize do pé fica pequeno e a cadência razoável', () => {
    let prev: Loco = { clip: 'Idle_Loop', ts: 1, stride: 1 };
    const worst: [number, number][] = [];
    for (let v = 0.6; v <= BAL.move.run * 1.1; v += 0.1) {
      const l = locomotion(v, prev.clip);
      prev = l;
      const slip = footSlip(v, l);
      worst.push([v, slip]);
      expect(l.ts, `cadência em ${v.toFixed(1)} m/s`).toBeLessThanOrEqual(MAX_TS[l.clip as keyof typeof MAX_TS] + 1e-9);
      expect(l.ts).toBeGreaterThanOrEqual(MIN_TS - 1e-9);
      expect(slip / v, `deslize relativo em ${v.toFixed(1)} m/s`).toBeLessThan(0.25);
    }
    console.log('pior deslize:', worst.sort((a, b) => b[1] - a[1])[0]);
  });

  it('as velocidades do jogo (andar e correr) caem em clipes com bom casamento', () => {
    for (const v of [BAL.move.walk, BAL.move.run, BAL.move.walk * 1.18, BAL.move.run * 1.1]) {
      const l = locomotion(v, 'Jog_Fwd_Loop');
      expect(footSlip(v, l) / v).toBeLessThan(0.25);
    }
  });

  it('sem tremedeira: velocidade oscilando ±10% perto dos limites não alterna clipes', () => {
    for (const center of [0.4, 2.3, 5.85]) {
      let cur: Loco['clip'] = 'Idle_Loop';
      let switches = 0, seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 600; i++) {
        const v = center * (1 + (rnd() - 0.5) * 0.1);
        const next: Loco['clip'] = locomotion(v, cur).clip;
        if (next !== cur) switches++;
        cur = next;
      }
      expect(switches, `limite ${center}`).toBeLessThan(6);
    }
  });

  it('acelerando de 0 a correr e freando: sequência de clipes ordenada (idle→walk→jog→sprint→…→idle)', () => {
    const seq: string[] = [];
    let cur: Loco['clip'] = 'Idle_Loop';
    const speeds = [...Array(70).keys()].map((i) => i * 0.1).concat([...Array(70).keys()].map((i) => 6.9 - i * 0.1));
    for (const v of speeds) { const c: Loco['clip'] = locomotion(v, cur).clip; if (c !== seq[seq.length - 1]) seq.push(c); cur = c; }
    expect(seq).toEqual(['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jog_Fwd_Loop', 'Walk_Loop', 'Idle_Loop']);
  });
});
