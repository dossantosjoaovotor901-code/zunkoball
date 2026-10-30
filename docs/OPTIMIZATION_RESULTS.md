# Zunkoball — auditoria e otimizações incrementais (v12.3.19)

## Resumo

O projeto já tinha a base correta para baixa latência: simulação autoritativa no servidor, física compartilhada determinística a 60 Hz, predição/reconciliação do jogador local, snapshots binários delta com keyframes, interpolação para espectadores e backpressure no WebSocket. Portanto, esta etapa não trocou o transporte, não mudou a frequência de snapshots e não transferiu autoridade para o cliente.

Foram aplicadas otimizações localizadas e correções de robustez, preservando o protocolo dos snapshots válidos e as funcionalidades existentes.

## Mudanças realizadas

- **Física (`game/sim.js`)**: colisões entre círculos agora verificam primeiro se os intervalos em X e Y se sobrepõem. Pares comprovadamente afastados não executam `sqrt`; pares potencialmente sobrepostos mantêm o cálculo e a ordem anteriores. É um descarte geométrico exato, não uma alteração de raio, restituição ou autoridade.
- **Cliente (`game/netclient.js`)**: jogadores ativos que predizem localmente não guardam até 40 cópias completas de snapshots destinados à interpolação. Espectadores e clientes de referência sem predição continuam armazenando o buffer. A composição das posições locais usa um único array de saída, em vez de criar também um array intermediário e chamar `map`; a reconciliação reaproveita o array de offset.
- **Interpolação**: mudanças de presença/time são tratadas como descontinuidades visuais. A entrada de um jogador passa a usar a posição recebida, sem interpolar desde o sentinela `-100`; a mudança no número de slots também produz uma lista de posições alinhada ao estado recebido.
- **Servidor (`server/room.js`)**: a verificação de inatividade itera diretamente sobre o `Map`, sem materializar uma cópia dos clientes em cada tick. Remover o elemento corrente durante essa iteração é suportado pela semântica de `Map` do JavaScript.
- **Recepção de snapshots (`game/proto.js`)**: validação de comprimento, flags, roster, máscara, entidades e números finitos ocorre antes de alterar o estado autoritativo do cliente. Pacotes truncados/inconsistentes retornam `null`, sem exceção ou mutação parcial.
- **WebSocket (`server/ws.js`)**: o limite de payload agora também vale para a soma dos fragmentos de uma mensagem. Ao ultrapassar o limite, a conexão fecha com código 1009 e os buffers são liberados.
- **Medição**: o campo de tráfego do benchmark foi renomeado de `kbps_por_cliente` para `kib_s_por_cliente`; o valor sempre era bytes/s divididos por 1024, ou seja, KiB/s, não kilobits/s.

## Diagnóstico que precedeu as mudanças

Um perfil V8 de 15 segundos virtuais com 22 clientes simulados em Real Soccer registrou `physics()` como a função JavaScript mais amostrada (25,1% dos samples totais do processo) e `collide()` com 2,2%. O perfil inclui simultaneamente os clientes simulados e a sala do servidor; não deve ser interpretado como perfil isolado da VPS. A leitura do código confirmou que a física percorre todos os pares de jogadores, enquanto o protocolo já transmite deltas e o render já ocorre no navegador.

No código do cliente, snapshots ativos alimentavam um buffer de interpolação que `getRender()` não usa quando há slot ativo e predição. Esse trabalho criava/retinha arrays, objetos por entidade e cópias completas de estado. O buffer foi mantido para espectadores e para o modo sem predição.

## Resultados medidos

### Benchmark da simulação de rede

Medições feitas no mesmo sandbox e no mesmo `test/bench.js`. A execução simula links TCP/WebSocket com latência, jitter, perda, retransmissão e head-of-line blocking; não é uma conexão pública real.

| Cenário | Métrica | Antes | Depois | Leitura |
|---|---:|---:|---:|---|
| 20 jogadores, campo 3v3 | Tick médio do servidor | 74 µs | 76 µs | Sem melhora mensurável neste agregado; variação de execução. |
| 20 jogadores, campo 3v3 | Heap delta do processo de teste | 7,0 MB | 1,1 MB | Redução de 84,3% no harness; inclui os clientes simulados, não é RAM isolada da VPS. |
| 22 jogadores, Real Soccer | Tick médio do servidor | 103 µs | 115 µs | Sem melhora mensurável neste agregado; variação de execução. |
| 22 jogadores, Real Soccer | Heap delta do processo de teste | 8,3 MB | 1,3 MB | Redução de 84,3% no harness; inclui os clientes simulados. |
| 22 jogadores, Real Soccer | Snapshots por cliente | 20/s | 20/s | Inalterado. |
| 22 jogadores, Real Soccer | Tráfego por cliente | 11,4 KiB/s | 11,4 KiB/s | Inalterado; o protocolo e sua frequência não foram modificados. |
| Todos os cenários comparáveis | Divergência do snapshot autoritativo | 0 m | 0 m | Cliente continua reproduzindo o estado do servidor. |
| 5% de perda simulada | Starved / entradas descartadas | 1.610 / 1.488 | 1.610 / 1.488 | O custo de HOL/rajadas continua; política de fila não foi alterada. |

O heap delta é a diferença medida pelo benchmark após coleta de lixo forçada. Em cenários de 20/22 jogadores, `NetSim` hospeda no mesmo processo a sala, todos os clientes, buffers de rede e estado de predição; logo, a queda observada é compatível com a remoção das cópias de snapshots, mas **não** pode ser atribuída integralmente à memória de um servidor de produção.

### Medição focada do tick autoritativo

Foi executado um ensaio separado com `Room.tick()` real, 22 jogadores no mapa Real Soccer, sockets falsos que não armazenam payloads, 300 ticks de aquecimento e 6.000 ticks medidos. Uma execução antes da mudança registrou 55,71 µs/tick. Três execuções depois registraram 54,94, 50,26 e 49,09 µs/tick (mediana: 50,26 µs), aproximadamente 9,8% abaixo daquele único valor de referência.

Esse ensaio é um indício favorável para as verificações de colisão e o loop sem cópia, não uma estimativa garantida de capacidade: a referência prévia foi uma única amostra, e o benchmark completo teve variação no tick agregado. A medição precisa ser repetida em hardware/VPS de produção e com várias salas simultâneas antes de inferir capacidade de escala.

### Latência e consistência

A bateria pós-mudança manteve aproximadamente os mesmos atrasos de controle do baseline: 33 ms em rede baixa, 35 ms em rede média, 20 ms em rede alta, 21 ms no cenário de 5% de perda e 53 ms no cliente de 20 FPS. A física autoritativa permaneceu sem divergência (`0 m`) nos cenários medidos. As mudanças não alteraram o protocolo, a fila de entradas, a taxa de snapshots, as constantes físicas nem as regras da partida.

## Testes executados

- `npm test` — passou, incluindo testes unitários, determinismo/FPS 20–240, arbitragens, replays, UI, WebSocket real, salas e ranqueadas.
- `node test/unit.js` — 34 testes passaram na execução final, incluindo prefixos truncados de snapshots, valores não finitos, transição de jogadores em espectadores e mensagens WebSocket fragmentadas dentro/acima do limite.
- `npm run bench` — passou nos cenários de latência, jitter, perda de pacotes, 20/22 jogadores, pausa do servidor, entradas/saídas e reconexão.

## Limites e próximos passos

Não foi feito teste de navegador real em celular, rede pública ou VPS de produção. Também não foi medida carga agregada com dezenas/centenas de salas concorrentes. O benchmark de `Room.tick()` não exercita o custo de cópia do `server/ws.js` em sockets reais, nem justifica trocar WebSocket por WebRTC. A perda modelada de 5% ainda produz starved/trim por ser transporte TCP ordenado.

Antes de uma otimização mais invasiva, recomenda-se medir carga de múltiplas salas e validar em clientes móveis reais. Não foram alterados a ordem das colisões, a autoridade do servidor, o protocolo dos snapshots, a compatibilidade de replay, a frequência de updates ou as funcionalidades visuais.
