# Banco de dados — v1.11

## Portabilidade
A camada de dados usa **Knex**. Em desenvolvimento o cliente é `better-sqlite3`
(arquivo local); em produção é `pg` (PostgreSQL/Netlify Database). As migrations
e o seed são os mesmos nos dois ambientes.

Regra importante: **SQLite nunca é o banco de produção** em funções serverless —
lá o estado não persiste entre execuções. Produção sempre PostgreSQL.

## Entidades
- **users** — contas (username, name, password_hash, role, active, timestamps, last_login_at).
- **sessions** — sessões ativas (token, user_id, expires_at, ip, user_agent).
- **inventory_items** — catálogo (category, name, unit, minimum, active, sort_order).
- **inventory_counts** — cada contagem registrada (item, quantidade, quem, quando, snapshot).
- **inventory_snapshots** — fechamentos de inventário (code, closed_at, user).
- **inventory_snapshot_items** — foto das quantidades no fechamento.
- **chopp_products / chopp_taps / chopp_reserves** — chopp: produto, torneiras (nível) e reservas.
- **audit_log** — trilha de auditoria (user, action, entity, old_value, new_value, timestamp, metadata).
- **settings** — configurações chave/valor.

Colunas JSON (`old_value`, `new_value`, `metadata`, `settings.value`) usam
`table.json()` — TEXT no SQLite, JSON no Postgres.

## Migração do catálogo
`database/catalog.js` contém o catálogo extraído **verbatim** do `app.js`
(143 itens, 13 categorias, 15 chopps). O seed `database/seed/00_catalog.js`
insere isso de forma **idempotente** (rodar de novo não duplica).

## Fase 1 — Modelo híbrido de unidades (v2.5.1)

`inventory_items.unit` continua representando a unidade operacional/comercial usada na contagem e na interface. `inventory_items.base_unit` representa a unidade interna de cálculo e consumo do PDV.

Itens existentes são migrados conservadoramente com `base_unit = unit`. Nenhum histórico é recalculado.

`units_per_pack` continua representando quantas unidades-base existem em um pacote quando essa relação é conhecida. No leitor de compras, `pacote` pode ser convertido automaticamente para `base_unit` por esse fator. Caixa, fardo e outras embalagens exigem uma regra explícita em `conversions`.
