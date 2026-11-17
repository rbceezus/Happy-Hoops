// Telas: início, lobby por código, escolha de 5 atletas (2 entram no time), jogo online e modo treino.
import type { RoomView } from '../../shared/protocol';
import { ATTR_KEYS, ATTR_LABELS, AthleteInfo, InputFrame, Snapshot } from '../../shared/types';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import { initAudio } from './audio';
import { initAdmin } from './admin';
import { GameView } from './game-view';
import { Net } from './net';
import { TrainingSession, drawFour } from './offline';
import { Hero3D, portrait } from './preview';
import { DEMO_ATHLETES } from '../../shared/demo';
import { nrm } from '../../shared/court';

const app = document.getElementById('app')!;

const BALL_SVG = `<svg viewBox="0 0 100 100"><defs><radialGradient id="bg" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffd08a"/><stop offset=".45" stop-color="#ff8a2b"/><stop offset="1" stop-color="#b8420f"/></radialGradient></defs>
<circle cx="50" cy="50" r="46" fill="url(#bg)"/><g fill="none" stroke="#2a1206" stroke-width="2.6" stroke-linecap="round"><path d="M50 4v92M4 50h92"/><path d="M16 17q34 33 0 66M84 17q-34 33 0 66"/></g>
<ellipse cx="38" cy="26" rx="22" ry="12" fill="#fff" opacity=".45" transform="rotate(-25 38 26)"/></svg>`;

function aeroBackdrop() {
  const el = document.createElement('div');
  el.id = 'aero';
  const bubbles = Array.from({ length: 18 }, () => {
    const sz = 18 + Math.random() * 70;
    return `<i class="bubble" style="width:${sz}px;height:${sz}px;left:${Math.random() * 100}%;animation-duration:${14 + Math.random() * 18}s;animation-delay:${-Math.random() * 24}s"></i>`;
  }).join('');
  const clouds = [[8, 60, 70], [30, 22, 95], [55, 40, 80]].map(([top, , dur]) => `<i class="cloud" style="top:${top}%;animation-duration:${dur}s;animation-delay:${-Math.random() * dur}s;opacity:${0.6 + Math.random() * 0.3}"></i>`).join('');
  el.innerHTML = `<div class="rays"></div><div class="sun"></div>${clouds}
    <svg class="hill" viewBox="0 0 1440 320" preserveAspectRatio="none"><defs>
      <linearGradient id="h1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9f46b"/><stop offset="1" stop-color="#3fb73a"/></linearGradient>
      <linearGradient id="h2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8be04e"/><stop offset="1" stop-color="#278f2e"/></linearGradient></defs>
      <path d="M0 150 Q240 40 520 120 T1040 100 T1440 90 V320 H0Z" fill="url(#h1)"/>
      <path d="M0 220 Q300 120 640 200 T1440 170 V320 H0Z" fill="url(#h2)"/>
      <path d="M0 150 Q240 40 520 120 T1040 100 T1440 90" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3"/></svg>${bubbles}`;
  document.body.prepend(el);
  return el;
}
const aero = aeroBackdrop();
const showAero = (on: boolean) => { aero.style.display = on ? '' : 'none'; };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const getName = () => { try { return localStorage.getItem('hh_name') ?? ''; } catch { return ''; } };
const setName = (n: string) => { try { localStorage.setItem('hh_name', n); } catch { /* ok */ } };

if (location.pathname.startsWith('/admin')) {
  initAdmin(app);
} else {
  start();
}

function start() {
  const net = new Net();
  let view: GameView | null = null;
  let training: TrainingSession | null = null;
  let room: RoomView | null = null;
  let timer = 0;
  let overlay: HTMLElement | null = null;
  let gameRoot: HTMLElement | null = null;
  let lastSnapKey = '';
  const pending: Snapshot[] = [];

  const conn = document.createElement('div');
  conn.className = 'conn';
  conn.style.display = 'none';
  document.body.appendChild(conn);

  net.h.status = (s) => {
    conn.style.display = s === 'open' ? 'none' : 'block';
    conn.textContent = s === 'connecting' ? 'Conectando…' : 'Sem conexão — tentando reconectar…';
  };
  net.h.room = (r) => { room = r; renderRoom(); };
  net.h.snap = (s) => { if (view) view.pushSnapshot(s); else pending.push(s); };
  net.h.left = () => { room = null; home(); };
  net.h.err = (m) => { const e = document.querySelector<HTMLElement>('[data-err]'); if (e) e.textContent = m; };
  net.connect();

  // ------------------------------------------------------------------ início
  let hero: Hero3D | null = null;
  let heroTimer = 0;
  const stopHero = () => { window.clearInterval(heroTimer); hero?.dispose(); hero = null; };

  function ring(vals: [string, number, string][]) {
    // anéis concêntricos (estilo "colorização" da referência) com 3 atributos
    return `<svg viewBox="0 0 120 120" class="rings">${vals.map(([, v, c], i) => {
      const r = 50 - i * 11, len = 2 * Math.PI * r, f = nrm(v) * 0.75 + 0.1;
      return `<circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="5"/>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${len * f} ${len}" transform="rotate(-90 60 60)"/>`;
    }).join('')}${vals.map(([lb, v], i) => `<text x="60" y="${52 + i * 12}" text-anchor="middle">${v} <tspan>${lb}</tspan></text>`).join('')}</svg>`;
  }
  function curve(a: AthleteInfo) {
    const pts: [string, number][] = [['ARREMESSO 3', a.attrs.arremesso3], ['FINISHING', a.attrs.finishing], ['DRIBLE', a.attrs.drible], ['DEFESA', a.attrs.defesa]];
    const xs = pts.map((_, i) => 36 + i * 60), ys = pts.map(([, v]) => 66 - nrm(v) * 52);
    let d = `M${xs[0]},${ys[0]}`;
    for (let i = 1; i < xs.length; i++) { const mx = (xs[i - 1] + xs[i]) / 2; d += ` C${mx},${ys[i - 1]} ${mx},${ys[i]} ${xs[i]},${ys[i]}`; }
    return `<svg viewBox="0 0 250 92" class="curve"><path d="${d}" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.6"/>
      ${pts.map(([lb, v], i) => `<text x="${xs[i]}" y="${ys[i] - 7}" text-anchor="middle" class="v">${v}</text><text x="${xs[i]}" y="88" text-anchor="middle">${lb}</text>`).join('')}</svg>`;
  }

  function home() {
    stopGame();
    showAero(false);
    window.clearInterval(timer);
    document.body.classList.add('dark');
    app.innerHTML = `
      <div class="screen dk home">
        <div class="spot"></div>
        <div class="wm">${BALL_SVG}</div>
        <header class="hd-top">
          <div class="brand">${BALL_SVG}<span>HAPPY</span><b class="gold">HOOPS</b></div>
          <div class="hd-tag">2V2 · MEIA QUADRA · ATÉ 5</div>
        </header>
        <section class="hd-left">
          <h1 class="hero-t">ENTRE<br>NA<br>QUADRA</h1>
          <p class="quote">“Cada aluno é um atleta. Cada cesta conta.<br>Junte seu parceiro, chame o adversário e jogue até 5.”</p>
          <div class="menu">
            <div class="namebox"><label>Seu apelido</label><input id="name" maxlength="16" placeholder="Como você quer ser chamado?" value="${esc(getName())}"></div>
            <button class="mi" id="create"><i>01</i>Criar sala</button>
            <div class="mi-row"><i>02</i><input id="code" maxlength="5" placeholder="CÓDIGO"><button class="mi-go" id="join">Entrar</button></div>
            <button class="mi" id="train"><i>03</i>Treino contra o computador</button>
            <div class="err" data-err></div>
          </div>
        </section>
        <section class="hd-right"><canvas id="hero"></canvas><div class="ringbox" id="ringbox"></div></section>
        <footer class="hd-bottom" id="feat"></footer>
        <div class="hints"><span><kbd>ENTER</kbd> Selecionar</span><span><kbd>ESC</kbd> Voltar</span><a href="/admin">Admin</a></div>
      </div>`;
    const name = () => (document.getElementById('name') as HTMLInputElement).value.trim();
    document.getElementById('create')!.onclick = () => { initAudio(); setName(name()); net.send({ t: 'create', name: name() }); };
    document.getElementById('join')!.onclick = () => {
      initAudio(); setName(name());
      net.send({ t: 'join', code: (document.getElementById('code') as HTMLInputElement).value.trim().toUpperCase(), name: name() });
    };
    (document.getElementById('code') as HTMLInputElement).onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('join')!.click(); };
    document.getElementById('train')!.onclick = () => { initAudio(); startTraining(); };

    // atleta em destaque (gira entre os cadastrados)
    stopHero();
    hero = new Hero3D(document.getElementById('hero') as HTMLCanvasElement);
    let roster: AthleteInfo[] = DEMO_ATHLETES;
    let idx = 0;
    const feature = () => {
      const a = roster[idx % roster.length];
      idx++;
      hero?.set(a, 0xe8631a);
      const feat = document.getElementById('feat');
      const rb = document.getElementById('ringbox');
      if (!feat || !rb) return;
      feat.classList.remove('in'); void feat.offsetWidth; feat.classList.add('in');
      feat.innerHTML = `
        <div class="fmeta"><span>#${a.numero}</span><span>${esc(a.sala)}</span><span>${a.altura === 'P' ? 'BAIXO' : a.altura === 'M' ? 'MÉDIO' : 'ALTO'}</span></div>
        <div class="fname gold">${esc(a.nome.toUpperCase())}</div>
        <div class="fsub">${esc(a.apelido)} · atleta em destaque</div>
        ${curve(a)}
        <div class="fovr"><b class="gold">${a.overall}</b><span>OVERALL</span></div>`;
      rb.innerHTML = `<div class="rlabel">PERFIL DO ATLETA</div>${ring([['REB', a.attrs.rebote, '#ff3b4a'], ['PAS', a.attrs.passe, '#2bdc6b'], ['BLQ', a.attrs.bloqueio, '#2f7bff']])}`;
    };
    fetch('/api/roster').then((r) => (r.ok ? r.json() : [])).then((list: AthleteInfo[]) => {
      if (list.length) { roster = list.sort(() => Math.random() - 0.5); idx = 0; feature(); }
    }).catch(() => {});
    feature();
    heroTimer = window.setInterval(feature, 7000);
  }

  // ------------------------------------------------------------------ sala
  function renderRoom() {
    if (!room) return;
    const r = room;
    window.clearInterval(timer);
    if (r.phase === 'waiting') return waiting(r);
    if (r.phase === 'pick') return pick(r);
    if (r.phase === 'countdown' || r.phase === 'playing' || r.phase === 'over') return gameScreen(r);
  }

  function waiting(r: RoomView) {
    stopGame();
    showAero(false);
    const me = r.players[r.seat];
    const other = r.players[1 - r.seat];
    const host = r.seat === 0;
    const both = !!other;
    app.innerHTML = `
      <div class="screen dk"><div class="spot"></div><div class="card stack">
        <h2>Sala ${host ? 'criada' : 'encontrada'}</h2>
        <p class="sub">${host ? 'Passe este código para o adversário entrar:' : 'Você entrou! Aguarde o anfitrião iniciar a partida.'}</p>
        <div class="code" id="codebox">${r.code}</div>
        <button class="ghost" id="copy">Copiar código</button>
        <div class="lobby-players">
          <div class="lp"><span class="dot o"></span><b>${esc(r.players[0]?.name ?? '—')}</b><span class="pill ok">anfitrião${r.seat === 0 ? ' · você' : ''}</span></div>
          <div class="lp"><span class="dot b"></span><b>${r.players[1] ? esc(r.players[1].name) : 'Aguardando adversário…'}</b>${r.players[1] ? `<span class="pill ok">${r.seat === 1 ? 'você' : 'conectado'}</span>` : '<span class="pill warn">vazio</span>'}</div>
        </div>
        ${host ? `<button class="pri" id="start" ${both && other?.connected ? '' : 'disabled'}>${both ? 'Começar partida' : 'Aguardando o adversário…'}</button>` : '<div class="sub" style="text-align:center">Esperando o anfitrião clicar em “Começar partida”…</div>'}
        ${r.notice ? `<div class="notice">${esc(r.notice)}</div>` : ''}
        <div class="err" data-err></div>
        <button class="ghost" id="leave">Sair da sala</button>
      </div></div>`;
    void me;
    document.getElementById('copy')!.onclick = async () => { try { await navigator.clipboard.writeText(r.code); (document.getElementById('copy') as HTMLElement).textContent = 'Copiado!'; } catch { /* ok */ } };
    document.getElementById('start')?.addEventListener('click', () => net.send({ t: 'start' }));
    document.getElementById('leave')!.onclick = () => net.send({ t: 'leave' });
  }

  function athCard(a: AthleteInfo, sel: boolean, color: number) {
    return `<div class="ath ${sel ? 'sel' : ''}" data-id="${a.id}">
      <div class="ovr">${a.overall}</div>
      <img src="${portrait(a, color, 220)}" style="width:100%;height:120px;object-fit:contain;border-radius:10px;background:linear-gradient(#27394f,#16212f)">
      <div class="nm">${a.numero} · ${esc(a.apelido)}</div>
      <div class="meta">${esc(a.nome)} · ${esc(a.sala)} · ${a.altura === 'P' ? 'Baixo' : a.altura === 'M' ? 'Médio' : 'Alto'}</div>
      <div class="bars">${ATTR_KEYS.map((k) => `<div><b>${ATTR_LABELS[k]}</b><i><u style="width:${((a.attrs[k] - 25) / 74) * 100}%"></u></i><em>${a.attrs[k]}</em></div>`).join('')}</div>
    </div>`;
  }

  function pick(r: RoomView) {
    stopGame();
    showAero(false);
    const color = r.seat === 0 ? 0xe8631a : 0x1f6fe0;
    let sel = [...r.picked];
    const me = r.players[r.seat]!;
    const other = r.players[1 - r.seat];
    const draw = () => {
      const left = Math.max(0, Math.ceil(((r.deadline ?? 0) - Date.now()) / 1000));
      app.innerHTML = `
        <div class="screen dk"><div class="spot"></div><div class="card wide">
          <div class="row" style="align-items:flex-start">
            <div><h2>Escolha 2 dos 5 atletas</h2><p class="sub">Sala <b>${r.code}</b> · ${esc(me.name)} vs ${other ? esc(other.name) : '…'}</p></div>
            <div style="text-align:right"><div class="timer" id="tm">${left}s</div>
              <span class="pill ${other?.ready ? 'ok' : 'warn'}">${other?.ready ? 'Adversário pronto' : 'Adversário escolhendo…'}</span></div>
          </div>
          <div class="picks">${r.options.map((a) => athCard(a, sel.includes(a.id), color)).join('')}</div>
          <div class="row"><button class="ghost" id="leave" style="flex:0 0 auto">Sair</button>
            <button class="pri" id="ready" ${sel.length === 2 ? '' : 'disabled'}>${me.ready ? 'Cancelar (pronto)' : `Pronto (${sel.length}/2)`}</button></div>
          <div class="err" data-err></div>
        </div></div>`;
      app.querySelectorAll<HTMLElement>('.ath').forEach((el) => {
        el.onclick = () => {
          if (me.ready) return;
          const id = Number(el.dataset.id);
          sel = sel.includes(id) ? sel.filter((x) => x !== id) : sel.length < 2 ? [...sel, id] : [sel[1], id];
          net.send({ t: 'pick', ids: sel });
          draw();
        };
      });
      document.getElementById('ready')!.onclick = () => net.send({ t: 'ready', ready: !me.ready });
      document.getElementById('leave')!.onclick = () => net.send({ t: 'leave' });
    };
    draw();
    timer = window.setInterval(() => {
      const el = document.getElementById('tm');
      if (el) el.textContent = `${Math.max(0, Math.ceil(((r.deadline ?? 0) - Date.now()) / 1000))}s`;
    }, 250);
  }

  // ------------------------------------------------------------------ partida
  function ensureGameRoot() {
    if (gameRoot && gameRoot.isConnected) return gameRoot;
    showAero(false);
    app.innerHTML = '<div class="game" id="game"></div>';
    gameRoot = document.getElementById('game')!;
    return gameRoot;
  }

  function setOverlay(html: string | null, build?: (el: HTMLElement) => void) {
    overlay?.remove();
    overlay = null;
    if (!html || !gameRoot) return;
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = html;
    gameRoot.appendChild(overlay);
    build?.(overlay);
  }

  function gameScreen(r: RoomView) {
    const teams = r.teams!;
    const root = ensureGameRoot();
    const key = JSON.stringify([r.code, teams[0].map((a) => a.id), teams[1].map((a) => a.id)]);
    if (!view || key !== lastSnapKey) {
      view?.dispose();
      lastSnapKey = key;
      view = new GameView(root, teams, r.seat, [r.players[0]?.name ?? 'Jogador 1', r.players[1]?.name ?? 'Jogador 2'], {
        sendInput: (f: InputFrame) => net.send({ t: 'input', f }),
        rtt: () => net.rtt,
      });
      for (const s of pending.splice(0)) view.pushSnapshot(s);
    }
    window.clearInterval(timer);
    if (r.paused) {
      setOverlay('<h2>Adversário desconectado</h2><p class="sub" id="pz">Aguardando reconexão…</p>');
      view.setEnabled(false);
      timer = window.setInterval(() => {
        const el = document.getElementById('pz');
        if (el) el.textContent = `Aguardando reconexão… ${Math.max(0, Math.ceil(((r.deadline ?? 0) - Date.now()) / 1000))}s (depois vence por W.O.)`;
      }, 300);
      return;
    }
    if (r.phase === 'countdown') {
      view.setEnabled(false);
      const upd = () => {
        const n = Math.max(1, Math.ceil(((r.deadline ?? 0) - Date.now()) / 1000));
        setOverlay(`<div class="sub">${esc(r.players[0]?.name ?? '')} (laranja) vs ${esc(r.players[1]?.name ?? '')} (azul)</div><div class="big">${n}</div>`);
      };
      upd();
      timer = window.setInterval(upd, 200);
      return;
    }
    if (r.phase === 'playing') { setOverlay(null); view.setEnabled(true); return; }
    if (r.phase === 'over') {
      view.setEnabled(false);
      const won = r.winner === r.seat;
      const sc = lastScore();
      setOverlay(`<h2>${won ? '🏆 Você venceu!' : 'Você perdeu'}</h2>
        <div class="sub">${r.wo ? 'Vitória por W.O.' : `Placar final ${sc[0]} x ${sc[1]}`}</div>
        <div class="row" style="width:340px"><button class="pri" id="rem">${r.rematch?.[r.seat] ? 'Aguardando adversário…' : 'Revanche'}</button><button class="ghost" id="lv">Sair</button></div>`, (el) => {
        el.querySelector<HTMLElement>('#rem')!.onclick = () => net.send({ t: 'rematch' });
        el.querySelector<HTMLElement>('#lv')!.onclick = () => net.send({ t: 'leave' });
      });
    }
  }

  const lastScore = (): [number, number] => view?.score ?? [0, 0];

  function stopGame() {
    stopHero();
    view?.dispose(); view = null;
    training?.dispose(); training = null;
    overlay?.remove(); overlay = null;
    gameRoot = null; lastSnapKey = '';
    pending.length = 0;
  }

  // ------------------------------------------------------------------ treino
  async function startTraining() {
    const four = await drawFour();
    if (four.length < 4) { const e = document.querySelector<HTMLElement>('[data-err]'); if (e) e.textContent = 'Cadastre ao menos 4 atletas no admin para treinar.'; return; }
    stopGame();
    const teams: [AthleteInfo[], AthleteInfo[]] = [[four[0], four[1]], [four[2], four[3]]];
    const root = ensureGameRoot();
    const t = new TrainingSession(teams);
    training = t;
    view = new GameView(root, teams, 0, ['Você', 'Computador'], t);
    t.onSnap = (s) => { view?.pushSnapshot(s); };
    t.onOver = (w) => {
      view?.setEnabled(false);
      setOverlay(`<h2>${w === 0 ? '🏆 Você venceu o treino!' : 'O computador venceu'}</h2>
        <div class="row" style="width:340px"><button class="pri" id="again">Jogar de novo</button><button class="ghost" id="lv">Sair</button></div>`, (el) => {
        el.querySelector<HTMLElement>('#again')!.onclick = () => void startTraining();
        el.querySelector<HTMLElement>('#lv')!.onclick = () => home();
      });
    };
    // ESC volta ao menu
    const esc = (e: KeyboardEvent) => { if (e.code === 'Escape' && training) { window.removeEventListener('keydown', esc); home(); } };
    window.addEventListener('keydown', esc);
  }

  // se havia sessão salva, o servidor responde com a sala (ou 'left')
  if (net.session) {
    app.innerHTML = '<div class="screen"><div class="card"><h2>Reconectando à sala…</h2></div></div>';
    window.setTimeout(() => { if (!room) home(); }, 2500);
  } else home();

  // expõe para testes automatizados
  (window as unknown as { __hh: unknown }).__hh = { get view() { return view; }, get room() { return room; }, training: () => training };
}
