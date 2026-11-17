import { describe, expect, it } from 'vitest';
import { Bot } from '../shared/bot';
import { DEMO_ATHLETES } from '../shared/demo';
import { Game } from '../shared/sim';

function teams(): [typeof DEMO_ATHLETES, typeof DEMO_ATHLETES] {
  return [[DEMO_ATHLETES[0], DEMO_ATHLETES[1]], [DEMO_ATHLETES[2], DEMO_ATHLETES[3]]];
}

function play(seed: number, maxSeconds = 600) {
  const g = new Game(teams(), { seed });
  const bots = [new Bot(0, 0.6), new Bot(1, 0.6)];
  let n = 0;
  const max = maxSeconds * 60;
  while (g.phase !== 'over' && n++ < max) {
    g.setInput(0, bots[0].frame(g));
    g.setInput(1, bots[1].frame(g));
    g.step();
  }
  return g;
}

describe('simulação', () => {
  it('bots terminam partidas até 5 pontos', () => {
    for (let s = 1; s <= 12; s++) {
      const g = play(s);
      expect(g.phase, `seed ${s} score ${g.score}`).toBe('over');
      expect(Math.max(...g.score)).toBeGreaterThanOrEqual(5);
      expect(g.winner).toBeGreaterThanOrEqual(0);
    }
  });

  it('estatísticas plausíveis', () => {
    let shots = 0, made = 0, blocks = 0, reb = 0, viol = 0;
    for (let s = 100; s < 120; s++) {
      const g = play(s);
      shots += g.stats.shots[0] + g.stats.shots[1];
      made += g.stats.made[0] + g.stats.made[1];
      blocks += g.stats.blocks[0] + g.stats.blocks[1];
      reb += g.stats.rebounds[0] + g.stats.rebounds[1];
      viol += g.stats.violations + g.stats.oob;
    }
    console.log({ shots, made, pct: (made / shots).toFixed(2), blocks, reb, viol });
    expect(made / shots).toBeGreaterThan(0.15);
    expect(made / shots).toBeLessThan(0.85);
  });
});
