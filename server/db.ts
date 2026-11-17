// Armazenamento dos atletas.
// - Com DATABASE_URL: PostgreSQL (Render Postgres, Neon, Supabase…) — os dados sobrevivem a qualquer deploy.
// - Sem DATABASE_URL: SQLite em arquivo (DB_PATH). Em hospedagem, só persiste se o arquivo estiver num disco persistente.
// Os atletas ativos ficam em cache na memória para o lobby sortear sem acessar o banco.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ATTR_KEYS, AthleteInfo, BOTTOMS, DEFAULT_OUTFIT, HAIR_STYLES, SHOES, TOPS } from '../shared/types';

type NewAthlete = Omit<AthleteInfo, 'id'>;

interface Driver {
  kind: 'postgres' | 'sqlite';
  describe: string;
  init(): Promise<void>;
  all(): Promise<AthleteInfo[]>;
  insert(a: NewAthlete): Promise<number>;
  update(id: number, a: NewAthlete): Promise<boolean>;
  remove(id: number): Promise<boolean>;
  getMeta(k: string): Promise<string | undefined>;
  setMeta(k: string, v: string): Promise<void>;
  close(): Promise<void>;
}

const COLS = ['nome', 'apelido', 'numero', 'sala', 'overall', 'altura', ...ATTR_KEYS, 'corPele', 'estiloCabelo', 'corCabelo', 'roupaTop', 'roupaBottom', 'calcado', 'ativo'];
const vals = (a: NewAthlete) => [
  a.nome, a.apelido, a.numero, a.sala, a.overall, a.altura, ...ATTR_KEYS.map((k) => a.attrs[k]),
  a.corPele, a.estiloCabelo, a.corCabelo, a.roupaTop, a.roupaBottom, a.calcado, a.ativo,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAthlete(r: any): AthleteInfo {
  return {
    id: Number(r.id), nome: r.nome, apelido: r.apelido, numero: Number(r.numero), sala: r.sala, overall: Number(r.overall), altura: r.altura,
    attrs: Object.fromEntries(ATTR_KEYS.map((k) => [k, Number(r[k])])) as unknown as AthleteInfo['attrs'],
    corPele: r.corPele, estiloCabelo: r.estiloCabelo, corCabelo: r.corCabelo,
    roupaTop: r.roupaTop ?? DEFAULT_OUTFIT.roupaTop, roupaBottom: r.roupaBottom ?? DEFAULT_OUTFIT.roupaBottom, calcado: r.calcado ?? DEFAULT_OUTFIT.calcado, ativo: !!r.ativo,
  };
}

// ------------------------------------------------------------------ SQLite
async function sqliteDriver(path: string): Promise<Driver> {
  const { DatabaseSync } = await import('node:sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  return {
    kind: 'sqlite',
    describe: `SQLite (${path})`,
    async init() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS athletes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL, apelido TEXT NOT NULL, numero INTEGER NOT NULL, sala TEXT NOT NULL,
          overall INTEGER NOT NULL, altura TEXT NOT NULL,
          ${ATTR_KEYS.map((k) => `${k} INTEGER NOT NULL`).join(', ')},
          corPele TEXT NOT NULL, estiloCabelo TEXT NOT NULL, corCabelo TEXT NOT NULL,
          roupaTop TEXT NOT NULL DEFAULT 'regata-preta', roupaBottom TEXT NOT NULL DEFAULT 'calca-preta', calcado TEXT NOT NULL DEFAULT 'tenis-preto',
          ativo INTEGER NOT NULL DEFAULT 1,
          criadoEm TEXT NOT NULL DEFAULT (datetime('now')), atualizadoEm TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`);
      // migração: bancos criados antes das roupas
      const have = new Set((db.prepare('PRAGMA table_info(athletes)').all() as { name: string }[]).map((c) => c.name));
      for (const [c, d] of [['roupaTop', 'regata-preta'], ['roupaBottom', 'calca-preta'], ['calcado', 'tenis-preto']]) {
        if (!have.has(c)) db.exec(`ALTER TABLE athletes ADD COLUMN ${c} TEXT NOT NULL DEFAULT '${d}'`);
      }
    },
    async all() { return (db.prepare('SELECT * FROM athletes ORDER BY sala, nome').all() as unknown[]).map(rowToAthlete); },
    async insert(a) {
      const v = vals(a).map((x) => (typeof x === 'boolean' ? (x ? 1 : 0) : x));
      const r = db.prepare(`INSERT INTO athletes(${COLS.join(',')}) VALUES(${COLS.map(() => '?').join(',')})`).run(...(v as never[]));
      return Number(r.lastInsertRowid);
    },
    async update(id, a) {
      const v = vals(a).map((x) => (typeof x === 'boolean' ? (x ? 1 : 0) : x));
      return db.prepare(`UPDATE athletes SET ${COLS.map((c) => `${c}=?`).join(',')}, atualizadoEm=datetime('now') WHERE id=?`).run(...(v as never[]), id).changes > 0;
    },
    async remove(id) { return db.prepare('DELETE FROM athletes WHERE id=?').run(id).changes > 0; },
    async getMeta(k) { return (db.prepare('SELECT v FROM meta WHERE k=?').get(k) as { v: string } | undefined)?.v; },
    async setMeta(k, v) { db.prepare('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)').run(k, v); },
    async close() { db.close(); },
  };
}

// ------------------------------------------------------------------ PostgreSQL
function pgSsl(url: string): false | { rejectUnauthorized: false } {
  if (process.env.DATABASE_SSL === '0') return false;
  if (process.env.DATABASE_SSL === '1') return { rejectUnauthorized: false };
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  // localhost e a URL interna do Render (dpg-xxxx-a, sem pontos) não usam SSL; provedores externos exigem
  if (host === 'localhost' || host === '127.0.0.1' || !host.includes('.')) return false;
  return { rejectUnauthorized: false };
}

async function pgDriver(url: string): Promise<Driver> {
  const { default: pg } = await import('pg');
  const clean = (() => { try { const u = new URL(url); u.searchParams.delete('sslmode'); u.searchParams.delete('channel_binding'); return u.toString(); } catch { return url; } })();
  const pool = new pg.Pool({ connectionString: clean, ssl: pgSsl(url), max: 5 });
  const q = (c: string) => `"${c}"`;
  const host = (() => { try { return new URL(url).hostname; } catch { return '?'; } })();
  return {
    kind: 'postgres',
    describe: `PostgreSQL (${host})`,
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS athletes (
          id SERIAL PRIMARY KEY,
          nome TEXT NOT NULL, apelido TEXT NOT NULL, numero INTEGER NOT NULL, sala TEXT NOT NULL,
          overall INTEGER NOT NULL, altura TEXT NOT NULL,
          ${ATTR_KEYS.map((k) => `${q(k)} INTEGER NOT NULL`).join(', ')},
          "corPele" TEXT NOT NULL, "estiloCabelo" TEXT NOT NULL, "corCabelo" TEXT NOT NULL,
          "roupaTop" TEXT NOT NULL DEFAULT 'regata-preta', "roupaBottom" TEXT NOT NULL DEFAULT 'calca-preta', "calcado" TEXT NOT NULL DEFAULT 'tenis-preto',
          ativo BOOLEAN NOT NULL DEFAULT TRUE,
          "criadoEm" TIMESTAMPTZ NOT NULL DEFAULT now(), "atualizadoEm" TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
        ALTER TABLE athletes ADD COLUMN IF NOT EXISTS "roupaTop" TEXT NOT NULL DEFAULT 'regata-preta';
        ALTER TABLE athletes ADD COLUMN IF NOT EXISTS "roupaBottom" TEXT NOT NULL DEFAULT 'calca-preta';
        ALTER TABLE athletes ADD COLUMN IF NOT EXISTS "calcado" TEXT NOT NULL DEFAULT 'tenis-preto';`);
    },
    async all() { return (await pool.query('SELECT * FROM athletes ORDER BY sala, nome')).rows.map(rowToAthlete); },
    async insert(a) {
      const r = await pool.query(`INSERT INTO athletes(${COLS.map(q).join(',')}) VALUES(${COLS.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, vals(a));
      return Number(r.rows[0].id);
    },
    async update(id, a) {
      const r = await pool.query(`UPDATE athletes SET ${COLS.map((c, i) => `${q(c)}=$${i + 1}`).join(',')}, "atualizadoEm"=now() WHERE id=$${COLS.length + 1}`, [...vals(a), id]);
      return (r.rowCount ?? 0) > 0;
    },
    async remove(id) { return ((await pool.query('DELETE FROM athletes WHERE id=$1', [id])).rowCount ?? 0) > 0; },
    async getMeta(k) { return (await pool.query('SELECT v FROM meta WHERE k=$1', [k])).rows[0]?.v; },
    async setMeta(k, v) { await pool.query('INSERT INTO meta(k,v) VALUES($1,$2) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v', [k, v]); },
    async close() { await pool.end(); },
  };
}

// ------------------------------------------------------------------ API usada pelo servidor
let driver: Driver;
let cache: AthleteInfo[] = [];

export async function initDb(): Promise<Driver> {
  const url = process.env.DATABASE_URL;
  driver = url ? await pgDriver(url) : await sqliteDriver(process.env.DB_PATH ?? 'data/happy-hoops.db');
  await driver.init();
  cache = await driver.all();
  return driver;
}
export const dbInfo = () => ({ kind: driver.kind, describe: driver.describe });
export const closeDb = () => driver.close();

const refresh = async () => { cache = await driver.all(); };

/** Leitura síncrona do cache (lobby). */
export const listAthletes = (onlyActive = false): AthleteInfo[] => (onlyActive ? cache.filter((a) => a.ativo) : cache).map((a) => ({ ...a, attrs: { ...a.attrs } }));
export const getAthlete = (id: number) => cache.find((a) => a.id === id);

export async function createAthlete(a: NewAthlete): Promise<AthleteInfo> {
  const id = await driver.insert(a);
  await refresh();
  return getAthlete(id)!;
}
export async function updateAthlete(id: number, a: NewAthlete): Promise<AthleteInfo | undefined> {
  const ok = await driver.update(id, a);
  await refresh();
  return ok ? getAthlete(id) : undefined;
}
export async function deleteAthlete(id: number): Promise<boolean> {
  const ok = await driver.remove(id);
  await refresh();
  return ok;
}
export const getMeta = (k: string) => driver.getMeta(k);
export const setMeta = (k: string, v: string) => driver.setMeta(k, v);

/** Valida e normaliza o corpo vindo do admin. Retorna string de erro ou o atleta. */
export function parseAthlete(body: unknown): NewAthlete | string {
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
  const roupaTop = b.roupaTop ?? DEFAULT_OUTFIT.roupaTop, roupaBottom = b.roupaBottom ?? DEFAULT_OUTFIT.roupaBottom, calcado = b.calcado ?? DEFAULT_OUTFIT.calcado;
  if (!TOPS.includes(roupaTop as never)) return 'Camiseta inválida';
  if (!BOTTOMS.includes(roupaBottom as never)) return 'Parte de baixo inválida';
  if (!SHOES.includes(calcado as never)) return 'Tênis inválido';
  return {
    nome, apelido, numero, sala, overall, altura, attrs, corPele: b.corPele.toLowerCase(), estiloCabelo: b.estiloCabelo as AthleteInfo['estiloCabelo'],
    corCabelo: b.corCabelo.toLowerCase(),
    roupaTop: roupaTop as AthleteInfo['roupaTop'], roupaBottom: roupaBottom as AthleteInfo['roupaBottom'], calcado: calcado as AthleteInfo['calcado'], ativo: b.ativo === undefined ? true : !!b.ativo,
  };
}
