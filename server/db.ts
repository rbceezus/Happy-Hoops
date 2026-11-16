// Banco SQLite (node:sqlite, embutido no Node >= 22.5).
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ATTR_KEYS, AthleteInfo, HAIR_STYLES } from '../shared/types';

const path = process.env.DB_PATH ?? 'data/happy-hoops.db';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
export const db = new DatabaseSync(path);
db.exec(`
CREATE TABLE IF NOT EXISTS athletes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL, apelido TEXT NOT NULL, numero INTEGER NOT NULL, sala TEXT NOT NULL,
  overall INTEGER NOT NULL, altura TEXT NOT NULL,
  arremesso3 INTEGER NOT NULL, arremessoMedia INTEGER NOT NULL, finishing INTEGER NOT NULL, passe INTEGER NOT NULL,
  rebote INTEGER NOT NULL, defesa INTEGER NOT NULL, bloqueio INTEGER NOT NULL, drible INTEGER NOT NULL,
  corPele TEXT NOT NULL, estiloCabelo TEXT NOT NULL, corCabelo TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criadoEm TEXT NOT NULL DEFAULT (datetime('now')), atualizadoEm TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

export const getMeta = (k: string): string | undefined =>
  (db.prepare('SELECT v FROM meta WHERE k=?').get(k) as { v: string } | undefined)?.v;
export const setMeta = (k: string, v: string) => { db.prepare('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)').run(k, v); };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAthlete(r: any): AthleteInfo {
  return {
    id: r.id, nome: r.nome, apelido: r.apelido, numero: r.numero, sala: r.sala, overall: r.overall, altura: r.altura,
    attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, r[k]])) as unknown as AthleteInfo['attrs'],
    corPele: r.corPele, estiloCabelo: r.estiloCabelo, corCabelo: r.corCabelo, ativo: !!r.ativo,
  };
}

export const listAthletes = (onlyActive = false): AthleteInfo[] =>
  (db.prepare(`SELECT * FROM athletes ${onlyActive ? 'WHERE ativo=1' : ''} ORDER BY sala, nome`).all() as unknown[]).map(rowToAthlete);

export const getAthlete = (id: number): AthleteInfo | undefined => {
  const r = db.prepare('SELECT * FROM athletes WHERE id=?').get(id);
  return r ? rowToAthlete(r) : undefined;
};

const COLS = ['nome', 'apelido', 'numero', 'sala', 'overall', 'altura', ...ATTR_KEYS, 'corPele', 'estiloCabelo', 'corCabelo', 'ativo'];
const vals = (a: Omit<AthleteInfo, 'id'>) => [
  a.nome, a.apelido, a.numero, a.sala, a.overall, a.altura, ...ATTR_KEYS.map((k) => a.attrs[k]),
  a.corPele, a.estiloCabelo, a.corCabelo, a.ativo ? 1 : 0,
];

export function createAthlete(a: Omit<AthleteInfo, 'id'>): AthleteInfo {
  const r = db.prepare(`INSERT INTO athletes(${COLS.join(',')}) VALUES(${COLS.map(() => '?').join(',')})`).run(...(vals(a) as never[]));
  return getAthlete(Number(r.lastInsertRowid))!;
}

export function updateAthlete(id: number, a: Omit<AthleteInfo, 'id'>): AthleteInfo | undefined {
  const r = db.prepare(`UPDATE athletes SET ${COLS.map((c) => `${c}=?`).join(',')}, atualizadoEm=datetime('now') WHERE id=?`).run(...(vals(a) as never[]), id);
  return r.changes ? getAthlete(id) : undefined;
}

export const deleteAthlete = (id: number) => db.prepare('DELETE FROM athletes WHERE id=?').run(id).changes > 0;

/** Valida e normaliza o corpo vindo do admin. Retorna string de erro ou o atleta. */
export function parseAthlete(body: unknown): Omit<AthleteInfo, 'id'> | string {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return 'Corpo inválido';
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const int = (v: unknown, lo: number, hi: number) => {
    const n = Number(v);
    return Number.isFinite(n) && Math.round(n) >= lo && Math.round(n) <= hi ? Math.round(n) : null;
  };
  const nome = str(b.nome, 60);
  if (!nome) return 'Nome é obrigatório';
  const apelido = str(b.apelido, 20) || nome.split(' ')[0];
  const numero = int(b.numero, 0, 99);
  if (numero === null) return 'Número da camisa deve ser de 0 a 99';
  const overall = int(b.overall, 25, 99);
  if (overall === null) return 'Overall deve ser de 25 a 99';
  const altura = b.altura;
  if (altura !== 'P' && altura !== 'M' && altura !== 'G') return 'Altura deve ser P, M ou G';
  const sala = str(b.sala, 20);
  if (!sala) return 'Sala é obrigatória';
  const at = (b.attrs ?? {}) as Record<string, unknown>;
  const attrs = {} as AthleteInfo['attrs'];
  for (const k of ATTR_KEYS) {
    const v = int(at[k], 25, 99);
    if (v === null) return `Atributo ${k} deve ser de 25 a 99`;
    attrs[k] = v;
  }
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (typeof b.corPele !== 'string' || !hex.test(b.corPele)) return 'Cor de pele inválida';
  if (typeof b.corCabelo !== 'string' || !hex.test(b.corCabelo)) return 'Cor de cabelo inválida';
  if (!HAIR_STYLES.includes(b.estiloCabelo as never)) return 'Estilo de cabelo inválido';
  return {
    nome, apelido, numero, sala, overall, altura, attrs, corPele: b.corPele, estiloCabelo: b.estiloCabelo as AthleteInfo['estiloCabelo'],
    corCabelo: b.corCabelo, ativo: b.ativo === undefined ? true : !!b.ativo,
  };
}
