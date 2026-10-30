# FutHub — Multiplayer online (arquitetura, decisões e resultados)

Este documento acompanha a implementação do multiplayer online. Tudo que está aqui foi medido ou testado no código entregue;
o que é hipótese está marcado como **[hipótese]**.

## 1. Diagnóstico da arquitetura anterior (v12.2.1)

| Pergunta | Resposta (lida no código) |
|---|---|
| Como as salas são criadas? | `doCreate` em `game.js` só muda variáveis locais e mostra a tela da sala. **Não existe sala no servidor**; a lista de salas era sempre vazia (`#refresh` escrevia "0 jogadores em 0 salas"). |
| Como os jogadores se conectam? | Não se conectam. Cada partida tem 1 humano + 1 IA (`engine.players[1]`). O servidor (`server.js`) só serve arquivos e a API de contas/fila/ranking (HTTP). |
| Onde a física roda? | 100% no navegador, em `physics(dt)` (`game.js`), junto com sons, IA, regras e desenho. |
| Sincronização do estado? | Inexistente. O fim da ranqueada era um `POST /api/ranked/finish` com o placar que o próprio navegador informa (o README já admitia que dá para forjar). |
| Gargalos / riscos | (1) **`dt` variável**: `loop()` usa `dt = min(.033, Δt)` do `requestAnimationFrame`; amortecimento (`1 - damping*dt`) e chute (`impulseWithKick*2.62*dt*60`) dependem de `dt`, então **o FPS altera o resultado da física**. (2) Física, regras, áudio e desenho misturados na mesma função, impossível reutilizar no servidor. (3) Rede da goleira (visual) usa `Math.exp`/ruído e `Math.random`. (4) Pareamento da ranqueada achava humanos, mas a partida em campo era contra IA. |

## 2. O que se sabe (e o que não se sabe) sobre o HaxBall

**Verificado** (wiki do *Headless Host*, espelho em github-wiki-see; não consegui abrir o original):
o host sem interface roda num navegador (Chrome), é controlado só por uma API JavaScript (`HBInit`), "não desenha nem toca sons", expõe eventos a 60 ticks/s, aceita `token` para pular o reCAPTCHA e uma flag do Chrome relacionada a WebRTC (`WebRtcHideLocalIpsWithMdns`) — ou seja, WebRTC aparece na conexão dos jogadores.

**Não verificado [hipótese]:** quem calcula a física (parece ser o host, com os clientes recebendo entradas/estado e predizendo), uso de DataChannel não confiável, STUN/TURN próprios, frequência exata de envio. A página não diz isso. Por isso **nada** da decisão abaixo depende de "o HaxBall faz assim"; ela se baseia nos requisitos do FutHub.

## 3. Host: comparação e escolha

| Critério | Host jogador (P2P) | Servidor dedicado | Servidor **headless** dedicado (escolhido) |
|---|---|---|---|
| Latência | Boa para quem está perto do host; ruim para os outros e o host tem ping 0 | Igual para todos; escolhe-se a região | Igual para todos; sem custo de render |
| Justiça | Host tem vantagem (ping 0) e **pode adulterar física/placar** | Autoritativo: ninguém manipula | Idem |
| Estabilidade | Se o host cai, a sala morre (ou precisa migrar estado) | Independe de jogador | Idem |
| Custo | Zero | Servidor por região | Muito baixo: a sala do FutHub usa ~7–170 µs por tick (ver §8) |
| Segurança | Host vê IPs dos outros; sem validação confiável | Validação central | Idem |
| Manutenção | Complexa (NAT, TURN, migração) | Simples | Simples: mesmo `sim.js` do cliente, sem DOM |

**Escolha: servidor headless autoritativo em Node** (`server/room.js` + `game/sim.js`). Motivos: (a) o ranking competitivo exige resultado que o jogador não possa forjar; (b) tira a vantagem de ping 0 do host; (c) sala não morre quando o "dono" sai — a **migração do dono é trivial** (o servidor passa a administração ao jogador mais antigo; a partida não é interrompida; testado); (d) o código de física já era JavaScript puro, então pôde ser extraído para rodar igual no servidor e no cliente sem reescrever em outra linguagem.

Host jogador **não** foi implementado. Se um dia for necessário para reduzir custo, as perguntas abertas são: como impedir adulteração (o host é o único que roda a simulação) e como migrar o estado quando ele cai — ambas resolvidas de graça pelo modelo escolhido.

## 4. Arquitetura implementada

```
 Navegador (game.js + online.js)                         Servidor Node (server.js)
 ┌──────────────────────────────┐   WebSocket /ws       ┌───────────────────────────────────┐
 │ netclient.js                 │ ───── entradas ─────► │ gameserver.js  (agendador 60 Hz)  │
 │  - passo fixo 60 Hz          │   (binário, 7 B/tick, │  └ room.js  (1 por sala)          │
 │  - predição local (sim.js)   │    8 últimas c/       │     - fila de entradas por jogador│
 │  - reconciliação (rollback)  │    redundância)       │     - valida, limita, descarta    │
 │  - suavização do erro        │ ◄──── snapshots ───── │     - sim.js (MESMA física)       │
 │  - interpolação (espectador) │   (binário delta 30Hz)│     - snapshot delta por cliente  │
 │  - métricas (ping, jitter..) │ ◄──── JSON ───────────│     - eventos, chat, placar, fim  │
 └──────────────────────────────┘   (controle/eventos)  └───────────────────────────────────┘
```

**Física compartilhada (`game/sim.js`)** — mesmas constantes/fórmulas do `physics()` original (velocidade 4.9, máx 6.35, chute `impulseWithKick*2.62*dt*60 + ballPower*40`, paredes, traves, rede, Real Soccer), mas: **passo fixo de 1/60 s** (nunca usa o FPS), determinística (só `+ − × ÷ sqrt`, sem `Math.random`/`exp`/`hypot`), estado arredondado para float32 a cada tick (o snapshot é **idêntico** ao estado interno), sem efeitos colaterais (sons/partículas viram eventos). Generalizada de 1 jogador+IA para N jogadores.

**Autoridade e anti-trapaça** (`room.js`): o cliente só envia *entradas* (direção int8, chute, passe); nunca posição, placar ou tempo. O servidor consome **1 entrada por tick** por jogador (não dá para acelerar com speed-hack: o excesso é descartado, preservando chutes — testado), ignora seq repetida/antiga, rejeita pacotes malformados, limita taxa (150 msg/s), tamanho (2 KB), conexões por IP e por servidor, sanitiza nick/chat, valida senha/lotação e só aceita na ranqueada os dois usuários do pareamento. Gols, placar, tempo e fim de jogo são decididos só no servidor.

**Latência de um jogador não prejudica os outros:** o servidor nunca espera ninguém. Se a entrada de alguém atrasa, o servidor repete a última *direção* (nunca o chute) e segue; quando chega rajada, descarta o excesso. O jogador lento sofre correções; os outros não percebem.

**Predição e reconciliação (`netclient.js`):** o jogador local roda `sim.js` ao apertar a tecla. A cada snapshot (tick S, última entrada confirmada A): restaura o estado autoritativo, reexecuta as entradas > A e compara com o que previa (erro de predição). Jogadores remotos são extrapolados com a última entrada deles (vai no snapshot). A diferença visual vira um *offset* que decai em ~60 ms; a **simulação nunca é falsificada**, só a apresentação é suavizada. Espectadores (sem vaga) usam interpolação de snapshots com atraso de 100 ms.

**Controle de ritmo:** o servidor informa quantas entradas suas estão na fila; o cliente acelera/desacelera até ±6 % para manter a fila em ~2 ticks (sem congelar controles).

**FPS desacoplado:** acumulador de passo fixo. Testado: física idêntica de 20 a 240 FPS.

**Rede:** WebSocket próprio (RFC 6455, sem dependências). Snapshot **delta binário** (só entidades que mudaram; keyframe a cada 2 s e ao entrar/ressincronizar), 30 Hz (20 Hz em salas > 12 pessoas). Contrapressão: se o socket do cliente acumula > 64 KB, o servidor pula snapshots em vez de enfileirar. Reconexão automática do cliente (backoff 0,4→4 s, 8 tentativas); sem nada do servidor por 1,5 s aparece "Conexão instável", por 6 s força reconexão.

**WebSocket × WebRTC (decisão):** WebSocket porque o servidor é autoritativo (não há P2P a estabelecer), atravessa proxies/CDN/TLS sem STUN/TURN, não tem dependências e é simples de operar. **Custo conhecido:** é TCP — sob perda de pacotes há bloqueio de cabeça de fila (um pacote perdido atrasa os seguintes). Mitigações implementadas: TCP_NODELAY, mensagens pequenas, redundância de entradas, descarte de snapshots velhos por contrapressão. **Próximo passo recomendado (não implementado):** DataChannel WebRTC não confiável/não ordenado entre navegador e o servidor (ex.: `werift`/`node-datachannel`), reaproveitando exatamente o mesmo protocolo binário (`proto.js`) — o único trecho acoplado ao transporte é `ws.js`/`online.js`.

**Ranqueada humano × humano:** `matchmaking.js` agora cria um *pair*; no primeiro "aceitar" nasce a sala autoritativa; a partida começa quando os dois conectam (25 s) ; queda tem tolerância de 20 s e depois é W.O. (derrota para quem saiu). O resultado é aplicado por `ranking.finishAuthoritative()` — **sem** confiar em placar vindo do navegador. Se o adversário nunca confirmou, a partida é anulada sem pontos. Partida contra IA de reserva continua local como antes.

## 5. Arquivos

| Arquivo | O que mudou |
|---|---|
| `game/sim.js` (novo) | física autoritativa compartilhada |
| `game/proto.js` (novo) | protocolo binário (entradas, snapshot delta, ping) |
| `game/netclient.js` (novo) | predição, reconciliação, interpolação, métricas |
| `game/online.js` (novo) | liga UI existente ao online: lista de salas, criar/entrar, sala de espera, partida, reconexão, HUD de ping |
| `server/ws.js`, `server/room.js`, `server/gameserver.js`, `server/maps.js` (novos) | WebSocket, sala, agendador/registro, carregador dos mapas |
| `server.js` | `/ws`, `GET/POST /api/rooms`, `GET /api/net/metrics` (só localhost ou `FUTHUB_DEBUG=1`), fechamento autoritativo da ranqueada |
| `server/matchmaking.js`, `server/ranking.js` | pareamento humano×humano com sala; `finishAuthoritative`/`voidMatch` |
| `game/game.js` | ganchos mínimos: `loop()`, `draw()` (desenha todos os jogadores online), kick/pass, chat, saída; **física offline/IA intacta** |
| `game/account.js`, `game/index.html` | ranqueada online; seletor "Tipo de sala" (Online / Local); novos `<script>` |
| `test/*` (novos) | testes e benchmarks (ver §7) |

## 6. Como executar

```
npm start                       # http://localhost:8080 (Node 18+; sem dependências)
```
Abra duas abas → Salas → **Criar sala** → "Tipo de sala: Online" → a outra aba escolhe a sala na lista e **Entrar** → o dono clica **Iniciar partida**. O *Jogo rápido* continua sendo treino local contra a IA. O HUD mostra `Ping` (passe o mouse para jitter, fila, snapshots/s, KB/s, erro de predição). Para produção, use HTTPS (o cliente usa `wss://` automaticamente) e `TRUST_PROXY=1` atrás de proxy.

## 7. Testes

```
npm test            # unit (24) + e2e com sockets reais + e2e da ranqueada   (e2e usa WebSocket nativo: Node 22+)
npm run bench       # benchmarks em tempo virtual (determinísticos) -> test/bench-results.txt/.json
node test/browser.js <pasta>   # 2 abas reais do Chromium (requer playwright)
```
Cobrem: determinismo, FPS 20–240, protocolo e fuzz, validação/flood/replay/speed-hack, senha/lotação/XSS, migração de dono, ranqueada (intruso, W.O., pontos), ping baixo/médio/alto, picos, perda 5 %, FPS baixo, 20–22 jogadores, entrada/saída, queda e reconexão, servidor parado 5 s.

## 8. Resultados medidos

O simulador (`test/netsim.js`) usa as classes **reais** (`Room` + `FHNet.Client`) sobre um link simulado com latência, jitter, picos e perda (modelada como TCP: retransmissão após RTO **e bloqueio dos pacotes seguintes**), em tempo virtual (resultados reproduzíveis). "Sem predição" = cliente que só desenha snapshots interpolados (referência), no mesmo cenário. Antes desta entrega **não existia partida online**, então a comparação "antes × depois" de verdade é *cliente ingênuo × cliente final*.

### Atraso entre apertar a tecla e o jogador se mexer na tela
| Cenário | Atraso do controle sem predição (média / p95) | com predição (média / p95) | Erro de predição p95 / máx (m) | Starved / trim (servidor) | Banda por cliente |
|---|---|---|---|---|---|
| rede baixa (ping ~20 ms) | 167 / 167 ms | 33 / 34 ms | 0 / 0.246 | 1 / 0 | 1.61 KB/s |
| rede média (ping ~80 ms) | 233 / 250 ms | 37 / 66 ms | 0 / 1.274 | 0 / 0 | 1.62 KB/s |
| rede alta (ping ~240 ms) | 393 / 417 ms | 22 / 34 ms | 0 / 1.122 | 3 / 0 | 1.64 KB/s |
| pico de latência (+400 ms por 1,5 s) | 233 / 250 ms | 26 / 66 ms | 0 / 1.187 | 44 / 49 | 1.69 KB/s |
| perda de pacotes 5 % | 320 / 400 ms | 21 / 33 ms | 0 / 1.117 | 1570 / 1436 | 1.98 KB/s |
| cliente com FPS baixo (20 FPS, jitter de quadro) | 279 / 313 ms | 52 / 64 ms | 0 / 1.125 | 1 / 0 | 1.8 KB/s |
| disputa de bola, rede ruim (1x1, ping 240 ms vs 40 ms, perda 5 %) | — | — | 0.22 / 0.439 | 1363 / 1384 | 2.37 KB/s |
| 20 jogadores (10x10) no campo 3v3, ping 80 ms | — | — | 0.214 / 0.577 | 8 / 0 | 9.93 KB/s |
| 22 jogadores (11x11) Real Soccer, redes mistas | — | — | 0.02 / 0.875 | 1322 / 1194 | 10.77 KB/s |

*Latência = tempo até o jogador local se mexer ≥3 cm na tela (amostras só são válidas se o servidor também andou; casos em que a bola prende o jogador na parede são descartados). A granularidade é de 1–2 quadros de 60 FPS.*

### Servidor e consistência
| Cenário | Tick do servidor (média / p99 / máx) | Heap Δ | Divergência autoritativa |
|---|---|---|---|
| rede baixa (ping ~20 ms) | 16 / 79 / 5365 µs | 0.5 MB | 0 m |
| rede média (ping ~80 ms) | 14 / 41 / 9047 µs | 0.4 MB | 0 m |
| rede alta (ping ~240 ms) | 7 / 43 / 197 µs | 0.2 MB | 0 m |
| pico de latência (+400 ms por 1,5 s) | 13 / 59 / 4075 µs | 0.4 MB | 0 m |
| perda de pacotes 5 % | 14 / 57 / 5728 µs | 0.4 MB | 0 m |
| cliente com FPS baixo (20 FPS, jitter de quadro) | 10 / 47 / 3664 µs | 0.1 MB | 0 m |
| disputa de bola, rede ruim (1x1, ping 240 ms vs 40 ms, perda 5 %) | 9 / 43 / 4323 µs | 0.3 MB | 0 m |
| 20 jogadores (10x10) no campo 3v3, ping 80 ms | 99 / 487 / 1994 µs | 7 MB | 0 m |
| 22 jogadores (11x11) Real Soccer, redes mistas | 165 / 1162 / 7024 µs | 8.3 MB | 0 m |

*Divergência autoritativa* = estado que o cliente decodificou dos snapshots (delta) menos o estado do servidor no mesmo tick: **0** em todos os cenários (o protocolo reproduz o servidor bit a bit).

**Lendo os números com honestidade**
- O erro de predição é 0 na maior parte do tempo (jogador local previsível). O máximo de ~1,1–1,3 m acontece quando o adversário **chuta/colide de forma imprevisível** (não há como prever a entrada remota): a correção é suavizada na tela em ~60 ms.
- Com perda de 5 % o atraso do controle continua baixo, mas o servidor registra muitos `starved`/`trim`: cada pacote perdido congela a conexão por ~RTO e depois chega uma rajada, da qual o servidor descarta o excesso. Isso é o limite do TCP; o ganho real aqui vem de trocar o transporte (§4).
- Ticks máximos de 4–9 ms são picos isolados (JIT/GC) dentro do orçamento de 16,7 ms; a média é de 7–170 µs. Uma sala de 22 jogadores usa ~1 % de um núcleo para a física.
- Medido em simulador e em *localhost*; **não** foi testado pela internet real com navegadores em redes reais.

## 9. Limitações conhecidas / próximos passos

1. **WebRTC DataChannel não confiável** (§4) para jogadores com perda — não implementado.
2. Sem *lag compensation* de chutes: um chute que parecia acertar na tela do jogador com ping alto pode ser corrigido pelo servidor (decisão de justiça: o servidor vale; o jogador tem predição local, então o chute "toca" imediatamente e é corrigido se errado).
3. Jogadores remotos são **extrapolados** na visão do jogador (menor atraso nas disputas de bola); só espectadores usam interpolação com atraso.
4. Salas não sobrevivem a reinício do servidor (clientes voltam à lista). Numa ranqueada isso conta como partida aberta que expira (regra antiga de `sweepOpen`): recomenda-se persistir/anular partidas ao reiniciar.
5. Online: pausa e reiniciar existem só para o dono em sala casual (v12.3.2; ranqueada nunca); distância/ping na lista de salas ainda é "—"; regiões/lista central de servidores não existem (um processo por região atrás de um balanceador é o caminho de escala).
6. Ranqueada online é 1 humano × 1 humano no campo do modo (como na ranqueada atual); times maiores ainda não pareiam.
7. O modo offline/IA mantém a física antiga (passo variável): quem joga offline a 144 FPS sente diferenças sutis em relação ao online. Migrar o offline para `sim.js` é simples, mas muda a sensação e não foi feito sem pedido.
8. O visual da rede do gol continua 100 % no cliente (eventos `NET/POST` do servidor disparam os efeitos).

## 10. Correções da v12.3.1 (auditoria)

- `POST /api/ranked/finish` **recusa placar** (409) em partida contra humano; só `abandon:true` é aceito. Antes dava para forjar 5x0 (provado em teste) e o resultado do servidor era descartado.
- Ranqueada em que **nenhum** jogador conecta no prazo é **anulada** sem pontos (antes o segundo jogador ganhava por W.O.).
- Aceite tardio em sala já anulada/encerrada é recusado (409) e não cria partida pendente; falha ao criar sala desfaz a partida aberta.
- Sala ranqueada encerrada antes de começar agora fecha sozinha (sem sala zumbi).
- Testes: `test/e2e-ranked.js` (forja, abandono) e `test/e2e-ranked-edge.js` (anulação, aceite tardio).
- **Continua pendente:** ranqueada contra a IA de reserva é local e o placar ainda vem do navegador (validação só por tempo/limite).

## 11. v12.3.2 — salas casuais

- **Pausa** (`{t:'pause'}`) e **reiniciar** (`{t:'restart'}`): só o dono, só sala casual. O servidor congela a simulação (pausa volta sozinha em 60 s) e o cliente para de predizer/enviar entradas.
- **Dono sai de propósito** (botão sair/fechar aba = close frame) → a sala fecha, os outros recebem aviso e ela some da lista. **Queda de rede** (sem close frame) não fecha: o dono migra como antes. Sala vazia some em 15 s.
- **Atualizar** (lista de salas): `game.js` sobrescrevia o clique e escrevia "0 salas"; agora delega ao `online.js`.
- Teste: `test/e2e-room.js`. **O lado do navegador (botões/overlay) não foi testado em navegador real.**

## 12. v12.3.3 — nova tela da sala
- Visual em três colunas (Vermelho | Espectadores | Azul) com avatar, DONO/VOCÊ e **Ping ao vivo** (mensagem `pings` a cada 3 s), botão **Iniciar** verde, ferramentas (Auto/Sortear/Zerar) e configuração no rodapé, chat recolhível com bolinha de mensagem nova. Arquivos: `room.css`, `room-ui.js`, markup do `#roomScreen` em `index.html`.
- Mantidos todos os IDs, `data-join-team`, `data-shift-team`, `.roomDrop` e a lógica de arrastar/soltar. Não validado em navegador real (sem ambiente gráfico na auditoria).

## 13. v12.3.4 — áudio e visual
- Borda do personagem na tela inicial agora é preta (`renderHome` em `game.js`, `.homeAvatar` em `home.css`).
- **Volume geral** (`fh_master_volume`) multiplica efeitos, bola, apito, torcida e música; barra em Configurações > Áudio e no painel ⚙ da partida.
- **Presets de som da bola** sintetizados (`KICK_PRESETS`), escolhidos em Configurações > Áudio (`fh_ball_preset`); áudio próprio tem prioridade.
- O terminal do servidor imprime essas novidades ao iniciar (`CHANGELOG` em `server.js`).

## v12.3.5 — visual do replay
- Barra do player compacta (linha do tempo fina com marcadores de gol + uma linha de botões), some sozinha 3,5 s após tocar enquanto reproduz e volta ao tocar/mover/teclar. Em tela estreita, zoom/câmera/tático ficam no menu ⋯.
- Painel "Resumo da partida" no tema preto/dourado, mais estreito; a barra se desloca para não ficar embaixo dele.
- No replay ficam ocultos o botão 👥 e o ping/FPS; barra e painel não aparecem fora do replay. Lista de replays com cards no tema.
- Arquivos: `game/replay.css` (bloco v2 no fim) e `game/replay.js` (markup da barra, auto-esconder, marcadores). Não validado em navegador real.

## v12.3.6 — replay no layout de referência
- **Barra:** botões com contorno dourado em uma linha (⏮, −10s, ▶, +10s, relógio 00:14 / 00:50, velocidades 0,25x/0,5x/1x/2x/4x, ⋯, ✕ Sair) e linha do tempo abaixo. Ferramentas (gol ant./próx., seguir bola, tático, centralizar, zoom, resumo, exportar) ficam no menu ⋯. Corrigido o bug de botões sobrepostos (os três grupos dividiam a largura em partes iguais).
- **Tela Replays:** abas "Minha conta" / "Neste dispositivo", filtros (busca, jogador, modalidade, data, ordem) e rodapé explicativo. Sem login, a aba "Minha conta" pede para entrar. Importar abre direto "Neste dispositivo". O botão "Atualizar" saiu (a lista recarrega ao abrir e ao trocar de aba).
- Caixinha de times/modalidade no canto do replay. Teste: `test/replay-ui.js` (DOM falso). Não validado em navegador real.

## v12.3.7 — lista de replays com bonecos
- Cada replay é uma linha compacta: info (online/local, modalidade, data, duração) · **bonecos do time vermelho · placar · bonecos do time azul** · ações (▶ Assistir, ⬇, 🗑). Times grandes (ex.: 11x11) mostram 5 bonecos + "+N"; em 1x1 o nome aparece ao lado do boneco. Replays antigos (sem `players` no índice) mostram iniciais do nome.
- Índice do servidor (`server/replay.js`) agora guarda `players` (nick/avatar/time, até 22) — campo aditivo e compatível.
- Corrigido: as classes `.red`/`.blue` globais do placar (círculo vermelho / quadrado azul) vazavam para os nomes do card e para a caixinha de times do replay; agora usam classes próprias. Também protegido o chat da sala.
- Tela mais baixa para celular deitado: título, abas e Importar na mesma linha; 5 filtros em uma linha; lista + rodapé numa só área rolável.
