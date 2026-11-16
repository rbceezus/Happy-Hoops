// Modo treino: roda a mesma simulação localmente contra um bot (também útil para testar sem 2 pessoas).
import { Bot } from '../../shared/bot';
import { BAL } from '../../shared/balance';
import { DEMO_ATHLETES } from '../../shared/demo';
import { Game } from '../../shared/sim';
import type { AthleteInfo, InputFrame, Snapshot } from '../../shared/types';
import type { Session } from './game-view';

export async function drawFour(): Promise<AthleteInfo[]> {
  let pool: AthleteInfo[] = [];
  try { const r = await fetch('/api/roster'); if (r.ok) pool = await r.json(); } catch { /* sem servidor */ }
  if (pool.length < 4) pool = [...pool, ...DEMO_ATHLETES.filter((d) => !pool.some((p) => p.id === d.id))];
  return pool.sort(() => Math.random() - 0.5).slice(0, 4);
}

export class TrainingSession implements Session {
  game: Game;
  private bot: Bot;
  private timer = 0;
  private last = performance.now();
  private acc = 0;
  private n = 0;
  onSnap: (s: Snapshot) => void = () => {};
  onOver: (winner: number) => void = () => {};
  private over = false;

  constructor(public teams: [AthleteInfo[], AthleteInfo[]], skill = 0.45) {
    this.game = new Game(teams, { firstPoss: 0 });
    this.bot = new Bot(1, skill);
    this.timer = window.setInterval(() => this.tick(), 8);
  }

  sendInput(f: InputFrame) { this.game.setInput(0, f); }
  rtt() { return 0; }

  private tick() {
    const now = performance.now();
    this.acc += Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    while (this.acc >= BAL.tick) {
      this.acc -= BAL.tick;
      this.game.setInput(1, this.bot.frame(this.game));
      this.game.step(BAL.tick);
      if (++this.n % 2 === 0) this.onSnap(this.game.snapshot());
      if (this.game.phase === 'over' && !this.over) {
        this.over = true;
        this.onSnap(this.game.snapshot());
        this.onOver(this.game.winner);
      }
    }
  }

  dispose() { window.clearInterval(this.timer); }
}
