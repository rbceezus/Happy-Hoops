// Geometria da meia quadra (metros). Cesta em (0, 3.05, 0). +z = em direção à câmera (meio da quadra).
export const HOOP = { x: 0, y: 3.05, z: 0 };
export const RIM_R = 0.2286;
export const RIM_TUBE = 0.012;
export const BALL_R = 0.12;
export const BOARD_Z = -0.38;
export const BOARD_HW = 0.9;
export const BOARD_Y0 = 2.9;
export const BOARD_Y1 = 3.95;

export const COURT = { xMin: -7.5, xMax: 7.5, zMin: -1.575, zMax: 12.4 };
export const ARC_R = 6.75;
export const CORNER_X = 6.6;
export const ARC_ZC = Math.sqrt(ARC_R * ARC_R - CORNER_X * CORNER_X);
export const KEY_HW = 2.45;
export const FT_Z = 4.225;
export const FT_R = 1.8;
export const CHECK_POS = { x: 0, z: 7.7 };
export const CLEAR_MARGIN = 0.15;

export const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** Está além da linha de 3? (para valer 2 pontos). */
export function isBeyondArc(x: number, z: number, margin = 0): boolean {
  if (z < ARC_ZC) return Math.abs(x) >= CORNER_X + margin;
  return Math.hypot(x, z) >= ARC_R + margin;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Atributo (25..99) -> 0..1 */
export const nrm = (a: number) => clamp((a - 25) / 74, 0, 1);
