// Servidor HTTP + WebSocket: API do admin, API pública de treino, salas do jogo e arquivos estáticos do cliente.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { DEMO_ATHLETES } from '../shared/demo';
import type { ClientMsg } from '../shared/protocol';
import { checkLogin, initAuth, isAdmin, makeSession, setSessionCookie } from './auth';
import { createAthlete, dbInfo, deleteAthlete, initDb, listAthletes, parseAthlete, updateAthlete } from './db';
import { RoomManager } from './rooms';

// `neon deploy`/`neon env pull` gravam DATABASE_URL em .env.local (ou .env); carrega se existir
for (const f of ['.env.local', '.env']) { try { process.loadEnvFile(f); } catch { /* arquivo ausente */ } }

const PORT = Number(process.env.PORT ?? 3000);
const DIST = resolve(process.env.CLIENT_DIST ?? 'dist');

await initDb();
await initAuth();
console.log(`Banco: ${dbInfo().describe}`);
if (dbInfo().kind === 'sqlite' && process.env.RENDER && !process.env.DB_PATH?.startsWith('/app/data')) {
  console.warn('ATENÇÃO: SQLite fora de disco persistente — os atletas somem a cada deploy. Configure DATABASE_URL (Postgres) ou um disco em /app/data.');
}
if (process.env.SEED_DEMO === '1' && listAthletes().length === 0) {
  for (const a of DEMO_ATHLETES) { const { id: _id, ...rest } = a; await createAthlete(rest); }
  console.log(`Seed: ${DEMO_ATHLETES.length} atletas de demonstração criados.`);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2',
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit = 16 * 1024): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  const method = req.method ?? 'GET';
  // Proteção CSRF extra: mutações exigem JSON
  if (method !== 'GET' && method !== 'HEAD' && !String(req.headers['content-type'] ?? '').includes('application/json')) {
    return json(res, 415, { error: 'Content-Type deve ser application/json' });
  }
  try {
    if (path === '/api/health') return json(res, 200, { ok: true });

    // ---- público ----
    if (path === '/api/draw' && method === 'GET') {
      const all = listAthletes(true).sort(() => Math.random() - 0.5);
      return json(res, 200, all.slice(0, 5));
    }
    if (path === '/api/roster' && method === 'GET') return json(res, 200, listAthletes(true));

    // ---- admin ----
    if (path === '/api/admin/login' && method === 'POST') {
      const body = (await readBody(req)) as { password?: unknown };
      const r = checkLogin(req, body.password);
      if (!r.ok) return json(res, r.status, { error: r.msg });
      setSessionCookie(req, res, makeSession());
      return json(res, 200, { ok: true });
    }
    if (path === '/api/admin/logout' && method === 'POST') {
      setSessionCookie(req, res, null);
      return json(res, 200, { ok: true });
    }
    if (path.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return json(res, 401, { error: 'Não autorizado' });
      if (path === '/api/admin/me') return json(res, 200, { ok: true, db: dbInfo() });
      if (path === '/api/admin/export' && method === 'GET') {
        res.setHeader('Content-Disposition', `attachment; filename="happy-hoops-atletas-${new Date().toISOString().slice(0, 10)}.json"`);
        return json(res, 200, { versao: 1, exportadoEm: new Date().toISOString(), atletas: listAthletes().map(({ id: _id, ...a }) => a) });
      }
      if (path === '/api/admin/import' && method === 'POST') {
        const body = (await readBody(req, 2 * 1024 * 1024)) as { atletas?: unknown[]; substituir?: boolean };
        const list = Array.isArray(body.atletas) ? body.atletas : Array.isArray(body) ? (body as unknown[]) : null;
        if (!list) return json(res, 400, { error: 'Arquivo inválido: esperado { atletas: [...] }' });
        const parsed = list.map(parseAthlete);
        const bad = parsed.findIndex((p) => typeof p === 'string');
        if (bad >= 0) return json(res, 400, { error: `Atleta ${bad + 1}: ${parsed[bad]}` });
        if (body.substituir) for (const a of listAthletes()) await deleteAthlete(a.id);
        const existing = new Set(listAthletes().map((a) => `${a.nome.toLowerCase()}|${a.sala.toLowerCase()}`));
        let added = 0, skipped = 0;
        for (const p of parsed as Exclude<ReturnType<typeof parseAthlete>, string>[]) {
          const key = `${p.nome.toLowerCase()}|${p.sala.toLowerCase()}`;
          if (existing.has(key)) { skipped++; continue; }
          await createAthlete(p); existing.add(key); added++;
        }
        return json(res, 200, { ok: true, adicionados: added, ignorados: skipped });
      }
      if (path === '/api/admin/athletes' && method === 'GET') return json(res, 200, listAthletes());
      if (path === '/api/admin/athletes' && method === 'POST') {
        const a = parseAthlete(await readBody(req));
        if (typeof a === 'string') return json(res, 400, { error: a });
        return json(res, 201, await createAthlete(a));
      }
      const m = path.match(/^\/api\/admin\/athletes\/(\d+)$/);
      if (m && method === 'PUT') {
        const a = parseAthlete(await readBody(req));
        if (typeof a === 'string') return json(res, 400, { error: a });
        const r = await updateAthlete(Number(m[1]), a);
        return r ? json(res, 200, r) : json(res, 404, { error: 'Atleta não encontrado' });
      }
      if (m && method === 'DELETE') return (await deleteAthlete(Number(m[1]))) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Atleta não encontrado' });
    }
    return json(res, 404, { error: 'Rota não encontrada' });
  } catch (e) {
    return json(res, 400, { error: (e as Error).message });
  }
}

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  let file = normalize(join(DIST, decodeURIComponent(pathname)));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html'); // SPA
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Cliente não compilado. Rode: npm run build');
    return;
  }
  const ext = extname(file);
  const cache = file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/api/')) { void api(req, res, url.pathname); return; }
  serveStatic(req, res, url.pathname);
});

const rooms = new RoomManager();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
wss.on('connection', (ws) => {
  let count = 0, windowStart = Date.now();
  ws.on('message', (data) => {
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    if (++count > 200) return; // anti-flood
    let msg: ClientMsg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return;
    try { rooms.handle(ws, msg); } catch (e) { console.error('erro ao tratar mensagem', e); }
  });
  ws.on('close', () => rooms.closed(ws));
  ws.on('error', () => { /* ignorado */ });
});

setInterval(() => rooms.update(performance.now()), 8);

server.listen(PORT, () => console.log(`Happy Hoops em http://localhost:${PORT}`));
