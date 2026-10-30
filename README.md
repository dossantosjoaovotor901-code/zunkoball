# ZunkoBall

```
npm start            # http://localhost:8080  (precisa de Node 18+, sem dependências)
PORT=3000 FUTHUB_DATA=/caminho/dados TRUST_PROXY=1 npm start
```

## Backend (Node puro)
- `server.js` – HTTP: arquivos estáticos + API `/api/*`
- `server/db.js` – banco em `data/db.json` (gravação atômica). Troque por SQLite/Postgres se crescer.
- `server/auth.js` – senhas com scrypt, sessões por cookie HttpOnly (30 dias), limite de tentativas
- `server/ranking.js` – modos, capacidade humana, pontuação Elo, partidas abertas, ranking

| Rota | O que faz |
|---|---|
| `POST /api/register` `{username,password,nick?,avatar?}` | cria conta e entra |
| `POST /api/login` / `POST /api/logout` / `GET /api/me` | sessão |
| `PATCH /api/profile` `{nick,avatar}` · `POST /api/password` `{old,new}` | conta |
| `GET /api/modes` | modos, regras e faixas |
| `POST /api/queue/join` `{mode}` · `POST /api/queue/leave` | entra/sai da fila de um modo |
| `GET /api/queue/status` | `searching` (janela de patentes, fila) · `matched` (adversário) · `idle` |
| `POST /api/queue/accept` | confirma o adversário e abre a partida → `matchId` + regras |
| `POST /api/ranked/finish` `{matchId,red,blue}` ou `{matchId,abandon:true}` | fecha e pontua |
| `GET /api/ranking?mode=v3&limit=50` | ranking do modo (+ sua posição) |

## Ranqueada
- Depois de mudar qualquer arquivo em `server/` ou `server.js`, **reinicie o servidor** (o cliente novo com servidor antigo mostra "Rota não encontrada").
- Só conta se jogada pelo botão **Ranqueada** (menu com todos os modos). Jogo rápido e Salas nunca pontuam.
- Cada modo tem ranking e pontos próprios. Começa em 800; 18 patentes (Recruta → Imortal), uma a cada 100 pontos a partir de 900. Ícones em `game/ranks/`; nomes e faixas em `TIERS` (`server/ranking.js`).
- Pontos = Elo entre participantes humanos, K=48 nas 10 primeiras partidas e 32 depois, bônus por saldo de gols.
- Regras fixas por modo (Futsal 5 min/5 gols, Real 6 min/10 gols). Sair da partida, fechar a aba ou iniciar outra = derrota.

## Pareamento (`server/matchmaking.js`)
- Fila por modo. A busca começa só na sua patente; com o tempo a janela abre **primeiro para cima** (patente mais alta) e para baixo na metade da velocidade.
- A velocidade depende do nº de jogadores do modo: ≥200 abre 1 patente a cada 15s, ≥50 a cada 10s, ≥15 a cada 7s, menos que isso a cada 4s.
- Só fecha um grupo se todos os participantes humanos exigidos pelo modo estiverem dentro da janela uns dos outros. Não há adversário de reserva nem pontuação contra IA na ranqueada.
- Os pontos usam a nota do adversário humano. Cancelar a busca não penaliza; a partida só abre no servidor ao aceitar.

## Multiplayer online
Servidor headless autoritativo (WebSocket `/ws`, física compartilhada em `game/sim.js`, predição + reconciliação no cliente).
Veja **docs/MULTIPLAYER.md** (arquitetura, decisões, resultados dos testes). `npm test` e `npm run bench` rodam os testes.
Rotas novas: `GET/POST /api/rooms`, `GET /api/net/metrics` (localhost). Ranqueada humano×humano agora é online de verdade.

## Limite importante (anti-trapaça) — histórico (v12.2)
Atualização: partidas ranqueadas são exclusivamente humanas, simuladas e pontuadas pelo servidor.
O jogo roda no navegador, então o servidor **recebe** o placar; ele não o simula. Hoje valida: partida aberta pelo
servidor (uso único), dono da partida, placar dentro do limite, tempo mínimo/máximo plausível e fim por tempo ou
por limite de gols. Isso barra o abuso fácil, mas um jogador técnico ainda pode forjar um placar válido.
Para salas com arbitragem, a física autoritativa também controla a contagem de reinício, a posse após gol, a barreira central, a prorrogação e o gol de ouro.

## Arbitragem competitiva

Salas online podem ativar arbitragem automática no formulário de criação. A configuração fica no servidor e inclui prorrogação configurável e gol de ouro. Quando ativa, a simulação mantém a bola no centro durante a contagem de reinício, entrega a posse ao time que sofreu o gol e aplica uma barreira física central ao time sem posse. Empate persistente termina como empate.

Rotação de times, fila de espera e seleção alternada de jogadores ainda não estão concluídas nesta entrega; não são simuladas nem apresentadas como implementadas.

## Replays (`server/replay.js`, `game/replay.js`)
Grava partidas e permite reassistir, baixar e importar, no formato **`.fhreplay`** (JSON versionado, `formatVersion: 1`).

- **Partidas online** são gravadas no servidor a partir do estado autoritativo (`game/sim.js`): amostra 1 quadro a cada 3 ticks (~20 Hz) e registra os eventos (gol, apito, trave, rede, lateral). Salvas em `data/replays/<id>.fhreplay`; o índice (sem quadros) fica no banco.
- **Partidas locais / contra a IA** são gravadas no próprio cliente (`FH_REC`), no mesmo formato, e guardadas no navegador (IndexedDB). Funcionam 100% offline depois de baixadas.
- Tela **Replays** (botão na Home): lista partidas online + locais, com **Assistir**, **Baixar** (`.fhreplay`) e **Apagar**, além de **Importar** um arquivo salvo.
- **Player**: play/pause, reiniciar, barra de tempo (seek) e velocidades **0,25× a 4×**, com interpolação de quadros e sons de chute/gol. Reusa `draw()` do `game.js` (nada de física nova).

### Limites de armazenamento (variáveis de ambiente)
- `FUTHUB_REPLAY_SAMPLE` (padrão 3) — quadros por amostra (ticks).
- `FUTHUB_REPLAY_MIN_TICKS` (360 = 6 s) — descarta partidas curtas (abandono imediato).
- `FUTHUB_REPLAY_MAX_BYTES` (8 MB), `FUTHUB_REPLAY_MAX_FRAMES` (60000), `FUTHUB_REPLAY_MAX_EVENTS` (30000).
- `FUTHUB_REPLAY_MAX_PER_USER` (50) e `FUTHUB_REPLAY_MAX_TOTAL` (3000) — mantêm só os mais recentes.

### Rotas
- `GET /api/replays` — lista os replays do jogador logado (só os que ele participou).
- `GET /api/replays/:id/file` — baixa/toca o `.fhreplay` (só participante).
- `GET /api/replays/:id` / `DELETE /api/replays/:id` — ler metadados / apagar (só participante).

### Testes
`node test/replay.js` (incluído no `npm test` e no `npm run test:unit`) cobre, em Node puro: Recorder + `build()`, `validate()`, `ReplayStore` (disco, índice por participante, proteção de acesso, limite por jogador) e a integração com a `Room`. **24 testes passam.**
