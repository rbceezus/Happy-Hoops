// Atletas de demonstração (usados em testes, treino sem banco e seed opcional).
import type { AthleteInfo } from './types';

const mk = (id: number, nome: string, ap: string, n: number, sala: string, ov: number, alt: 'P' | 'M' | 'G',
  a: number[], pele: string, estilo: AthleteInfo['estiloCabelo'], cabelo: string, top: AthleteInfo['roupaTop'] = 'regata-preta', bottom: AthleteInfo['roupaBottom'] = 'calca-preta', shoes: AthleteInfo['calcado'] = 'tenis-preto'): AthleteInfo => ({
  id, nome, apelido: ap, numero: n, sala, overall: ov, altura: alt,
  attrs: { arremesso3: a[0], arremessoMedia: a[1], finishing: a[2], passe: a[3], rebote: a[4], defesa: a[5], bloqueio: a[6], drible: a[7] },
  corPele: pele, estiloCabelo: estilo, corCabelo: cabelo, roupaTop: top, roupaBottom: bottom, calcado: shoes, ativo: true,
});

export const DEMO_ATHLETES: AthleteInfo[] = [
  mk(1, 'Lucas Almeida', 'Luquinhas', 7, '8º A', 82, 'M', [88, 80, 70, 75, 55, 60, 50, 85], '#e0ac82', 'curto', '#2b1b12', 'polo-preta','jeans-azul','tenis-preto'),
  mk(2, 'Pedro Santos', 'Pedrão', 23, '9º B', 85, 'G', [55, 70, 90, 60, 90, 75, 88, 55], '#8d5a3c', 'black', '#120c08', 'regata-preta','calca-preta','tenis-azul'),
  mk(3, 'Ana Beatriz', 'Bia', 10, '8º B', 78, 'P', [75, 72, 65, 92, 45, 70, 40, 90], '#f1c9a5', 'coque', '#5a3220', 'tshirt-preta','jeans-cinza','tenis-preto'),
  mk(4, 'João Victor', 'JV', 3, '9º A', 80, 'M', [70, 85, 78, 70, 65, 82, 70, 72], '#6b4128', 'tranca', '#0c0806', 'regata-preta','jeans-azul','tenis-azul'),
  mk(5, 'Marina Costa', 'Mari', 11, '7º A', 74, 'M', [80, 65, 60, 78, 50, 66, 45, 76], '#c68b62', 'curto', '#a05a1c', 'polo-preta','calca-preta','tenis-azul'),
  mk(6, 'Gabriel Lima', 'Gabs', 5, '9º B', 77, 'G', [60, 68, 82, 58, 84, 72, 80, 60], '#3f2615', 'careca', '#000000', 'tshirt-preta','jeans-azul','tenis-preto'),
  mk(7, 'Rafaela Nunes', 'Rafa', 14, '8º A', 79, 'M', [86, 76, 62, 70, 52, 64, 48, 80], '#ffdbb5', 'moicano', '#b0151f', 'regata-preta','jeans-cinza','tenis-azul'),
  mk(8, 'Thiago Rocha', 'Tchê', 9, '7º B', 72, 'P', [65, 74, 70, 82, 48, 68, 42, 88], '#a96f4a', 'curto', '#1a120d', 'polo-preta','jeans-cinza','tenis-preto'),
];
