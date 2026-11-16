// Login do administrador (usuário único): senha com scrypt, sessão em cookie httpOnly assinado, limite de tentativas.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getMeta, setMeta } from './db';

const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'hh_admin';

export function hashPassword(pw: string, salt = randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString('hex')}`;
}

function verifyPassword(pw: string, stored: string): boolean {
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const a = scryptSync(pw, salt, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

let passwordHash = '';
let secret = '';

export function initAuth() {
  secret = process.env.SESSION_SECRET || getMeta('session_secret') || '';
  if (!secret) { secret = randomBytes(32).toString('hex'); setMeta('session_secret', secret); }
  if (process.env.ADMIN_PASSWORD_HASH) passwordHash = process.env.ADMIN_PASSWORD_HASH;
  else if (process.env.ADMIN_PASSWORD) passwordHash = hashPassword(process.env.ADMIN_PASSWORD);
  else {
    const saved = getMeta('admin_hash');
    if (saved) passwordHash = saved;
    else {
      const pw = randomBytes(9).toString('base64url');
      passwordHash = hashPassword(pw);
      setMeta('admin_hash', passwordHash);
      console.log('\n==================================================');
      console.log(' Senha do admin gerada (aparece só desta vez):');
      console.log(`   ${pw}`);
      console.log(' Para definir a sua: ADMIN_PASSWORD=... ou ADMIN_PASSWORD_HASH=...');
      console.log('==================================================\n');
    }
  }
}

const sign = (v: string) => createHmac('sha256', secret).update(v).digest('hex');

export function makeSession(): string {
  const exp = String(Date.now() + SESSION_MS);
  return `${exp}.${sign(exp)}`;
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function isAdmin(req: IncomingMessage): boolean {
  const c = parseCookies(req)[COOKIE];
  if (!c) return false;
  const [exp, sig] = c.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return good.length === sig.length && timingSafeEqual(Buffer.from(good), Buffer.from(sig));
}

export function setSessionCookie(req: IncomingMessage, res: ServerResponse, value: string | null) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1';
  const base = `${COOKIE}=${value ?? ''}; HttpOnly; SameSite=Strict; Path=/`;
  const age = value ? `; Max-Age=${SESSION_MS / 1000}` : '; Max-Age=0';
  res.setHeader('Set-Cookie', base + age + (secure ? '; Secure' : ''));
}

// ---- limite de tentativas: 5 por 15 min por IP ----
const attempts = new Map<string, { n: number; reset: number }>();
export function clientIp(req: IncomingMessage): string {
  if (process.env.TRUST_PROXY === '1') {
    const xf = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (xf) return xf;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function checkLogin(req: IncomingMessage, password: unknown): { ok: boolean; status: number; msg?: string } {
  const ip = clientIp(req);
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || a.reset < now) { a = { n: 0, reset: now + 15 * 60 * 1000 }; attempts.set(ip, a); }
  if (a.n >= 5) return { ok: false, status: 429, msg: 'Muitas tentativas. Aguarde alguns minutos.' };
  if (typeof password === 'string' && password.length <= 200 && verifyPassword(password, passwordHash)) {
    attempts.delete(ip);
    return { ok: true, status: 200 };
  }
  a.n++;
  return { ok: false, status: 401, msg: 'Senha incorreta.' };
}
