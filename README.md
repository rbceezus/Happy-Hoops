# Happy Hoops

Basquete de meia quadra **2v2 online**, jogado no navegador (teclado + mouse). Cada pessoa controla 2 atletas — alunos cadastrados pelo criador — num jogo até **5 pontos** (cesta de dentro do arco = 1, de fora = 2).

O planejamento completo está em [`PLANEJAMENTO.md`](PLANEJAMENTO.md).

## Rodando

Requer Node 22.5+ (usa o SQLite embutido do Node).

```bash
npm install
npm run build                      # compila o cliente em dist/
SEED_DEMO=1 npm start              # http://localhost:3000  (SEED_DEMO cria 8 atletas de exemplo se o banco estiver vazio)
```

Na primeira execução sem `ADMIN_PASSWORD`, o servidor gera uma senha para o `/admin` e a mostra **uma única vez** no terminal.

Desenvolvimento com recarga automática: `npm run dev:server` e, em outro terminal, `npm run dev:client` (abre em http://localhost:5173).

### Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `PORT` | porta (padrão 3000) |
| `ADMIN_PASSWORD` ou `ADMIN_PASSWORD_HASH` | senha do admin (o hash é `scrypt$salt$hash`) |
| `SESSION_SECRET` | segredo do cookie de sessão (se ausente, é gerado e salvo no banco) |
| `DATABASE_URL` | **recomendado em produção**: PostgreSQL (Render Postgres, Neon, Supabase). Os atletas sobrevivem a qualquer deploy |
| `DATABASE_SSL` | `1` força SSL, `0` desliga (padrão: automático) |
| `DB_PATH` | sem `DATABASE_URL`, usa SQLite neste arquivo (padrão `data/happy-hoops.db`) — só persiste com disco persistente |
| `TRUST_PROXY=1` | usar `X-Forwarded-For` para o limite de tentativas de login (atrás de proxy) |
| `COOKIE_SECURE=1` | força cookie `Secure` (já é automático com `X-Forwarded-Proto: https`) |
| `SEED_DEMO=1` | cria atletas de demonstração se o banco estiver vazio |

## Como jogar

1. **Criar sala** → passe o código de 5 letras ao adversário (ou **Treino** para jogar contra o computador).
2. Cada jogador recebe **5 atletas sorteados** e escolhe **2** (30 s). O mesmo aluno pode aparecer nos dois times.
3. Quem tem a posse aperta **Enter** para o check.

| Ação | Tecla |
|---|---|
| Mover / correr | **WASD** / **Shift** (gasta estamina) |
| Arremessar | **Espaço** segurado, solte no ponto verde do medidor |
| Pular (toco / rebote) | **Espaço** sem a bola |
| Crossover / giro | **Q** · **E** / **R** |
| Enterrar | segure **X** perto da cesta (até ~4,5 m) e **solte quando o atleta chegar no aro** (medidor de timing) |
| Passe normal / pingado | **F** ou clique esquerdo / **G** ou clique direito |
| Contestar (defesa) | basta ficar **perto** de quem arremessa; segurar **clique direito** (ou **C**) contesta um pouco mais |
| Trocar de atleta | **Tab** (no ataque, o controle passa a quem recebe o passe) |
| Som | **M** |

Regras: sem faltas nem roubos; defesa só contesta e dá toco. Depois de rebote defensivo é preciso **levar a bola para fora do arco** antes de arremessar. A posse fica com quem fez a cesta. Relógio de posse de 12 s.

## Estrutura

```
shared/   simulação autoritativa (regras, arremesso, toco, rebote, drible), bot, balanceamento (balance.ts), geometria da quadra
server/   HTTP + WebSocket (ws): admin (SQLite, login scrypt), salas/lobby, loop de jogo a 60 Hz (snapshots a 30 Hz)
client/   Three.js: cenário, atletas, câmera estilo 2K, HUD, sons (WebAudio), lobby, treino e admin
tests/    vitest: regras, simulação completa com bots, API admin e partida online por WebSocket
```

Todos os números de equilíbrio (janelas do medidor, chances, velocidades) estão em [`shared/balance.ts`](shared/balance.ts).

## Testes

```bash
npm test          # regras, simulações de partidas completas, API admin e fluxo online
npm run typecheck
```

## Publicação

O servidor entrega o cliente compilado **e** o WebSocket, então um único serviço com processo contínuo basta (Render, Fly.io, Railway…). A Vercel não mantém WebSocket aberto, então não serve para o servidor do jogo. Há um `Dockerfile` e um `render.yaml` prontos.

### Atletas sumindo a cada deploy?
Sem `DATABASE_URL`, o servidor usa SQLite num arquivo dentro do container, que é apagado a cada deploy (a não ser que exista um disco persistente). Solução: crie um banco PostgreSQL (no Render: **New → PostgreSQL**, plano free serve para testar; ou Neon/Supabase grátis), copie a **Internal Database URL** e coloque em `DATABASE_URL` no Web Service. O painel `/admin` mostra qual banco está em uso e tem **Exportar/Importar backup** (JSON).

### Deploy no Render
1. No Render: **New → Blueprint** e aponte para este repositório (branch `main`).
2. Quando pedir, preencha `ADMIN_PASSWORD` com uma senha forte (o `SESSION_SECRET` é gerado sozinho).
3. Confirme o plano **Starter** (o disco persistente de 1 GB em `/app/data` guarda os atletas) e a região mais perto dos jogadores.
4. Depois do deploy, abra `https://SEU-APP.onrender.com/admin`, entre com a senha e cadastre os atletas (mínimo 5 para as escolhas do lobby).

Mantenha **1 instância** (as salas ficam na memória) e não use o plano gratuito: ele dorme e não tem disco.
