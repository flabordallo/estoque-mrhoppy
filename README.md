# Estoque do Bar — v1.13

Atualização v1.12: reset seguro do ciclo atual, proteção contra reenvio de fila offline após reset e melhorias visuais/dinâmicas no dashboard.

**Reset ADMIN:** remove apenas contagens abertas, reinicia torneiras do chopp para 100% e reservas para 0, preservando catálogo, preços, snapshots históricos e auditoria.

# Estoque do Bar — v1.13

Sistema de estoque para bar (celular, tablet, desktop): PWA + backend real com
banco de dados, login por papéis, auditoria, inventários, relatórios e exportação.

## Status das fases — todas concluídas
- ✅ **Fase 1** — Fundação: dados portáveis (SQLite dev / PostgreSQL prod), schema, seed do catálogo.
- ✅ **Fase 2** — Autenticação (usuários, sessões em cookie, papéis ADMIN/MANAGER/OPERATOR, rate-limit) + auditoria.
- ✅ **Fase 3** — Inventário (contagem, fechamento em snapshot, consumo) + relatórios + frontend ligado à API.
- ✅ **Fase 4** — Exportação XLSX + backup/restauração + dashboard.
- ✅ **Fase 5** — Deploy Netlify + documentação + fila offline.

## Rodar localmente (SQLite)
```bash
npm install
npm run migrate
npm run seed                 # catálogo + admin (defina ADMIN_PASSWORD no .env)
node backend/local-server.js # sobe a API em http://localhost:8788/api
```
Sirva a pasta `frontend/` (ex.: `npx serve frontend`) e acesse no navegador.
Recomeçar do zero: `npm run db:reset`.

## Testes
```bash
npm test
```
Cobrem: migração do catálogo, hash de senha, login, rate-limit, auditoria,
autorização por papel (OPERATOR bloqueado), contagem, fechamento de inventário,
cálculo de consumo, exportação XLSX e backup/restauração.

## Papéis
- **ADMIN** — tudo: catálogo, usuários, auditoria, backup, exportação.
- **MANAGER** — contagens, chopp, relatórios, exportação; não mexe em usuários/catálogo.
- **OPERATOR** — só contagem e consulta.

## Arquitetura
```
Navegador/PWA → frontend/ (api.js) → /api/* → netlify/functions/api.js
  → backend/src/router.js (auth + RBAC) → services → Knex → SQLite (dev) / PostgreSQL (prod)
```

## Estrutura
```
frontend/              PWA (interface preservada + login, estados, offline)
backend/src/           auth, rbac, audit, router e services (inventory, catalog, export)
backend/local-server.js  API local p/ dev e testes
netlify/functions/     API serverless (produção)
database/migrations/   schema
database/seed/         catálogo (00) e admin (01)
database/catalog.js    catálogo canônico extraído do app.js
tests/                 suíte de testes
docs/                  DATABASE.md, DEPLOY.md
```

## Deploy
Veja `docs/DEPLOY.md` (Netlify + PostgreSQL, variáveis de ambiente, migrations).

## Offline
O PWA abre offline (shell em cache) e mostra "Offline". Contagens feitas offline
entram numa **fila** e sincronizam quando a conexão volta. O estado de salvamento
aparece no topo: Salvo / Salvando… / Offline / Erro ao salvar. A API nunca é
servida de cache — nada finge estar salvo no servidor sem estar.

## Preços v1.11
- A aba **Preços** mostra os preços de todos os itens de estoque e chopps.
- ADMIN pode editar preços; OPERATOR/MANAGER visualizam.
- O preço dos itens é editável também no cadastro.
- Alterações de preço são persistidas no banco e registradas na auditoria.
- A exportação XLSX inclui preço nas abas `ESTOQUE_ATUAL` e `CHOPP`.

## Hospedagem / domínio
Trocar apenas o domínio não reduz o consumo de build/deploy do Netlify: o projeto continua consumindo os mesmos recursos da conta Netlify. Para reduzir esse consumo, é necessário mover o deploy para outro provedor (ou reduzir a frequência de deploys). O código desta versão continua compatível com o deploy Netlify atual.
