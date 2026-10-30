# Correção do online — FutHub 12.3.9

## O que foi corrigido
- O protocolo de snapshots transmitia o ACK inicial `-1` como inteiro sem sinal (`4294967295`).
- O cliente podia interpretar esse valor como se o servidor já tivesse confirmado todas as entradas pendentes, limpando indevidamente a fila de predição.
- O ACK agora é decodificado como inteiro com sinal e a fila pendente só é limpa quando o ACK é válido (>= 0).

## Arquivos alterados
- `game/proto.js`
- `game/netclient.js`
- `test/unit.js` (teste de regressão para ACK inicial)

## Validação
- Os 25 testes unitários/robustez passaram.
- Os testes de arbitragem, replay, UI de replay, conexão e ranqueadas passaram individualmente.
- O teste `test/e2e-room.js` também passou individualmente.
- O comando geral `npm test` não terminou dentro do limite do ambiente após a etapa de ranqueadas; por isso, não declaro a suíte completa como concluída em uma única execução.

Esta correção resolve um bug real no tratamento inicial da fila de entradas. Ela não substitui um teste manual com dois dispositivos em uma rede real.
