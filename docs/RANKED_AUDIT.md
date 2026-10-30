# Auditoria da ranqueada e do multiplayer — Fase A

## Linha de base

`npm test` foi executado no projeto recebido e terminou com código 0:

- 24 testes unitários;
- 40 testes de replay;
- 19 testes de UI de replay;
- testes E2E de salas, WebSocket, ranqueada e casos extremos.

Esses testes validam a implementação existente, mas não cobrem os requisitos novos de arbitragem, rotação, seleção, prorrogação e barreira central.

## Arquivos envolvidos

### Autoridade do servidor

- `server.js`: rotas de fila, aceite, salas e fechamento de partidas.
- `server/matchmaking.js`: filas por modo, pareamento, reserva de IA e aceite.
- `server/ranking.js`: catálogo de modos, regras, partidas abertas e pontuação.
- `server/room.js`: ciclo da sala, conexões, presença, W.O., pausa, start/stop e snapshots.
- `server/gameserver.js`: registro e tick das salas.
- `server/ws.js`: transporte WebSocket e autenticação da conexão.

### Física e mapas

- `game/sim.js`: simulação autoritativa compartilhada, formação, gols, reinício e regras de Real Soccer.
- `game/maps.js`: dimensões e propriedades dos mapas usadas pelo cliente e pelo servidor.
- `server/maps.js`: carregamento das definições de mapa no Node.
- `game/proto.js`: estado binário sincronizado, incluindo fase, placar, cronômetro e reinício.

### Cliente e interface

- `game/account.js`: menu da ranqueada, fila, aceite e resultado.
- `game/online.js`: integração WebSocket, sala de espera, HUD e reconexão.
- `game/netclient.js`: predição, reconciliação e estado autoritativo recebido.
- `game/game.js`: renderização e fluxo offline/online.
- `game/index.html`, `game/room-ui.js` e CSS de sala/criação: telas de fila, sala e jogo.

### Testes e documentação

- `test/unit.js`, `test/e2e-ranked.js`, `test/e2e-ranked-edge.js`, `test/e2e-room.js`.
- `docs/MULTIPLAYER.md`, `README.md`.

## Problemas confirmados

1. `server/matchmaking.js` ainda possui `BOT_NAMES`, `botOpp()` e fallback após `botAfter()`. Isso permite IA substituir jogador na ranqueada.
2. `server/ranking.js` documenta e calcula Elo contra IA (`AI_RATING`) e aceita modelos de modo que não possuem capacidade humana centralizada.
3. Os modos atuais são `v1/v2/v3/v4/r4/r5/r7/r9/r11`; a solicitação usa X1/X2/X3/X4/X5/X7 e requer capacidades humanas de 2/4/6/8/10/14.
4. A sala ranqueada começa com todos os usuários do pareamento conectados, mas o modelo atual foi desenhado para dois usuários e não para equipes com vários participantes.
5. Não existe estado de arbitragem configurável, fila de espera competitiva, seleção alternada, rotação de equipes ou limite de escolha.
6. `game/sim.js` possui contagem regressiva inicial e reinício após gol, mas não implementa prorrogação configurável, posse inicial por time que sofreu o gol nem barreira física central.
7. A interface atual mostra fila/sala/partida, mas não mostra o estado competitivo completo solicitado.
8. Os testes existentes validam apenas ranqueada 1v1, W.O. de um adversário e cenários básicos; não comprovam os requisitos novos.

## Ordem segura de implementação

1. Centralizar catálogo e capacidade das modalidades no servidor e cliente.
2. Remover fallback de IA e bloquear partidas ranqueadas incompletas ou misturadas.
3. Expandir o modelo de pareamento/sala para todos os participantes exigidos.
4. Adicionar máquina de estados de arbitragem no servidor, incluindo rotação, seleção, prorrogação, posse e barreira.
5. Estender protocolo/snapshots e interface sem duplicar autoridade no cliente.
6. Adicionar testes de unidade, integração e múltiplas salas; só então atualizar documentação e ZIP.
