# Correção — travamento aparente ao terminar/parar partida (12.3.9)

## Causa observada
No modo online casual, a mensagem `end` só mostrava um toast. O estado autoritativo passava para `ENDED`, então a partida parava de simular, mas a tela permanecia no campo sem um estado visual de encerramento até o servidor retornar a sala ao lobby. Isso parecia um congelamento.

## Correção
- Ao receber `end`, o cliente congela explicitamente o estado local de jogo e mostra um painel com o placar final e a indicação de retorno à sala.
- Ao receber `lobby`, remove o painel, para o motor online e mostra a sala novamente.
- Ao sair/desconectar, remove o painel de encerramento para não contaminar a próxima partida.

## Validação
- `node --check game/online.js`: passou.
- Testes unitários, arbitragem, sala/configuração, replay, replay UI, e2e, ranqueadas e e2e-ranked-edge passaram até o início de `e2e-room`.
- `npm test` não terminou dentro do limite de execução; portanto, a suíte completa não foi confirmada como aprovada.
- É necessário validar manualmente em duas conexões reais, incluindo fim por tempo/placar e botão Parar.
