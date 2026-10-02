# Bora

Plataforma multi-loja de cardápio digital e pedidos para restaurantes, lanchonetes, açaiterias e quiosques.
v2 do sistema anterior (repositório `baratao`, mantido intocado como v1).

## Stack

Next.js 15 · TypeScript · PostgreSQL 16 · Drizzle · Zod · Tailwind v4 · Shadcn · Vitest · Playwright

## Rodar local

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
```

## Docs

- Spec: `docs/superpowers/specs/2026-10-02-bora-fundacao-design.md`
- Plano: `docs/superpowers/plans/2026-10-02-bora-fundacao.md`
