import { Bot } from '../shared/bot';
import { DEMO_ATHLETES } from '../shared/demo';
import { Game } from '../shared/sim';
let mism = 0, total = 0, madeDec = 0, rimTouch = 0, swish = 0, air = 0, missTouched = 0, missTotal=0;
for (let s = 1; s < 80; s++) {
  const g = new Game([[DEMO_ATHLETES[0], DEMO_ATHLETES[1]], [DEMO_ATHLETES[2], DEMO_ATHLETES[3]]], { seed: s });
  const bots = [new Bot(0, 0.5), new Bot(1, 0.5)];
  let n = 0, cur: { made: boolean } | null = null;
  while (g.phase !== 'over' && n++ < 36000) {
    g.setInput(0, bots[0].frame(g)); g.setInput(1, bots[1].frame(g));
    const before = g.ball.st;
    g.step();
    const evs = g.events;
    if (evs.some((e) => e.e === 'shot')) { cur = { made: g.ball.made }; }
    if (cur && g.ball.st !== 'shot' && before === 'shot') {
      total++; if (cur.made) madeDec++;
      const scored = g.ball.scored;
      if (scored !== cur.made) mism++;
      if (!cur.made) { missTotal++; if (g.ball.touched) missTouched++; else air++; }
      if (scored && !g.ball.touched) swish++;
      cur = null;
    }
  }
}
console.log({ total, madeDec, mism, swish, air, missTotal, missTouched });
