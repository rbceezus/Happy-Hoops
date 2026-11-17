// Tipos compartilhados entre cliente e servidor.

export interface Attrs {
  arremesso3: number;
  arremessoMedia: number;
  finishing: number;
  passe: number;
  rebote: number;
  defesa: number;
  bloqueio: number;
  drible: number;
}

export const ATTR_KEYS: (keyof Attrs)[] = [
  'arremesso3', 'arremessoMedia', 'finishing', 'passe', 'rebote', 'defesa', 'bloqueio', 'drible',
];

export const ATTR_LABELS: Record<keyof Attrs, string> = {
  arremesso3: 'Arremesso de 3',
  arremessoMedia: 'Média distância',
  finishing: 'Finishing',
  passe: 'Passe',
  rebote: 'Rebote',
  defesa: 'Defesa',
  bloqueio: 'Bloqueio',
  drible: 'Drible',
};

export type Altura = 'P' | 'M' | 'G';
export type HairStyle = 'careca' | 'raspado' | 'curto' | 'cacheado' | 'black' | 'tranca' | 'dreads' | 'moicano' | 'coque' | 'rabo' | 'liso';
export const HAIR_STYLES: HairStyle[] = ['careca', 'raspado', 'curto', 'cacheado', 'black', 'tranca', 'dreads', 'moicano', 'coque', 'rabo', 'liso'];
export const HAIR_LABELS: Record<HairStyle, string> = {
  careca: 'Careca', raspado: 'Raspado', curto: 'Curto', cacheado: 'Cacheado', black: 'Black power', tranca: 'Tranças',
  dreads: 'Dreads', moicano: 'Moicano', coque: 'Coque', rabo: 'Rabo de cavalo', liso: 'Liso longo',
};

export type TopId = 'polo-preta' | 'tshirt-preta' | 'regata-preta';
export type BottomId = 'calca-preta' | 'jeans-cinza' | 'jeans-azul';
export type ShoesId = 'tenis-preto' | 'tenis-azul';
export const TOPS: TopId[] = ['polo-preta', 'tshirt-preta', 'regata-preta'];
export const BOTTOMS: BottomId[] = ['calca-preta', 'jeans-cinza', 'jeans-azul'];
export const SHOES: ShoesId[] = ['tenis-preto', 'tenis-azul'];
export const OUTFIT_LABELS: Record<TopId | BottomId | ShoesId, string> = {
  'polo-preta': 'Camiseta polo preta', 'tshirt-preta': 'T-shirt preta', 'regata-preta': 'Regata preta',
  'calca-preta': 'Calça preta', 'jeans-cinza': 'Jeans cinza', 'jeans-azul': 'Jeans azul',
  'tenis-preto': 'Tênis preto', 'tenis-azul': 'Tênis azul',
};
export const DEFAULT_OUTFIT = { roupaTop: 'regata-preta' as TopId, roupaBottom: 'calca-preta' as BottomId, calcado: 'tenis-preto' as ShoesId };

export interface AthleteInfo {
  id: number;
  nome: string;
  apelido: string;
  numero: number;
  sala: string;
  overall: number; // manual, só exibição
  altura: Altura;
  attrs: Attrs;
  corPele: string; // #rrggbb
  estiloCabelo: HairStyle;
  corCabelo: string;
  roupaTop: TopId;
  roupaBottom: BottomId;
  calcado: ShoesId;
  ativo: boolean;
}

export type Team = 0 | 1;

// ---- Entrada do jogador ----
export type InputEvent =
  | { k: 'shootDown' }
  | { k: 'shootUp'; hold: number } // hold em ms medido no cliente
  | { k: 'pass'; kind: 'chest' | 'bounce' }
  | { k: 'cross'; dir: -1 | 1 }
  | { k: 'spin' }
  | { k: 'switch' }
  | { k: 'dunk' }
  | { k: 'dunkUp'; hold: number }
  | { k: 'select'; slot: 0 | 1 }
  | { k: 'check' };

export interface InputFrame {
  mx: number; // -1..1 (A/D)  -> eixo x da tela
  mz: number; // -1..1 (W = -1 em direção à cesta)
  run: boolean;
  contest: boolean;
  ev: InputEvent[];
}

export const emptyInput = (): InputFrame => ({ mx: 0, mz: 0, run: false, contest: false, ev: [] });

// ---- Snapshot ----
export type Phase = 'check' | 'live' | 'score' | 'over';

export const F = {
  BALL: 1, SHOOT: 2, JUMP: 4, CONTEST: 8, FALLEN: 16, STUN: 32, RUN: 64, SPIN: 128, CROSS: 256, READY: 512, DUNK: 1024, REL: 2048, LAYUP: 4096,
} as const;

// [x, z, rot, y, flags, speed, shotT, animP, stamina]
export type AthSnap = [number, number, number, number, number, number, number, number, number];

export interface GameEvent {
  e: 'swish' | 'rim' | 'board' | 'block' | 'ankle' | 'score' | 'check' | 'shot' | 'pass' | 'bounce' | 'buzzer' | 'violation' | 'rebound' | 'dunk' | 'steps';
  a?: number; // atleta envolvido
  v?: number; // intensidade/valor
  t?: Team;
  m?: string; // mensagem
}

export interface Snapshot {
  t: number;
  ph: Phase;
  poss: Team;
  sc: [number, number];
  clk: number; // relógio de posse
  chk: number; // tempo restante até check automático
  clear: boolean; // precisa limpar a bola
  a: AthSnap[];
  ctl: [number, number]; // slot controlado por time
  ball: { x: number; y: number; z: number; h: number; st: string };
  ev: GameEvent[];
  win: number; // -1 se ninguém
  tgt: number;
}
