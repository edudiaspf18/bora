# Bora

Plataforma multi-loja de cardápio digital e pedidos para restaurantes, lanchonetes, açaiterias e quiosques.
v2 do sistema anterior (repositório `baratao`, mantido intocado como v1).

## Stack

Next.js 15 · TypeScript · PostgreSQL 16 · Drizzle · Zod · Tailwind v4 · Shadcn · Vitest · Playwright

## Rodar local

Requer Node >= 22.9.

```bash
cp .env.example .env            # ajuste usuário do Postgres e SESSION_SECRET
createdb bora && createdb bora_test
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Endereços (domínio raiz `localhost`):

- Landing: http://localhost:3000
- Painel: http://app.localhost:3000 (`dono@demo.test` / `Demo@12345678`)
- Lojas: http://demo-acai.localhost:3000, http://demo-lanche.localhost:3000

## Testes

```bash
npm test        # unitários e integração (Postgres real, banco bora_test)
npm run e2e     # Playwright (roda o seed antes)
npm run e2e:prod # build de produção + Playwright
```

## Antes de ir para produção

BLOCKERS (não publicar sem resolver):

- IP do cliente confiável: o item mais à esquerda de `x-forwarded-for` é controlado pelo cliente, a menos que o proxy o sobrescreva. Os limites por IP (login, reset, OTP) dependem disso. Implementar `TRUSTED_PROXY_HOPS` em `src/server/auth/ip.ts` ou configurar o proxy para sobrescrever o header.
- Sender de OTP real: `consoleSender` registra os códigos no log. Produção não pode usá-lo.
- Mailer real: `consoleMailer` registra os links de redefinição de senha.
- Variáveis obrigatórias: `ROOT_DOMAIN`, `PANEL_ORIGIN`, `SESSION_SECRET` (nunca o placeholder do `.env.example`), `APP_DB_PASSWORD`, `DATABASE_*`.
- Nunca definir `E2E_UNSAFE_FILE_OTP` nem `OTP_SENDER=file` em produção.
- Revogação de sessão na troca de senha não existe (ideia: `staff_users.sessions_valid_after`).
- Apertar os grants de `bora_app` nas tabelas globais.
- Header `Referrer-Policy` (ex.: `no-referrer`) na página de redefinição de senha.

## Docs

- Spec: `docs/superpowers/specs/2026-10-02-bora-fundacao-design.md`
- Plano: `docs/superpowers/plans/2026-10-02-bora-fundacao.md`

Observação: a landing lê `PANEL_ORIGIN` na hora do `next build`; em produção defina a variável também no build.
