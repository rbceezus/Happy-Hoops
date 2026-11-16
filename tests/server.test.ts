import { spawn, ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const PORT = 3917;
const base = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;

beforeAll(async () => {
  proc = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: ':memory:', ADMIN_PASSWORD: 'segredo123', SEED_DEMO: '1', NODE_NO_WARNINGS: '1' },
    stdio: 'pipe',
  });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* aguardando */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('servidor não subiu');
}, 20000);
afterAll(() => { proc.kill(); });

const post = (path: string, body: unknown, cookie = '') =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });

describe('admin', () => {
  it('rejeita sem login e com senha errada, aceita a certa', async () => {
    expect((await fetch(`${base}/api/admin/athletes`)).status).toBe(401);
    expect((await post('/api/admin/login', { password: 'x' })).status).toBe(401);
    const ok = await post('/api/admin/login', { password: 'segredo123' });
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get('set-cookie')!.split(';')[0];
    expect(ok.headers.get('set-cookie')).toContain('HttpOnly');
    const list = await (await fetch(`${base}/api/admin/athletes`, { headers: { cookie } })).json();
    expect(list.length).toBe(8);

    const novo = {
      nome: 'Teste Aluno', apelido: 'Teste', numero: 12, sala: '8º C', overall: 70, altura: 'M',
      attrs: { arremesso3: 60, arremessoMedia: 61, finishing: 62, passe: 63, rebote: 64, defesa: 65, bloqueio: 66, drible: 67 },
      corPele: '#aa7755', estiloCabelo: 'curto', corCabelo: '#111111',
    };
    const c = await post('/api/admin/athletes', novo, cookie);
    expect(c.status).toBe(201);
    const created = await c.json();
    expect(created.overall).toBe(70);
    const bad = await post('/api/admin/athletes', { ...novo, attrs: { ...novo.attrs, defesa: 5 } }, cookie);
    expect(bad.status).toBe(400);
    const up = await fetch(`${base}/api/admin/athletes/${created.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ ...novo, overall: 88 }) });
    expect((await up.json()).overall).toBe(88);
    expect((await fetch(`${base}/api/admin/athletes/${created.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', cookie } })).status).toBe(200);
  });

  it('limita tentativas de login', async () => {
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await post('/api/admin/login', { password: 'errada' })).status;
    expect(last).toBe(429);
  });
});

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const msgs: any[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  const open = new Promise<void>((r) => ws.on('open', () => r()));
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  const waitFor = async (pred: (m: any) => boolean, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = [...msgs].reverse().find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('timeout esperando mensagem');
  };
  return { ws, msgs, open, send, waitFor };
}

describe('lobby e partida', () => {
  it('cria sala, entra com código, escolhe 2 de 5, joga e recebe snapshots', async () => {
    const a = client(), b = client();
    await Promise.all([a.open, b.open]);
    a.send({ t: 'create', name: 'Ana' });
    const created = await a.waitFor((m) => m.t === 'room');
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    b.send({ t: 'join', code: created.code, name: 'Beto' });
    const pa = await a.waitFor((m) => m.t === 'room' && m.phase === 'pick');
    const pb = await b.waitFor((m) => m.t === 'room' && m.phase === 'pick');
    expect(pa.options.length).toBe(5);
    expect(pb.options.length).toBe(5);
    a.send({ t: 'pick', ids: [pa.options[0].id, pa.options[1].id] });
    b.send({ t: 'pick', ids: [pb.options[0].id, pb.options[1].id, pb.options[2].id] }); // só 2 valem
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    await a.waitFor((m) => m.t === 'room' && m.phase === 'countdown');
    const playing = await a.waitFor((m) => m.t === 'room' && m.phase === 'playing', 8000);
    expect(playing.teams[0].length).toBe(2);
    expect(playing.teams[1].length).toBe(2);
    const snap = await a.waitFor((m) => m.t === 'snap');
    expect(snap.s.a.length).toBe(4);
    // inicia o check e anda
    const poss = snap.s.poss;
    (poss === 0 ? a : b).send({ t: 'input', f: { mx: 0, mz: 0, run: false, contest: false, ev: [{ k: 'check' }] } });
    await a.waitFor((m) => m.t === 'snap' && m.s.ph === 'live');
    (poss === 0 ? a : b).send({ t: 'input', f: { mx: 0, mz: -1, run: true, contest: false, ev: [] } });
    await new Promise((r) => setTimeout(r, 700));
    const later = [...a.msgs].reverse().find((m) => m.t === 'snap').s;
    expect(later.a[poss * 2 + later.ctl[poss]][1]).toBeLessThan(7.6);
    a.ws.close(); b.ws.close();
  }, 25000);

  it('código inexistente retorna erro', async () => {
    const c = client();
    await c.open;
    c.send({ t: 'join', code: 'ZZZZZ', name: 'x' });
    expect((await c.waitFor((m) => m.t === 'err')).msg).toMatch(/não encontrada/);
    c.ws.close();
  });
});
