# Happy Hoops: planejamento do MVP

Jogo de basquete de meia quadra **2v2 online**, feito para navegador no computador. Duas pessoas jogam uma contra a outra e cada uma controla 2 atletas. Os atletas são alunos cadastrados pelo criador do jogo.

---

## 1. Escopo do MVP

### Entra no MVP
- 1 partida 2v2 online entre 2 pessoas, com cada pessoa controlando 2 atletas (troca de controle entre eles).
- Lobby por **código de sala** e jogo sem login para quem joga.
- Painel admin protegido (apenas o criador) para fazer o CRUD dos atletas.
- Movimento, corrida, 2 dribles (crossover e giro), arremesso com timing, 2 tipos de passe, contestação, toco e rebote por timing.
- Sons: chuá, aro, toco e ankle breaker.
- Câmera fixa atrás do ataque, de frente para a cesta (detalhes na seção 6).

### Fica fora do MVP (vai para o backlog)
- Faltas, roubos de bola, interceptação de passe, enterrada animada, alley-oop.
- Jogar contra IA, modo treino com bot, ranking, histórico de partidas, estatísticas por aluno.
- Celular, controle (gamepad) e espectadores.
- Contas de usuário.

> **Sugestão:** colocar um **modo treino offline** (1 pessoa, sem adversário) logo depois do MVP. Ele ajuda muito a calibrar o timing do arremesso sem precisar de 2 pessoas online.

---

## 2. Regras da partida

| Regra | Definição |
|---|---|
| Formato | Meia quadra, 2v2 |
| Pontuação | Cesta de dentro do arco = **1 ponto**; cesta de fora do arco = **2 pontos** |
| Vitória | Primeiro a **5 pontos**. *(Decidir: vale "ganhar por 2"? Recomendo **não** no MVP.)* |
| Posse após cesta | **Troca de posse** (padrão). *(Alternativa: "quem faz, sai jogando". Fica configurável.)* |
| Check ball | Toda posse nova começa com **check** no topo do garrafão: o defensor "devolve" a bola e o jogo fica vivo |
| Bola que bateu no aro | Rebote do **ataque**: pode arremessar direto. Rebote da **defesa**: precisa **limpar** (levar a bola para fora do arco) antes de pontuar |
| Air ball (não tocou no aro) | Rebote do ataque: **reset do relógio, sem precisar limpar**. Rebote da defesa: precisa limpar |
| Cesta sem limpar | **Não vale**: a posse passa para o outro time com check |
| Tempo de posse | **12 s** (cronômetro curto para não travar o jogo). Estourou: troca de posse com check |
| Fora da quadra | Bola ou jogador com a bola fora das linhas: troca de posse com check |
| Faltas e roubos | **Não existem**. A defesa só pode **contestar** e **dar toco** |
| Colisão | Jogadores não atravessam uns aos outros (corpo bloqueia corpo), mas não há falta |

> Interpretei "se bater no aro volta e faz cheque" assim: **a defesa que pega o rebote precisa limpar a bola**. Se a sua ideia era outra (por exemplo, todo rebote defensivo volta para o check no topo), basta trocar essa regra. As duas opções ficam simples de implementar como configuração.

### Estados da partida (máquina de estados no servidor)
```
LOBBY → CHECK → BOLA_VIVA → ARREMESSO_NO_AR → (CESTA | REBOTE)
                    ↑                              │
                    └──── LIMPAR (se defesa) ←─────┘
CESTA → (placar ≥ 5 ? FIM_DE_JOGO : CHECK do outro time)
```

---

## 3. Controles (teclado e mouse)

| Ação | Ataque | Defesa |
|---|---|---|
| Mover | **WASD** | **WASD** |
| Correr | **Shift** (segurar; gasta estamina) | **Shift** |
| Crossover | **Q** (para a esquerda) / **E** (para a direita) | — |
| Giro (spin) | **R** | — |
| Arremesso | **Espaço**: segurar e **soltar no ápice** do medidor | — |
| Passe normal | **Clique esquerdo** ou **F** (vai para o companheiro) | — |
| Passe pingado | **Clique direito** ou **G** | — |
| Trocar de atleta | Automático (você passa a controlar quem recebe o passe) | **Tab** (troca de defensor) |
| Contestar | — | **Segurar Clique direito** perto do arremessador (mão alta) |
| Pular (toco/rebote) | **Espaço** quando estiver sem a bola | **Espaço** |
| Pedir check | **Enter** no estado CHECK | — |

- **Estamina:** correr gasta estamina, e com ela baixa o atleta fica mais lento e o arremesso perde precisão (−5% a −15%). Isso evita que alguém corra o tempo todo.
- **Companheiro sem controle:** no ataque ele fica parado no spot ou se move entre spots simples (canto e ala). Na defesa ele **segue o atacante mais próximo**, sem IA complexa.

---

## 4. Atributos e fórmulas

### 4.1 Atributos (escala 25–99)
`arremesso_3`, `arremesso_media`, `finishing`, `passe`, `rebote`, `defesa`, `bloqueio`, `drible`

O **overall** é **manual** e serve só para exibição (cartinha do atleta). Ele **não** entra em nenhuma fórmula.

> **Sugestão:** adicionar **altura** (P/M/G) como atributo visual com efeito pequeno (+/− alcance no toco e no rebote). É opcional e posso deixar de fora.

Normalização usada nas fórmulas: `n(attr) = (attr − 25) / 74` → de 0 a 1.

### 4.2 Arremesso (timing no estilo 2K)
1. O jogador segura Espaço e o medidor sobe. Ele solta perto do **ápice**.
2. O erro de timing (`Δt`, em ms) define a nota do lançamento:

| Faixa | Janela base | Efeito |
|---|---|---|
| **Perfeito** (verde) | ±(25 + 35·n(attr)) ms | chance × 1,35 |
| Bom | até 2× a janela verde | chance × 1,0 |
| Ruim | até 4× | chance × 0,55 |
| Muito cedo/tarde | resto | chance × 0,15 |

O atributo usado é `arremesso_3` fora do arco, `arremesso_media` na média distância e `finishing` perto da cesta (menos de 2,5 m, bandeja ou floater).

3. **Chance final:**
```
chance = base_zona(attr) × mult_timing × mult_contestação × mult_movimento × mult_estamina
base_zona(attr): bandeja 0,45→0,80 | média 0,30→0,60 | três 0,22→0,52   (interpolado por n(attr))
mult_contestação = 1 − (0,55 × n(defesa_defensor) × fator_distância × fator_mão_alta)
mult_movimento  = 0,85 se arremessar correndo ou de costas; 1,0 parado
```
- O **verde perfeito sem contestação** tem acerto praticamente garantido (limitado a 0,98), assim como no 2K.
- O resultado é sorteado **no servidor**. O cliente só mostra a animação.

### 4.3 Toco
O defensor pula dentro de uma janela em relação ao momento da soltura e precisa estar a ≤ 1,2 m do arremessador.
```
chance_toco = 0,05 + 0,50 × n(bloqueio) × fator_timing_pulo × fator_distância − 0,20 × n(finishing ou arremesso do atacante)
```
Em caso de sucesso, toca o **som de toco**, a bola fica solta e vira disputa de rebote. Em arremessos de três o toco é bem mais difícil (multiplicador 0,4).

### 4.4 Rebote
A bola sai do aro com uma trajetória calculada. Quem pular mais perto do **momento ideal** (a bola descendo na altura do alcance) ganha a disputa:
```
nota_rebote = 0,45 × timing (0–1) + 0,35 × n(rebote) + 0,20 × posição (proximidade da bola)
```
O maior valor pega a bola. Se ninguém pular, a bola quica e o primeiro que encostar fica com ela.

### 4.5 Drible e ankle breaker
- O crossover e o giro geram um deslocamento rápido (giro mais longo e mais lento, crossover curto e rápido) com **cooldown** de 0,8 s.
- Se houver um defensor a ≤ 1,5 m **na frente**:
```
chance_quebrar = 0,10 + 0,45 × n(drible) − 0,35 × n(defesa)
```
- **Sucesso:** o defensor fica "travado" por 0,4 s. Se o resultado for muito alto (≥ 85% da faixa) acontece o **ankle breaker**: o defensor cai por 1,2 s, toca o som de ankle breaker e aparece uma câmera lenta curta.
- **Falha:** o atacante perde velocidade por 0,3 s. Não há roubo, então ele nunca perde a bola.

### 4.6 Passe
Não há interceptação, então o passe **sempre chega**, mas a qualidade muda o resultado:
- **Normal:** rápido e em linha reta.
- **Pingado (quicado):** passa por baixo da mão alta do defensor no meio do caminho. Sem ele, o passe normal com defensor no meio da linha fica mais lento e vai "na altura errada".
- `n(passe)` define a velocidade da bola e a chance de o recebedor já ficar **pronto para arremessar**. Um passe ruim obriga o recebedor a "ajeitar" a bola (0,3 s de atraso).

### 4.7 Defesa no corpo a corpo
O atributo `defesa` também define a velocidade lateral do defensor e o raio que ele bloqueia com o corpo. Assim a defesa tem efeito mesmo sem contestar.

> Todos os números acima são o **ponto de partida para o balanceamento**. Eles ficam num arquivo `balance.json` para ajustar sem mexer no código.

---

## 5. Painel admin (somente o criador)

- Rota `/admin` com login de **usuário único**. A senha fica com hash (bcrypt) em variável de ambiente e **não existe cadastro**.
- A sessão usa cookie httpOnly com JWT de expiração curta. Há limite de tentativas no login (por exemplo, 5 por 15 min) e HTTPS obrigatório.
- **CRUD de atleta:**
  - Nome, apelido, número da camisa
  - **Sala/turma** (ex.: "8º B")
  - **Overall** (manual, de 25 a 99)
  - 8 atributos (sliders de 25 a 99)
  - **Cor de pele** (paleta com ~8 tons + seletor livre)
  - **Cabelo**: estilo (careca, curto, black power, tranças, moicano, coque) + cor
  - Foto/avatar opcional (fora do MVP)
- O admin mostra uma **pré-visualização 3D** do atleta enquanto ele é editado.
- O admin pode **ativar ou desativar** um atleta (desativado não aparece no lobby).

---

## 6. Câmera e visual

- **Câmera fixa** atrás do ataque, olhando **de frente para a cesta**, um pouco elevada (aprox. 35°). A quadra inteira fica visível, como no modo 2K "Broadcast" virado para a tabela.
- *(Ainda não recebi a foto de referência. Assim que você enviar, eu ajusto a altura, o ângulo e o FOV.)*
- Estilo **low-poly 3D**: é leve no navegador e facilita trocar a cor de pele, o cabelo e o uniforme por material ou cor, sem precisar desenhar sprites para cada combinação.
- Na tela aparecem:
  - placar
  - relógio de posse
  - medidor de arremesso ao lado do atleta
  - indicador de quem você controla (anel no chão)
  - aviso "LIMPE A BOLA" quando a posse precisa ser limpa
- Cores dos times: o anfitrião é laranja e o convidado é azul (cor do uniforme).

---

## 7. Lobby e multiplayer

### Fluxo
1. A página inicial tem os botões **Criar sala** e **Entrar com código**.
2. Criar sala gera um **código de 5 caracteres** (sem letras ambíguas: sem 0/O e 1/I) e a pessoa informa um apelido.
3. O convidado entra com o código e as duas pessoas escolhem **2 atletas cada** na lista de alunos.
   - *(Decidir: o mesmo aluno pode aparecer nos dois times? Recomendo **não**: quem escolher primeiro fica com ele.)*
4. Os dois clicam em **Pronto**, a contagem regressiva começa e o jogo inicia com check.
5. No fim do jogo aparecem as opções **Revanche** (mesma sala) ou **Sair**.

### Regras da sala
- Máximo de 2 pessoas. A sala expira depois de 10 min sem atividade.
- **Reconexão:** se alguém cair, o jogo pausa e a pessoa tem 30 s para voltar com o mesmo token salvo no navegador. Se não voltar, o adversário vence por W.O.

### Rede (servidor autoritativo)
- O **servidor** roda a simulação a 30 ticks/s e decide todos os resultados (arremesso, toco, rebote, drible). Isso impede trapaça pelo console do navegador.
- O cliente envia **apenas os inputs** (teclas e o momento em que soltou o arremesso).
- O cliente usa **predição** para o próprio movimento e **interpolação** para os outros atletas.
- O timing do arremesso é medido **no cliente com carimbo de tempo** e validado no servidor com compensação de ping. Sem isso, ping alto atrapalharia o verde.

---

## 8. Stack técnica recomendada

| Camada | Escolha | Motivo |
|---|---|---|
| Frontend | **TypeScript + Vite + Three.js** | 3D leve, câmera livre, materiais com cor customizável |
| UI (lobby/admin) | React | Formulários e telas do admin |
| Multiplayer | **Colyseus** (Node.js) | Salas, códigos, sincronização de estado e reconexão já prontos |
| Banco | **PostgreSQL** (Supabase ou Neon) ou SQLite no início | Só tabela de atletas e admin |
| Física | Própria e simples (bola parabólica + colisão com aro/tabela) | Mais previsível e fácil de balancear do que uma engine de física completa |
| Áudio | Howler.js | Sons com variação de pitch/volume |
| Hospedagem | Front na **Vercel**; servidor de jogo no **Render, Fly.io ou Railway** | A Vercel não mantém WebSocket persistente, então o servidor do jogo precisa ficar fora dela |

### Estrutura de pastas
```
/client      → jogo (Three.js), lobby, admin (React)
/server      → Colyseus: salas, simulação, regras, API admin
/shared      → tipos, constantes, balance.json, fórmulas (usadas pelo servidor e pela pré-visualização)
/assets      → modelos .glb, sons .ogg/.mp3
```

### Modelo de dados
```ts
Player {
  id, nome, apelido, numero, sala,
  overall,                     // manual
  arremesso3, arremessoMedia, finishing, passe,
  rebote, defesa, bloqueio, drible,   // 25–99
  corPele, estiloCabelo, corCabelo,
  ativo, criadoEm, atualizadoEm
}
```

---

## 9. Sons

| Evento | Som |
|---|---|
| Cesta limpa | **Chuá** (rede) |
| Bola no aro (com ou sem cesta) | **Aro** (variar o pitch para não ficar repetitivo) |
| Toco | **Toco** (impacto + reação) |
| Ankle breaker | **Ankle breaker** (efeito + "ooooh" curto) |
| Extras (baratos e ajudam a sensação) | quique da bola, tênis rangendo, apito do relógio de posse, buzina do fim de jogo |

Os sons podem vir de bancos **CC0** (freesound.org com filtro CC0, ou Kenney.nl) para evitar problema de licença.

---

## 10. Fases de desenvolvimento

| Fase | Entrega | Critério de pronto |
|---|---|---|
| **0. Base** | Repositório, Vite + Three.js, quadra, cesta e câmera | Quadra renderizada com a câmera da foto |
| **1. Movimento local** | 1 atleta com WASD, Shift, estamina e colisão | O atleta anda e corre com resposta boa (< 50 ms) |
| **2. Arremesso e física** | Medidor, trajetória, aro, tabela, chuá e aro | Dá para treinar arremesso offline e o verde é perceptível |
| **3. Regras** | Máquina de estados, check, limpar, relógio, placar até 5 | Uma partida completa local (hotseat ou bots parados) |
| **4. Mecânicas** | Passe ×2, drible ×2, contestação, toco, rebote, ankle breaker | Todas as fórmulas da seção 4 rodando com `balance.json` |
| **5. Admin + BD** | Login, CRUD, pré-visualização de pele e cabelo | Atleta criado no admin aparece no jogo com as cores certas |
| **6. Online** | Colyseus, código de sala, seleção, servidor autoritativo, reconexão | 2 computadores diferentes jogam uma partida inteira |
| **7. Polimento** | Sons, HUD, câmera lenta no ankle breaker, revanche, balanceamento | 10 partidas de teste sem bug que trave o jogo |
| **8. Deploy** | Front na Vercel e servidor no Render/Fly | Link público funcionando |

Fazer as fases 1 a 4 **offline primeiro** deixa a jogabilidade boa antes de enfrentar a complexidade da rede. Mesmo assim, o código já fica organizado para a simulação rodar no servidor (lógica em `/shared`).

---

## 11. Riscos e cuidados

- **Ping e timing do arremesso:** é o maior risco para a sensação de "2K". A mitigação é o carimbo de tempo no cliente, a compensação no servidor e o teste com ping simulado (150 ms).
- **Balanceamento:** sem números ajustáveis o jogo fica fácil ou impossível. Por isso tudo fica no `balance.json` e há um modo treino para testar.
- **Animações:** são o trabalho mais caro. No MVP dá para usar um modelo low-poly único com poucas animações (Mixamo tem animações gratuitas) e trocar só cores e cabelo.
- **Dados dos alunos:** como são menores de idade, o jogo mostra só nome/apelido e turma, sem foto real e sem dado sensível no MVP.

---

## 12. Decisões em aberto (preciso da sua resposta)

1. **Foto da câmera:** envie a foto para eu ajustar o ângulo.
2. **Posse após cesta:** troca de posse ou "quem faz, sai jogando"?
3. **Ganhar por 2** ou o primeiro a 5 vence direto?
4. **Rebote defensivo:** precisa limpar fora do arco (minha interpretação) ou volta direto para o check no topo?
5. **Mesmo aluno nos dois times:** é permitido?
6. **Altura** como atributo extra: sim ou não?
7. **Teclas:** o mapa da seção 3 está bom ou você prefere outro (por exemplo, arremesso no J/K)?
