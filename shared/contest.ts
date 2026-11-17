// Nível de contestação (0..1): quanto os defensores atrapalham um arremesso/enterrada.
import { BAL } from './balance';
import { HOOP, clamp, dist } from './court';

export interface Contester {
  x: number; z: number;
  contesting: boolean; // mão levantada
  airborne: boolean;
  fallen: boolean;
  def: number; // atributo de defesa (25..99)
}

export function contestLevel(sx: number, sz: number, defs: Contester[]): number {
  const S = BAL.shot;
  const hx = HOOP.x - sx, hz = HOOP.z - sz;
  const hl = Math.hypot(hx, hz) || 1;
  let free = 1;
  for (const d of defs) {
    if (d.fallen) continue;
    const dd = dist(sx, sz, d.x, d.z);
    if (dd > S.contestRange) continue;
    const fd = clamp(1 - Math.max(0, dd - 0.7) / (S.contestRange - 0.7), 0, 1);
    const dl = dd || 1;
    const front = (hx / hl) * ((d.x - sx) / dl) + (hz / hl) * ((d.z - sz) / dl) > 0.2 ? 1 : S.behindFactor;
    // pulando > mão alta (botão) > perto (automático) > longe
    const hand = d.airborne ? 1.2 : d.contesting ? 1.12 : dd <= S.autoRange ? 1 : S.handsDownFactor;
    const skill = S.defBase + (1 - S.defBase) * clamp((d.def - 25) / 74, 0, 1);
    free *= 1 - clamp(S.contestMax * skill * fd * front * hand, 0, 0.95);
  }
  return 1 - free;
}
