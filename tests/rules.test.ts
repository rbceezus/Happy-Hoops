import { describe, expect, it } from 'vitest';
import { BAL } from '../shared/balance';
import { DEMO_ATHLETES } from '../shared/demo';
import { Game } from '../shared/sim';
import { AthleteInfo, GameEvent } from '../shared/types';

const mk = (over: Partial<AthleteInfo['attrs']> = {}, i = 0): AthleteInfo => ({ ...DEMO_ATHLETES[i], attrs: { ...DEMO_ATHLETES[i].attrs, ...over } });
const teams = (a: AthleteInfo[] = [mk({}, 0), mk({}, 1)], b: AthleteInfo[] = [mk({}, 2), mk({}, 3)]): [AthleteInfo[], AthleteInfo[]] => [a, b];

function live(seed = 1, t = teams()) {
  const g = new Game(t, { seed, firstPoss: 0 });
  g.setInput(0, { mx: 0, mz: 0, run: false, contest: false, ev: [{ k: 'check' }] });
  g.step();
  expect(g.phase).toBe('live');
  return g;
}
const run = (g: Game, sec: number, stopOn?: (g: Game) => boolean) => {
  const evs: GameEvent[] = [];
  for (let i = 0; i < sec * 60; i++) { g.step(); evs.push(...g.drainEvents()); if (stopOn?.(g)) break; }
  return evs;
};
const idle = { mx: 0, mz: 0, run: false, contest: false, ev: [] };
const hold = (g: Game, ms: number) => {
  g.setInput(0, { ...idle, ev: [{ k: 'shootDown' }] });
  const evs: GameEvent[] = [];
  for (let i = 0; i < ms / (1000 * BAL.tick); i++) { g.step(); evs.push(...g.drainEvents()); }
  g.setInput(0, { ...idle, ev: [{ k: 'shootUp', hold: ms }] });
  g.step(); evs.push(...g.drainEvents());
  return evs;
};

describe('regras', () => {
  it('valor da cesta: dentro do arco = 1, fora = 2', () => {
    const inside = live(3);
    const h = inside.controlled(0);
    h.x = 0; h.z = 3.5;
    const e1 = hold(inside, 550);
    expect(e1.find((e) => e.e === 'shot')?.v).toBe(1);

    const outside = live(3);
    const o = outside.controlled(0);
    o.x = 0; o.z = 8.0;
    const e2 = hold(outside, 550);
    expect(e2.find((e) => e.e === 'shot')?.v).toBe(2);

    const corner = live(3);
    const c = corner.controlled(0);
    c.x = 6.9; c.z = 0.5;
    expect(hold(corner, 550).find((e) => e.e === 'shot')?.v).toBe(2);
    const inCorner = live(3);
    const ic = inCorner.controlled(0);
    ic.x = 6.2; ic.z = 0.5;
    expect(hold(inCorner, 550).find((e) => e.e === 'shot')?.v).toBe(1);
  });

  it('não arremessa sem limpar a bola; libera fora do arco', () => {
    const g = live(5);
    g.needsClear = true;
    const h = g.controlled(0);
    h.x = 0; h.z = 3;
    g.setInput(0, { ...idle, ev: [{ k: 'shootDown' }] });
    const evs = run(g, 0.1);
    expect(evs.some((e) => e.e === 'violation' && e.m === 'LIMPE A BOLA')).toBe(true);
    expect(h.shot).toBeNull();
    // anda para fora do arco: limpa
    h.x = 0; h.z = 7.2;
    run(g, 0.1);
    expect(g.needsClear).toBe(false);
    g.setInput(0, { ...idle, ev: [{ k: 'shootDown' }] });
    run(g, 0.05);
    expect(h.shot).not.toBeNull();
  });

  it('relógio de posse de 12s: estoura e a posse troca com novo check', () => {
    const g = live(7);
    const evs = run(g, 13);
    expect(evs.some((e) => e.e === 'violation' && e.m === 'RELÓGIO')).toBe(true);
    expect(g.phase).toBe('check');
    expect(g.poss).toBe(1);
  });

  it('passe leva o controle ao companheiro e a bola chega', () => {
    const g = live(9);
    const from = g.controlled(0);
    g.setInput(0, { ...idle, ev: [{ k: 'pass', kind: 'chest' }] });
    run(g, 1.5, (x) => x.ball.st === 'held' && x.ball.holder !== from.id);
    expect(g.ball.st).toBe('held');
    expect(g.ball.holder).toBe(from.slot === 0 ? 1 : 0);
    expect(g.ctl[0]).toBe(from.slot === 0 ? 1 : 0);
  });

  it('cesta: a posse fica com quem fez e o jogo termina em 5', () => {
    // atleta muito bom, janela perfeita, ninguém contesta (defensores longe)
    const g = new Game(teams([mk({ arremessoMedia: 99, arremesso3: 99, finishing: 99 }, 0), mk({}, 1)]), { seed: 11, firstPoss: 0 });
    g.setInput(0, { ...idle, ev: [{ k: 'check' }] }); g.step();
    for (const d of g.teamAth(1)) { d.x = -7; d.z = 11; }
    let made = 0;
    for (let n = 0; n < 40 && g.phase !== 'over'; n++) {
      if (g.phase === 'check') { g.setInput(g.poss, { ...idle, ev: [{ k: 'check' }] }); g.step(); }
      for (const d of g.teamAth(1)) { d.x = -7; d.z = 11; d.vx = d.vz = 0; }
      const c = g.controlled(0);
      if (g.hasBall(c)) { c.x = 0; c.z = 3.2; c.vx = c.vz = 0; }
      const before = g.score[0];
      if (g.hasBall(c) && c.readyAt <= g.t) hold(g, 550);
      run(g, 4, (x) => x.phase === 'score' || x.phase === 'over');
      if (g.score[0] > before) { made++; expect(g.poss).toBe(0); }
      run(g, 3, (x) => x.phase === 'live');
    }
    expect(g.phase).toBe('over');
    expect(g.score[0]).toBeGreaterThanOrEqual(5);
    expect(g.winner).toBe(0);
    expect(made).toBeGreaterThanOrEqual(3);
  });

  it('toco acontece com defensor alto bloqueador pulando na hora certa', () => {
    let blocks = 0, tries = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const g = new Game(teams([mk({}, 0), mk({}, 1)], [mk({ bloqueio: 99, defesa: 90 }, 1), mk({}, 3)]), { seed, firstPoss: 0 });
      g.setInput(0, { ...idle, ev: [{ k: 'check' }] }); g.step();
      const h = g.controlled(0); const d = g.teamAth(1)[h.slot];
      h.x = 0; h.z = 4.5; h.vx = h.vz = 0; d.x = 0; d.z = 3.7; d.vx = d.vz = 0;
      g.ctl[1] = d.slot;
      g.setInput(0, { ...idle, ev: [{ k: 'shootDown' }] });
      let jumped = false;
      const evs: GameEvent[] = [];
      for (let i = 0; i < 90; i++) {
        if (!jumped && h.shot && h.shot.t >= 0.16) { g.setInput(1, { ...idle, ev: [{ k: 'shootDown' }] }); jumped = true; }
        if (h.shot && !h.shot.released && h.shot.t * 1000 >= 550) g.setInput(0, { ...idle, ev: [{ k: 'shootUp', hold: 550 }] });
        g.step(); evs.push(...g.drainEvents());
      }
      tries++;
      if (evs.some((e) => e.e === 'block')) blocks++;
    }
    expect(blocks).toBeGreaterThan(5);
    expect(blocks).toBeLessThan(tries);
  });

  it('ankle breaker: drible alto contra defesa baixa derruba o marcador às vezes', () => {
    let ankles = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = new Game(teams([mk({ drible: 99 }, 2), mk({}, 1)], [mk({ defesa: 25 }, 1), mk({}, 3)]), { seed, firstPoss: 0 });
      g.setInput(0, { ...idle, ev: [{ k: 'check' }] }); g.step();
      const h = g.controlled(0); const d = g.teamAth(1)[h.slot];
      h.x = 0; h.z = 6; d.x = 0; d.z = 5.1;
      g.setInput(0, { ...idle, ev: [{ k: 'cross', dir: 1 }] });
      const evs = run(g, 0.3);
      if (evs.some((e) => e.e === 'ankle')) { ankles++; expect(d.fallT).toBeGreaterThan(0.5); }
    }
    expect(ankles).toBeGreaterThan(3);
  });

  it('rebote: errou, a bola é disputada e alguém pega; sem posse dupla', () => {
    let got = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const g = live(seed);
      const h = g.controlled(0);
      h.x = 0; h.z = 4.5;
      hold(g, 200); // muito cedo: erra
      run(g, 8, (x) => x.ball.st === 'held' || x.phase !== 'live');
      if (g.ball.st === 'held') got++;
    }
    expect(got).toBeGreaterThan(15);
  });

  it('timing perfeito (verde) sempre cai de chuá, de qualquer zona', () => {
    const spots: [number, number][] = [[0, 0.7], [1.5, 1.2], [-2, 3], [4, 4.5], [-4.5, 5.5], [0, 8], [-5, 7], [6.9, 0.6], [-6.9, 1.0], [3, 9.5]];
    let n = 0;
    for (let seed = 1; seed <= 12; seed++) for (const [x, z] of spots) {
      // atleta fraco de propósito: o verde precisa valer mesmo assim
      const g = new Game(teams([mk({ arremesso3: 25, arremessoMedia: 25, finishing: 25 }, 0), mk({}, 1)]), { seed, firstPoss: 0 });
      g.setInput(0, { ...idle, ev: [{ k: 'check' }] }); g.step();
      for (const d of g.teamAth(1)) { d.x = -7; d.z = 11; }
      const h = g.controlled(0);
      h.x = x; h.z = z; h.vx = h.vz = 0;
      const evs = hold(g, 550);
      evs.push(...run(g, 4, (q) => q.phase === 'score'));
      const shot = evs.find((e) => e.e === 'shot');
      expect(shot?.m, `seed ${seed} (${x},${z})`).toBe('green');
      expect(g.phase, `seed ${seed} (${x},${z}) deveria pontuar`).toBe('score');
      expect(evs.some((e) => e.e === 'swish' && e.v === 1), `chuá limpo em (${x},${z}) seed ${seed}`).toBe(true);
      expect(evs.some((e) => e.e === 'rim' || e.e === 'board')).toBe(false);
      n++;
    }
    expect(n).toBe(120);
  });

  it('enterrada: perto da cesta pontua (1 ponto), longe é recusada, precisa limpar a bola', () => {
    const big = mk({ finishing: 95 }, 1); // Pedrão, alto
    let made = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = new Game(teams([big, mk({}, 0)]), { seed, firstPoss: 0 });
      g.setInput(0, { ...idle, ev: [{ k: 'check' }] }); g.step();
      for (const d of g.teamAth(1)) { d.x = -7; d.z = 11; }
      const h = g.controlled(0);
      h.x = 1.5; h.z = 3.0;
      g.setInput(0, { ...idle, ev: [{ k: 'dunk' }] });
      const evs = run(g, 2.5, (q) => q.phase === 'score');
      expect(evs.some((e) => e.e === 'dunk')).toBe(true);
      if (g.phase === 'score') { made++; expect(g.score[0]).toBe(1); expect(evs.some((e) => e.e === 'swish')).toBe(false); }
    }
    expect(made).toBeGreaterThanOrEqual(17); // finishing alto + sem defesa quase sempre converte

    const far = live(2);
    far.controlled(0).x = 0; far.controlled(0).z = 8;
    far.setInput(0, { ...idle, ev: [{ k: 'dunk' }] });
    const e2 = run(far, 0.2);
    expect(e2.some((e) => e.e === 'violation' && e.m === 'LONGE')).toBe(true);
    expect(far.controlled(0).dunk).toBeNull();

    const nc = live(3);
    nc.needsClear = true;
    nc.controlled(0).x = 0; nc.controlled(0).z = 2;
    nc.setInput(0, { ...idle, ev: [{ k: 'dunk' }] });
    expect(run(nc, 0.1).some((e) => e.e === 'violation' && e.m === 'LIMPE A BOLA')).toBe(true);
  });

  it('defesa: contestação forte reduz bastante o acerto e encolhe a janela verde', () => {
    const rate = (defOn: boolean) => {
      let made = 0, n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const g = new Game(teams([mk({ arremessoMedia: 80 }, 0), mk({}, 1)], [mk({ defesa: 70, bloqueio: 30 }, 2), mk({}, 3)]), { seed, firstPoss: 0 });
        g.setInput(0, { ...idle, ev: [{ k: 'check' }] }); g.step();
        const h = g.controlled(0); const d = g.teamAth(1)[h.slot]; const d2 = g.teamAth(1)[1 - h.slot];
        h.x = 0; h.z = 5; h.vx = h.vz = 0; d2.x = -7; d2.z = 11;
        if (defOn) { d.x = 0; d.z = 4.0; d.contesting = true; } else { d.x = -7; d.z = 11; }
        d.vx = d.vz = 0;
        g.ctl[1] = d.slot;
        // 80ms atrasado: fora do verde estreito mas dentro do verde aberto
        g.setInput(0, { ...idle, ev: [{ k: 'shootDown' }] });
        for (let i = 0; i < 38; i++) { if (defOn) g.setInput(1, { ...idle, contest: true }); g.step(); }
        g.setInput(0, { ...idle, ev: [{ k: 'shootUp', hold: 630 }] });
        const evs = run(g, 5, (q) => q.phase === 'score' || (q.ball.st === 'held' && q.t > 0.5));
        n++; if (g.score[0] > 0) made++;
      }
      return made / n;
    };
    const open = rate(false), guarded = rate(true);
    console.log({ open, guarded });
    expect(open - guarded).toBeGreaterThan(0.3);
  });
});
