# Deploy no Netlify

O sistema tem duas partes no mesmo domínio: o **frontend** (PWA estático em `frontend/`)
e a **API** (uma Netlify Function em `netlify/functions/api.js`). O banco de produção
é **PostgreSQL** (Netlify Database / Neon).

## 1. Banco de dados (PostgreSQL)
1. No painel do Netlify, ative **Netlify Database** (Neon) no projeto — ele gera a
   variável `DATABASE_URL`. (Ou use qualquer Postgres e cole a string você mesmo.)

## 2. Variáveis de ambiente (Site settings → Environment variables)
- `NODE_ENV = production`
- `DATABASE_URL = postgres://…` (do passo 1)
- `SESSION_SECRET = <valor aleatório longo>`
- `ADMIN_USERNAME = admin`
- `ADMIN_PASSWORD = <senha forte>`  ← usada uma vez para criar o admin

Nunca coloque esses valores no código nem no Git.

## 3. Rodar as migrations e o seed em produção (uma vez)
As migrations criam as tabelas e o seed migra o catálogo + cria o admin. Rode do seu
computador apontando para o banco de produção:

```bash
export NODE_ENV=production
export DATABASE_URL="postgres://…"      # mesma string do Netlify
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD="sua-senha-forte"
npm install
npm run migrate      # cria as tabelas no Postgres
npm run seed         # catálogo + usuário admin
```

O seed é idempotente: rodar de novo não duplica o catálogo nem recria o admin.

## 4. Publicar
- Conecte o repositório ao Netlify (ou use `netlify deploy`).
- O `netlify.toml` já define: `publish = frontend`, `functions = netlify/functions`,
  o redirect `/api/* → function` e o fallback do PWA.
- Ao subir, o site serve o PWA e a API responde em `/api/*`.

## 5. Primeiro acesso
Abra o site, faça login com `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Em **Usuários**,
crie as contas de MANAGER e OPERATOR para a equipe.

## Segurança em produção
- Sessão em cookie `HttpOnly` + `Secure` + `SameSite=Lax`, com expiração.
- Senha com hash bcrypt (nunca em texto puro).
- Rate-limit no login (5 tentativas / 15 min).
- Todas as permissões verificadas no backend, por papel.
- HTTPS é automático no Netlify.

## Atualizações futuras do catálogo
Editar `database/catalog.js` e rodar `npm run seed` de novo (idempotente) adiciona
itens novos sem apagar contagens.
