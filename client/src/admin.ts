// Painel do criador: login, lista de atletas, edição (overall manual, atributos, pele, cabelo, sala) com pré-visualização 3D.
import { ATTR_KEYS, ATTR_LABELS, AthleteInfo, BOTTOMS, DEFAULT_OUTFIT, HAIR_LABELS, HAIR_STYLES, OUTFIT_LABELS, SHOES, TOPS } from '../../shared/types';
import { Preview3D, portrait } from './preview';

const SKINS = ['#ffe0c7', '#f1c9a5', '#e0ac82', '#c68b62', '#a96f4a', '#8d5a3c', '#6b4128', '#3f2615'];
const HAIRS = ['#000000', '#1a120d', '#2b1b12', '#5a3220', '#a05a1c', '#d8a94a', '#b0151f', '#7a7a7a', '#f5f5f5'];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const blank = (): Omit<AthleteInfo, 'id'> & { id?: number } => ({
  nome: '', apelido: '', numero: 10, sala: '', overall: 70, altura: 'M',
  attrs: { arremesso3: 60, arremessoMedia: 60, finishing: 60, passe: 60, rebote: 60, defesa: 60, bloqueio: 60, drible: 60 },
  corPele: '#e0ac82', estiloCabelo: 'curto', corCabelo: '#1a120d', ...DEFAULT_OUTFIT, ativo: true,
});

async function api(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? 'Erro'), { status: r.status });
  return j;
}

export function initAdmin(app: HTMLElement) {
  document.title = 'Happy Hoops · Admin';
  let preview: Preview3D | null = null;

  async function boot() {
    try { await api('/api/admin/me'); await panel(); } catch { login(); }
  }

  function login(msg = '') {
    preview?.dispose(); preview = null;
    app.innerHTML = `
      <div class="screen dk"><form class="card stack" id="f">
        <div><h1 class="h1" style="font-size:44px">Área do <em>criador</em></h1><p class="sub">Área restrita ao criador do jogo.</p></div>
        <div><label>Senha</label><input type="password" id="pw" autocomplete="current-password" autofocus></div>
        <button class="pri" type="submit">Entrar</button>
        <div class="err" id="e">${esc(msg)}</div>
        <div class="foot"><a href="/">← Voltar ao jogo</a></div>
      </form></div>`;
    (document.getElementById('f') as HTMLFormElement).onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api('/api/admin/login', 'POST', { password: (document.getElementById('pw') as HTMLInputElement).value }); await panel(); }
      catch (e) { document.getElementById('e')!.textContent = (e as Error).message; }
    };
  }

  async function panel() {
    const me = await api('/api/admin/me');
    const dbKind: string = me.db?.kind ?? 'sqlite';
    const dbDesc: string = me.db?.describe ?? '';
    let list: AthleteInfo[] = await api('/api/admin/athletes');
    let cur: ReturnType<typeof blank> = blank();
    let msg = '';

    const render = () => {
      preview?.dispose(); preview = null;
      app.innerHTML = `
        <div class="screen dk" style="align-items:flex-start"><div class="admin">
          <div class="card">
            <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Atletas (${list.length})</h2><button class="pri" id="new" style="flex:0 0 auto">+ Novo</button></div>
            <div class="list">${list.map((a) => `
              <div class="li ${a.id === cur.id ? 'sel' : ''} ${a.ativo ? '' : 'off'}" data-id="${a.id}">
                <span class="n">${a.numero}</span><div><div>${esc(a.nome)}</div><div class="pill">${esc(a.sala)}</div></div><span class="o">${a.overall}</span>
              </div>`).join('') || '<p class="sub">Nenhum atleta ainda. Clique em “Novo”.</p>'}</div>
            <div class="dbinfo ${dbKind === 'sqlite' ? 'warn' : ''}">${dbKind === 'postgres'
              ? `Banco: ${esc(dbDesc)} — os atletas ficam salvos entre deploys.`
              : `Banco: ${esc(dbDesc)}. Se estiver hospedado sem disco persistente, os atletas somem a cada deploy: configure <b>DATABASE_URL</b> (Postgres). Faça backup!`}</div>
            <div class="row" style="margin-top:10px"><a class="btnlink" href="/api/admin/export" download>Exportar backup</a>
              <label class="btnlink" style="margin:0;text-transform:none;letter-spacing:0">Importar backup<input type="file" id="imp" accept="application/json,.json" hidden></label></div>
            <div class="foot"><a href="/">← Jogo</a> · <a href="#" id="out">Sair</a></div>
          </div>

          <div class="card">
            <h2>${cur.id ? 'Editar atleta' : 'Novo atleta'}</h2>
            <div class="grid2">
              <div><label>Nome completo</label><input id="nome" value="${esc(cur.nome)}" maxlength="60"></div>
              <div><label>Apelido (aparece no jogo)</label><input id="apelido" value="${esc(cur.apelido)}" maxlength="20"></div>
            </div>
            <div class="grid3">
              <div><label>Sala / turma</label><input id="sala" value="${esc(cur.sala)}" maxlength="20" placeholder="8º B"></div>
              <div><label>Camisa</label><input id="numero" type="number" min="0" max="99" value="${cur.numero}"></div>
              <div><label>Altura</label><select id="altura">${['P', 'M', 'G'].map((h) => `<option value="${h}" ${cur.altura === h ? 'selected' : ''}>${h === 'P' ? 'P (baixo)' : h === 'M' ? 'M (médio)' : 'G (alto)'}</option>`).join('')}</select></div>
            </div>
            <div class="slider" style="margin-top:14px"><b>Overall (manual)</b><input type="range" id="overall" min="25" max="99" value="${cur.overall}"><output id="o_overall">${cur.overall}</output></div>
            <label>Atributos (25–99)</label>
            ${ATTR_KEYS.map((k) => `<div class="slider"><span>${ATTR_LABELS[k]}</span><input type="range" data-attr="${k}" min="25" max="99" value="${cur.attrs[k]}"><output>${cur.attrs[k]}</output></div>`).join('')}
            <label>Cor da pele</label>
            <div class="row" style="gap:6px"><div class="swatches" id="skins">${SKINS.map((c) => `<div class="sw ${c === cur.corPele ? 'on' : ''}" data-c="${c}" style="background:${c}"></div>`).join('')}</div><input type="color" id="pele" value="${cur.corPele}" style="flex:0 0 60px"></div>
            <div class="grid2">
              <div style="grid-column:1 / -1"><label>Cabelo</label><div class="hairgrid" id="hairgrid"></div></div>
              <div style="grid-column:1 / -1"><label>Cor do cabelo</label><div class="row" style="gap:6px"><input type="color" id="cabelo" value="${cur.corCabelo}" style="flex:0 0 60px"><div class="swatches" id="hairs">${HAIRS.map((c) => `<div class="sw ${c === cur.corCabelo ? 'on' : ''}" data-c="${c}" style="background:${c}"></div>`).join('')}</div></div></div>
            </div>
            <div style="grid-column:1 / -1"><label>Camiseta</label><div class="hairgrid" id="topgrid"></div></div>
            <div style="grid-column:1 / -1"><label>Parte de baixo</label><div class="hairgrid" id="bottomgrid"></div></div>
            <div style="grid-column:1 / -1"><label>Tênis</label><div class="hairgrid" id="shoesgrid"></div></div>
            <label class="check"><input type="checkbox" id="ativo" ${cur.ativo ? 'checked' : ''}> Ativo (aparece nas escolhas do jogo)</label>
            <div class="row" style="margin-top:16px">
              <button class="pri" id="save">${cur.id ? 'Salvar alterações' : 'Criar atleta'}</button>
              ${cur.id ? '<button class="ghost" id="del" style="color:#ff8a8a">Excluir</button>' : ''}
            </div>
            <div class="err" id="msg" style="color:${msg.startsWith('✓') ? 'var(--ok)' : 'var(--bad)'}">${esc(msg)}</div>
          </div>

          <div class="card"><h2>Pré-visualização</h2><canvas class="preview" id="pv"></canvas><p class="sub" style="margin-top:10px">Arraste para girar. A cor do uniforme muda conforme o time na partida.</p></div>
        </div></div>`;
      bind();
    };

    const q = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    const sync = () => {
      cur.nome = q<HTMLInputElement>('nome').value; cur.apelido = q<HTMLInputElement>('apelido').value;
      cur.sala = q<HTMLInputElement>('sala').value; cur.numero = Number(q<HTMLInputElement>('numero').value);
      cur.altura = q<HTMLSelectElement>('altura').value as AthleteInfo['altura'];
      cur.overall = Number(q<HTMLInputElement>('overall').value);
      cur.corPele = q<HTMLInputElement>('pele').value; cur.corCabelo = q<HTMLInputElement>('cabelo').value;
      cur.ativo = q<HTMLInputElement>('ativo').checked;
      document.querySelectorAll<HTMLInputElement>('[data-attr]').forEach((el) => {
        cur.attrs[el.dataset.attr as keyof AthleteInfo['attrs']] = Number(el.value);
        (el.nextElementSibling as HTMLElement).textContent = el.value;
      });
      q('o_overall').textContent = String(cur.overall);
    };
    const updatePreview = () => { preview?.set({ ...(cur as AthleteInfo), id: cur.id ?? 0 }); drawHairs(); };
    let hairTimer = 0;
    const tiles = (gridId: string, items: string[], key: 'estiloCabelo' | 'roupaTop' | 'roupaBottom' | 'calcado', framing: 'head' | 'top' | 'bottom' | 'shoes', label: (i: string) => string) => {
      const grid = document.getElementById(gridId);
      if (!grid) return;
      grid.innerHTML = items.map((it) => `
        <button type="button" class="hairtile ${cur[key] === it ? 'on' : ''}" data-v="${it}" title="${label(it)}">
          <img src="${portrait({ ...(cur as AthleteInfo), id: 0, [key]: it } as AthleteInfo, 0xe8631a, 140, framing)}" alt="">
          <span>${label(it)}</span>
        </button>`).join('');
      grid.querySelectorAll<HTMLElement>('.hairtile').forEach((el) => {
        el.onclick = () => { (cur as Record<string, unknown>)[key] = el.dataset.v; updatePreview(); };
      });
    };
    const drawHairs = () => {
      window.clearTimeout(hairTimer);
      hairTimer = window.setTimeout(() => {
        tiles('hairgrid', HAIR_STYLES, 'estiloCabelo', 'head', (h) => HAIR_LABELS[h as keyof typeof HAIR_LABELS]);
        tiles('topgrid', TOPS, 'roupaTop', 'top', (h) => OUTFIT_LABELS[h as keyof typeof OUTFIT_LABELS]);
        tiles('bottomgrid', BOTTOMS, 'roupaBottom', 'bottom', (h) => OUTFIT_LABELS[h as keyof typeof OUTFIT_LABELS]);
        tiles('shoesgrid', SHOES, 'calcado', 'shoes', (h) => OUTFIT_LABELS[h as keyof typeof OUTFIT_LABELS]);
      }, 60);
    };

    function bind() {
      preview = new Preview3D(q<HTMLCanvasElement>('pv'));
      updatePreview();
      document.querySelectorAll<HTMLElement>('.li').forEach((el) => {
        el.onclick = () => { cur = structuredClone(list.find((a) => a.id === Number(el.dataset.id))!); msg = ''; render(); };
      });
      q('new').onclick = () => { cur = blank(); msg = ''; render(); };
      q<HTMLInputElement>('imp').onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          const r = await api('/api/admin/import', 'POST', data);
          list = await api('/api/admin/athletes');
          msg = `✓ Backup importado: ${r.adicionados} novos, ${r.ignorados} já existiam.`;
          render();
        } catch (err) { alert(`Não foi possível importar: ${(err as Error).message}`); }
      };
      q('out').onclick = async (e) => { e.preventDefault(); await api('/api/admin/logout', 'POST', {}); login(); };
      const onChange = () => { sync(); updatePreview(); };
      app.querySelectorAll('input, select').forEach((el) => { el.addEventListener('input', onChange); el.addEventListener('change', onChange); });
      document.querySelectorAll<HTMLElement>('#skins .sw').forEach((el) => {
        el.onclick = () => { q<HTMLInputElement>('pele').value = el.dataset.c!; document.querySelectorAll('#skins .sw').forEach((x) => x.classList.toggle('on', x === el)); onChange(); };
      });
      document.querySelectorAll<HTMLElement>('#hairs .sw').forEach((el) => {
        el.onclick = () => { q<HTMLInputElement>('cabelo').value = el.dataset.c!; document.querySelectorAll('#hairs .sw').forEach((x) => x.classList.toggle('on', x === el)); onChange(); };
      });
      q('save').onclick = async () => {
        sync();
        try {
          const saved: AthleteInfo = cur.id ? await api(`/api/admin/athletes/${cur.id}`, 'PUT', cur) : await api('/api/admin/athletes', 'POST', cur);
          list = await api('/api/admin/athletes');
          cur = structuredClone(saved); msg = '✓ Salvo!'; render();
        } catch (e) {
          if ((e as { status?: number }).status === 401) return login('Sessão expirada.');
          q('msg').textContent = (e as Error).message; q('msg').style.color = 'var(--bad)';
        }
      };
      const del = document.getElementById('del');
      if (del) del.onclick = async () => {
        if (!confirm(`Excluir ${cur.nome}?`)) return;
        await api(`/api/admin/athletes/${cur.id}`, 'DELETE');
        list = await api('/api/admin/athletes'); cur = blank(); msg = ''; render();
      };
    }
    render();
  }

  void boot();
}
