// Simula "deploy": cria atleta, derruba o servidor, sobe de novo e confere que o atleta continua lá.
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function boot(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const p = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), ADMIN_PASSWORD: 'x1', NODE_NO_WARNINGS: '1', SEED_DEMO: '', ...env }, stdio: 'pipe',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return p; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('servidor não subiu');
}
const stop = (p: ChildProcess) => new Promise<void>((r) => { p.on('exit', () => r()); p.kill(); });

async function roundTrip(port: number, env: Record<string, string>) {
  const base = `http://127.0.0.1:${port}`;
  let srv = await boot(port, env);
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"x1"}' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const nome = `Persistente ${Date.now()}`;
  const r = await fetch(`${base}/api/admin/athletes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ nome, sala: '9º Z', numero: 8, overall: 77, altura: 'G', corPele: '#8d5a3c', estiloCabelo: 'black', corCabelo: '#111111',
      attrs: { arremesso3: 50, arremessoMedia: 51, finishing: 52, passe: 53, rebote: 54, defesa: 55, bloqueio: 56, drible: 57 } }),
  });
  expect(r.status).toBe(201);
  const exp = await (await fetch(`${base}/api/admin/export`, { headers: { cookie } })).json();
  expect(exp.atletas.some((a: { nome: string }) => a.nome === nome)).toBe(true);
  await stop(srv);
  srv = await boot(port, env);
  const login2 = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"x1"}' });
  const cookie2 = login2.headers.get('set-cookie')!.split(';')[0];
  const list = await (await fetch(`${base}/api/admin/athletes`, { headers: { cookie: cookie2 } })).json();
  const found = list.find((a: { nome: string }) => a.nome === nome);
  expect(found?.attrs.bloqueio).toBe(56);
  // importar o backup de novo não duplica
  const imp = await (await fetch(`${base}/api/admin/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookie2 }, body: JSON.stringify(exp) })).json();
  expect(imp.adicionados).toBe(0);
  await fetch(`${base}/api/admin/athletes/${found.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', cookie: cookie2 } });
  await stop(srv);
}

describe('persistência entre reinícios (deploy)', () => {
  it('SQLite em arquivo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hh-'));
    await roundTrip(3931, { DB_PATH: join(dir, 'x.db'), DATABASE_URL: '' });
  }, 40000);

  it.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL (DATABASE_URL)', async () => {
    await roundTrip(3932, { DATABASE_URL: process.env.TEST_DATABASE_URL! });
  }, 40000);
});
