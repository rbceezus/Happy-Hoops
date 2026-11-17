// Sonda de qualidade de animação no navegador (precisa de playwright e do servidor em http://localhost:3000, admin123).
// Mede, com o atleta REAL vestido: (1) deslize do pé de apoio por velocidade; (2) estalos de pose entre quadros em transições.
const { chromium } = require('playwright');
const F = { BALL: 1, SHOOT: 2, JUMP: 4, CONTEST: 8, FALLEN: 16, SPIN: 128, CROSS: 256, DUNK: 1024, REL: 2048, LAYUP: 4096 };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  await p.goto(process.env.URL || 'http://localhost:3000/admin');
  await p.fill('#pw', process.env.PW || 'admin123'); await p.click('button[type=submit]');
  await p.waitForSelector('.li'); await p.locator('.li').nth(0).click(); await p.waitForTimeout(1500);
  const out = await p.evaluate((F) => {
    const pv = window.__pv; pv.paused = true; pv.auto = false; pv.yaw = 0; pv.rig.root.rotation.y = 0; pv.rig.root.updateMatrixWorld(true);
    const m = pv.rig; const root = m.root;
    const bones = {}; root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    const names = Object.keys(bones);
    const V3 = bones[names[0]].position.constructor, Q = bones[names[0]].quaternion.constructor;
    const wp = (n) => bones[n].getWorldPosition(new V3());
    const dt = 1 / 60;
    const base = { speed: 0, flags: 0, shotT: -1, anim: 0, y: 0, rot: 0, dt, t: 0, vf: 0, vl: 0, defending: false };
    const quats = () => Object.fromEntries(names.map((n) => [n, bones[n].quaternion.clone()]));
    const angle = (a, b2) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b2))));
    const res = { slip: [], pops: [] };
    // ---- (1) deslize do pé: o atleta anda em velocidade constante; a cada apoio (dedo do pé < 4 cm do chão) mede-se
    //          quantos centímetros o pé escorrega no chão entre tocar e sair. 0 = grudado.
    for (const v of [1, 2, 3, 4.1, 5.5, 6.8]) {
      root.position.set(0, 0, 0); let t = 0; const slides = [];
      const st = { L: null, R: null };
      for (let i = 0; i < 360; i++) {
        t += dt; m.pose({ ...base, speed: v, vf: v, t });
        root.position.z += v * dt; root.updateMatrixWorld(true);
        if (i < 120) continue;
        for (const side of ['L', 'R']) {
          const toe = wp('DEF-toe' + side), ft = wp('DEF-foot' + side);
          const down = Math.min(toe.y, ft.y - 0.08) < 0.03;
          if (down) { if (!st[side]) st[side] = { z0: toe.z, z1: toe.z }; else st[side].z1 = toe.z; }
          else if (st[side]) { slides.push(Math.abs(st[side].z1 - st[side].z0)); st[side] = null; }
        }
      }
      const mean = slides.reduce((a, x) => a + x, 0) / Math.max(1, slides.length);
      res.slip.push({ v_m_s: v, apoios: slides.length, escorrega_cm_por_passo: +(mean * 100).toFixed(0), max_cm: +(Math.max(0, ...slides) * 100).toFixed(0) });
    }
    // ---- (2) estalos: maior rotação de osso entre dois quadros durante cada cenário
    const scen = {
      '(base) sprint constante 6.8 m/s': () => ({ speed: 6.8, vf: 6.8 }),
      '(base) jog constante 4.1 m/s': () => ({ speed: 4.1, vf: 4.1 }),
      '(base) andar constante 1.2 m/s': () => ({ speed: 1.2, vf: 1.2 }),
      'parado->andar->correr->sprint->parar': (i) => { const sp = i < 30 ? 0 : i < 90 ? 1.2 : i < 150 ? 4.1 : i < 210 ? 6.8 : 0; return { speed: sp, vf: sp }; },
      'oscilando 2.2..2.8 m/s (limite walk/jog)': (i) => { const sp = 2.5 + 0.3 * Math.sin(i * 0.4); return { speed: sp, vf: sp }; },
      'defesa: parado->desliza->para': (i) => { const sp = i < 40 ? 0 : i < 120 ? 3 : 0; return { defending: true, speed: sp, vf: 0, vl: sp }; },
      'arremesso completo': (i) => ({ flags: i < 36 ? (F.SHOOT | F.BALL) : i < 70 ? (F.SHOOT | F.REL) : 0, shotT: i / 60, y: Math.max(0, 0.45 * (1 - (((i / 60) - 0.55) / 0.55) ** 2)) }),
      'bandeja': (i) => ({ flags: i < 70 ? (F.SHOOT | F.LAYUP | F.BALL) : 0, shotT: i / 60, y: Math.max(0, 0.6 * (1 - (((i / 60) - 0.55) / 0.55) ** 2)) }),
      'enterrada': (i) => ({ flags: i < 41 ? (F.DUNK | F.BALL) : 0, anim: i / 41, y: Math.max(0, 1.0 * (1 - (((i / 41) - 0.55) / 0.55) ** 2)) }),
      'pulo (rebote/toco)': (i) => ({ flags: i > 20 && i < 70 ? F.JUMP : 0, y: i > 20 && i < 70 ? Math.max(0, 0.7 * Math.sin(((i - 20) / 50) * Math.PI)) : 0 }),
      'drible + crossover': (i) => ({ flags: F.BALL | (i > 30 && i < 50 ? F.CROSS : 0), anim: (i - 30) / 20, speed: 3, vf: 3 }),
      'queda (ankle breaker) e levanta': (i) => ({ flags: i > 20 && i < 100 ? F.FALLEN : 0 }),
      'contestar': (i) => ({ defending: true, flags: i > 30 && i < 90 ? F.CONTEST : 0 }),
    };
    for (const [name, fn] of Object.entries(scen)) {
      // reinicia o estado interno com alguns quadros parados
      for (let i = 0; i < 30; i++) m.pose({ ...base, t: i * dt });
      root.position.set(0, 0, 0);
      let prev = null, worst = { deg: 0, bone: '', frame: 0 }; let t = 1;
      for (let i = 0; i < 240; i++) {
        t += dt; const st = fn(i);
        m.pose({ ...base, ...st, t }); root.updateMatrixWorld(true);
        const cur = quats();
        if (prev) for (const n of names) { if (/f_|thumb|toe/.test(n)) continue; const d = angle(prev[n], cur[n]) * 180 / Math.PI; if (d > worst.deg) worst = { deg: +d.toFixed(1), bone: n, frame: i }; }
        prev = cur;
      }
      res.pops.push({ cenario: name, maior_giro_osso_por_quadro_graus: worst.deg, osso: worst.bone, quadro: worst.frame });
    }
    return res;
  }, F);
  console.log('DESLIZE DO PÉ DE APOIO (0 = grudado no chão):'); console.table(out.slip);
  console.log('ESTALOS DE POSE (graus por quadro a 60 fps; > ~25 é visível como pulo):'); console.table(out.pops);
  await b.close();
})();
