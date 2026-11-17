// Mede oscilação da direção (rot) dos atletas na simulação: giros grandes por tick e trocas rápidas de sentido.
import { Bot } from '../shared/bot';
import { DEMO_ATHLETES } from '../shared/demo';
import { Game } from '../shared/sim';
const g = new Game([[DEMO_ATHLETES[0], DEMO_ATHLETES[1]], [DEMO_ATHLETES[2], DEMO_ATHLETES[3]]], { seed: 3 });
const bots = [new Bot(0, 0.5), new Bot(1, 0.5)];
const last = g.ath.map((a) => a.rot), lastD = [0, 0, 0, 0];
let big = 0, flips = 0, ticks = 0;
for (let i = 0; i < 60 * 120 && g.phase !== 'over'; i++) {
  g.setInput(0, bots[0].frame(g)); g.setInput(1, bots[1].frame(g)); g.step();
  if (g.phase !== 'live') { g.ath.forEach((a, k) => { last[k] = a.rot; lastD[k] = 0; }); continue; }
  ticks++;
  g.ath.forEach((a, k) => {
    if (a.dash?.kind === 'spin') { last[k] = a.rot; return; }
    let d = a.rot - last[k]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) > 0.3) big++;
    if (Math.abs(d) > 0.05 && Math.abs(lastD[k]) > 0.05 && Math.sign(d) !== Math.sign(lastD[k])) flips++;
    lastD[k] = d; last[k] = a.rot;
  });
}
console.log({ ticks, giros_grandes_por_tick: big, trocas_de_sentido: flips, por_atleta_por_segundo: +(flips / 4 / (ticks / 60)).toFixed(2) });
