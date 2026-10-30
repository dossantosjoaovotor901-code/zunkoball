# Exclusivos + painel de admin (MySQL)

Itens exclusivos (10 uniformes ZK e 8 efeitos de gol) são entregues pelo painel em `/admin.html`.
As concessões, os itens equipados e o histórico ficam no **MySQL**. As contas dos jogadores continuam no `data/db.json`.

## Configurar

1. Criar o banco e um usuário:
   ```sql
   CREATE DATABASE zunkoball CHARACTER SET utf8mb4;
   CREATE USER 'zunko'@'%' IDENTIFIED BY 'troque-esta-senha';
   GRANT ALL ON zunkoball.* TO 'zunko'@'%';
   ```
2. Instalar a dependência: `npm install` (traz o `mysql2`).
3. Configure no arquivo `.env` (na pasta do projeto; o servidor lê sozinho) ou como variáveis de ambiente:
   ```
   MYSQL_HOST=127.0.0.1  MYSQL_PORT=3306  MYSQL_USER=zunko  MYSQL_PASSWORD=...  MYSQL_DATABASE=zunkoball
   ZUNKO_ADMINS=seu_usuario,outro_admin
   ```
   (ou `MYSQL_URL=mysql://zunko:senha@host:3306/zunkoball`). `ZUNKO_ADMINS` são os **nomes de usuário** (login) dos admins, separados por vírgula.
4. `npm start`, entrar no jogo com a conta admin e abrir `/admin.html`.

As 3 tabelas (`exclusive_grants`, `exclusive_equipped`, `exclusive_audit`) são criadas sozinhas na primeira conexão.

## Como funciona

- Sem `MYSQL_HOST`/`MYSQL_URL` o servidor usa o `db.json` (bom só para testes locais).
- Se o MySQL estiver fora do ar, o jogo continua normal, sem exclusivos; o servidor tenta reconectar a cada 30 s e o painel mostra "FORA DO AR".
- Os exclusivos ficam em cache na memória do servidor (a leitura durante a partida é instantânea). Use **um único processo** do servidor.
- Quem tem o uniforme/efeito escolhe na tela **Uniforme**: uniformes na aba **Jogador** e efeitos na aba **✨ Efeito de gol** (com pré-visualização; os ainda não liberados aparecem com 🔒). Os outros jogadores da sala veem o uniforme e o efeito.
- O painel `/admin.html` tem 4 abas: **Jogadores** (lista TODAS as contas, inclusive admins e a sua, com busca e paginação; botões Dar / Dar todos / Remover todos), **Uniformes**, **Efeitos de gol** (com pré-visualização ao vivo) e **Histórico**.
- A escolha vale para salas em que o jogador **entrar depois** de equipar.
- Para criar novos itens: `server/exclusives.js` (catálogo) + `game/exclusives.js` (aparência/ícone) + `game/goalfx.js` (desenho do efeito; `test/goalfx.js` confere que catálogo e efeitos estão alinhados).
