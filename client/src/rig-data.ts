// Dados medidos do modelo (client/public/models/athlete-rig.glb) e a escolha de clipe por velocidade.
// Sem dependências de DOM/Three para poder ser testado em Node (tests/anim.test.ts).

/** Velocidade (m/s) com que o pé de apoio anda para trás em relação ao quadril em cada clipe (média nos quadros com o pé no chão),
 *  medida na própria animação. É a velocidade de corpo em que o pé fica "grudado" no chão a 1x. */
export const CLIP_SPEED = { Walk_Loop: 0.85, Jog_Fwd_Loop: 5.2, Sprint_Loop: 6.9 } as const;
export type LocoClip = keyof typeof CLIP_SPEED;

/** Limite de velocidade de reprodução por clipe; acima disso a cadência fica cômica e o resto vira passada mais longa. */
export const MAX_TS: Record<LocoClip, number> = { Walk_Loop: 2.2, Jog_Fwd_Loop: 1.4, Sprint_Loop: 1.3 };
export const MIN_TS = 0.5;
export const MAX_STRIDE_BOOST = 1.5;

export interface Loco { clip: 'Idle_Loop' | LocoClip; ts: number; stride: number }

/** Escolhe o clipe com histerese (evita alternar entre dois clipes quando a velocidade oscila no limite). */
export function locomotion(speed: number, prev: Loco['clip'] = 'Idle_Loop'): Loco {
  const inRange = (enter: number, leave: number, active: boolean) => (active ? speed > leave : speed > enter);
  let clip: Loco['clip'];
  if (!inRange(0.5, 0.3, prev !== 'Idle_Loop')) clip = 'Idle_Loop';
  else if (!inRange(2.6, 2.0, prev === 'Jog_Fwd_Loop' || prev === 'Sprint_Loop')) clip = 'Walk_Loop';
  else clip = inRange(6.3, 5.5, prev === 'Sprint_Loop') ? 'Sprint_Loop' : 'Jog_Fwd_Loop';
  if (clip === 'Idle_Loop') return { clip, ts: 1, stride: 1 };
  const want = speed / CLIP_SPEED[clip];
  const ts = Math.min(MAX_TS[clip], Math.max(MIN_TS, want));
  const stride = Math.min(MAX_STRIDE_BOOST, Math.max(1, want / ts)); // passada mais longa em vez de cadência maior
  return { clip, ts, stride };
}

/** Velocidade com que o pé de apoio desliza no chão (m/s) para uma dada escolha — 0 = pé grudado. */
export function footSlip(speed: number, l: Loco): number {
  if (l.clip === 'Idle_Loop') return speed;
  return Math.abs(speed - CLIP_SPEED[l.clip] * l.ts * l.stride);
}
