# FutHub — entrega parcial da reformulação competitiva

## O que foi implementado

A ranqueada agora não cria adversários de reserva. O matchmaking só fecha um grupo com participantes humanos suficientes para o modo, mantém as filas separadas por modalidade e registra a capacidade total e o tamanho das equipes em uma configuração única no servidor. A sala ranqueada só inicia quando todos os usuários do grupo estão conectados e validados.

A configuração de sala passou a aceitar arbitragem automática, duração de prorrogação e gol de ouro. Essas opções são mantidas pelo servidor e transmitidas aos clientes pela informação da sala. Quando a arbitragem está ativa, a física autoritativa controla o centro da bola no reinício, entrega a posse ao time que sofreu o gol, mantém uma barreira física central para o time sem posse durante a contagem, inicia a prorrogação em empate e encerra a prorrogação por gol de ouro ou como empate persistente.

O protocolo de snapshots foi ampliado para sincronizar posse de reinício, barreira e estado de prorrogação. O comportamento de salas casuais sem arbitragem e o fluxo offline não foram substituídos.

Também foi implementado o fluxo de configuração solicitado para salas online: enquanto a partida está ativa, os campos de tempo, gols e modalidade ficam bloqueados. O dono usa **Parar partida**; o servidor encerra a partida e retorna a sala ao lobby. Somente então os campos são liberados, e cada alteração é validada e aplicada no servidor antes de uma nova partida. A tela inicial ganhou um seletor com todas as modalidades do catálogo atual, de Futsal 1v1 a Real 11v11.

## Arquivos modificados

- `server/matchmaking.js`: remoção do fallback de IA e agrupamento por quantidade humana exigida.
- `server/ranking.js`: capacidades centralizadas por modalidade e Elo calculado contra humanos.
- `server.js`: opções de arbitragem na criação de sala e salas ranqueadas dimensionadas pelo modo.
- `server/room.js`: configuração autoritativa de arbitragem enviada à simulação e à listagem da sala.
- `game/sim.js`: posse após gol, contagem, barreira física, prorrogação, empate persistente e gol de ouro.
- `game/proto.js`: sincronização de posse, barreira e prorrogação.
- `game/account.js`: indicação de capacidade da fila e mensagem de ranqueada 100% humana.
- `game/online.js`: envio das opções de arbitragem ao servidor.
- `game/index.html`: controles de arbitragem, prorrogação e gol de ouro.
- `game/home.css` e `game/room.css`: estilo do seletor de modalidade e do botão de parada.
- `test/arbitration.js`: seis testes determinísticos novos.
- `test/room-config.js`: teste de bloqueio durante partida e liberação após parada.
- `package.json`: inclusão dos testes de arbitragem nas suítes.
- `README.md`: documentação corrigida.
- `docs/RANKED_AUDIT.md`: auditoria da Fase A.

## Testes executados

Comando executado no projeto atualizado:

```text
npm test
```

Resultado real: código de saída `0`.

A execução passou por 24 testes unitários, 6 testes de arbitragem, 1 teste de configuração/parada, 40 testes de replay, 19 testes de UI de replay e todos os E2E existentes de salas, WebSocket, ranqueada, anulação, W.O., reconexão, pausa, reinício e múltiplas salas.

Também foram executados `node --check` nos arquivos JavaScript modificados e `npm run test:unit`, ambos com sucesso.

## Instalação sem apagar dados

1. Faça uma cópia de segurança do diretório `data/`, principalmente `data/db.json` e `data/replays/`.
2. Pare o servidor atual; não sobrescreva o diretório de dados.
3. Extraia o ZIP em um novo diretório do código.
4. Reaproveite o diretório `data/` existente, ou defina `FUTHUB_DATA` para apontar para ele.
5. Use Node 18 ou superior e execute `npm test` antes de iniciar.
6. Inicie com `npm start` e valide primeiro em ambiente de teste.

Nenhum banco de produção foi alterado e nenhuma publicação ou reinício de produção foi realizado.

## Limitações restantes

A entrega ainda não implementa a rotação competitiva após vitória, fila de espera de rotação, seleção manual alternada, seleção automática por timeout, reconexão preservando uma vaga de rotação, tela completa de seleção nem logs específicos de arbitragem. Esses itens exigem uma máquina de estados adicional de lobby/partida e extensões de UI além das mudanças atuais.

Os modos existentes continuam usando os identificadores legados (`v1`, `v2`, `v3`, `v4`, `r4`, `r5`, `r7`, `r9`, `r11`). As capacidades humanas foram centralizadas nesses modos; não foram criados aliases novos `X1`/`X2`/`X3`/`X4`/`X5`/`X7` para evitar quebrar dados e rankings existentes.

A barreira é física e autoritativa no período de reinício, mas sua representação visual dedicada na HUD ainda não foi adicionada. O cliente recebe o estado sincronizado e a simulação não depende de uma barreira desenhada localmente.
