# Fundação — Hardening final Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os itens CARRY/segurança de `docs/superpowers/follow-ups-fundacao.md` que ainda estão abertos, antes do merge de `feat/fundacao` em `main`.

**Architecture:** Correções pontuais, sem mudança de modelo de dados. Cada task é um commit com teste.

**Tech Stack:** Next.js 15, TypeScript, Drizzle/postgres-js, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-bora-fundacao-design.md`

## Global Constraints

- Sem `any`; Tailwind only; `focus-visible:`; ícones só `lucide-react` (CLAUDE.md global).
- Código, commits e comentários em PT-BR normal (sem caveman).
- Baseline: `npm run typecheck` e `npm test` verdes (173 testes) antes de cada commit.
- DB: Postgres do pgAdmin (`bora`, `bora_test`); sem Docker.

## Review Focus

- `?reset=ok` repetido (`string[]`) ou desconhecido não quebra a página de login.
- Falha do `OtpSender` não vaza exceção crua nem deixa o usuário sem retorno tipado.
- Em produção, nenhum log contém código OTP nem link/token de reset.
- `dummyHash` rejeitado uma vez não envenena o processo.
- `throttle` com linha ausente/data inválida não falha aberto.

## Já corrigido na wave final (não refazer)

Tenant pelo host nas actions, `ROOT_DOMAIN` fail-closed no middleware, `PANEL_ORIGIN` fail-closed, `Object.hasOwn(ERRORS)`, `first()` para `string[]`, `confirmPasswordReset` com gate antes do argon2, e2e com flag.

---

### Task 1: Mensagem `?reset=ok` no login

**Files:**
- Modify: `src/app/panel/login/page.tsx`
- Test: `tests/e2e/staff.spec.ts` (acrescentar asserção ao fluxo de reset, se existir; senão teste manual via `npm run e2e`)

- [ ] **Step 1:** Em `LoginPage`, ler `reset` junto de `error`:

```tsx
searchParams: Promise<{ error?: string | string[]; reset?: string | string[] }>;
// ...
const params = await searchParams;
const error = first(params.error);
const resetOk = first(params.reset) === "ok";
```

- [ ] **Step 2:** Antes do bloco `message`, renderizar:

```tsx
{resetOk ? (
  <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
    Senha redefinida. Entre com a nova senha.
  </p>
) : null}
```

- [ ] **Step 3:** `npm run typecheck`. Expected: sem erros.
- [ ] **Step 4:** Commit `fix(auth): confirmação após redefinir senha`.

### Task 2: Logs sem segredo em produção

**Files:**
- Modify: `src/server/otp/sender.ts:8-12`, `src/server/auth/reset.ts:17-21,80-85`
- Test: `tests/otp/sender.test.ts`, `tests/auth/reset.test.ts`

**Interfaces:** `consoleSender` e `consoleMailer` mantêm a mesma assinatura.

- [ ] **Step 1: Teste falhando** (`sender.test.ts`): com `NODE_ENV=production`, `consoleSender.send("5511999999999","123456",{tenantSlug:"x"})` não chama `console.log` com `123456`. Usar `vi.stubEnv("NODE_ENV","production")` e `vi.spyOn(console,"log")`; assert `not.toHaveBeenCalledWith(expect.stringContaining("123456"))`.
- [ ] **Step 2:** Rodar `npx vitest run tests/otp/sender.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar** em `consoleSender`:

```ts
async send(phone, code, ctx) {
  const shown = process.env.NODE_ENV === "production" ? "[redigido]" : code;
  console.log(`[otp] loja=${ctx.tenantSlug} telefone=${phone} codigo=${shown}`);
},
```

- [ ] **Step 4:** Mesmo padrão em `consoleMailer`: em produção logar só `para` e `assunto`, sem `text`. Em `catch` do reset, redigir token:

```ts
const message = (err instanceof Error ? err.message : "erro desconhecido").replace(/token=\S+/g, "token=[redigido]");
```

- [ ] **Step 5:** Teste equivalente em `reset.test.ts` (mailer console em prod não loga `token=`). Rodar `npm test`. Expected: PASS.
- [ ] **Step 6:** Commit `fix(security): logs de OTP e reset sem segredo em produção`.

### Task 3: `send_failed` tipado no OTP

**Files:**
- Modify: `src/server/otp/otp.ts` (tipo de retorno de `issueOtp` e linha do `sender.send`), `src/app/s/[slug]/entrar/actions.ts:24`, `src/app/s/[slug]/entrar/page.tsx` (mapa de erros)
- Test: `tests/otp/otp.test.ts`

- [ ] **Step 1: Teste falhando:** sender que lança → `issueOtp` retorna `{ ok: false, reason: "send_failed" }` e não lança.
- [ ] **Step 2:** Rodar `npx vitest run tests/otp/otp.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Em `otp.ts`, incluir `"send_failed"` no union de `reason` e trocar a chamada por:

```ts
try {
  await args.sender.send(phone, code, { tenantSlug: args.tenantSlug });
} catch {
  console.error(`[otp] falha ao enviar código (loja=${args.tenantSlug})`);
  return { ok: false, reason: "send_failed" };
}
return { ok: true, phone };
```

- [ ] **Step 4:** Em `entrar/page.tsx`, adicionar ao mapa de erros `send_failed: "Não foi possível enviar o código. Tente novamente."` (manter `Object.hasOwn`).
- [ ] **Step 5:** `npm test && npm run typecheck`. Expected: PASS.
- [ ] **Step 6:** Commit `fix(otp): falha do sender retorna erro tipado`.

### Task 4: `dummyHash` e throttle resilientes

**Files:**
- Modify: `src/server/auth/password.ts:21-25`, `src/server/auth/throttle.ts:19,39,70-72`
- Test: `tests/auth/password.test.ts`, `tests/auth/throttle.test.ts`

- [ ] **Step 1: Teste falhando (throttle):** `hit` com linha cuja `window_start` é inválida não deve liberar. Mais simples: teste que `hit` concorrente com `resetThrottle` não lança (`Promise.all([hit(k,o), resetThrottle(k)])` repetido 20x resolve sem erro).
- [ ] **Step 2:** Rodar `npx vitest run tests/auth/throttle.test.ts`. Expected: FAIL (TypeError em `rows[0]` indefinido) ou PASS vacuamente — se passar, manter o teste como regressão e seguir.
- [ ] **Step 3: `hit`:** substituir `const row = rows[0] as unknown as Row;` por:

```ts
const row = rows[0] as unknown as Row | undefined;
if (!row) return { blocked: false }; // linha removida por reset concorrente: nova janela no próximo hit
```

e em `toDate`, tratar inválida como bloqueio conservador:

```ts
const toDate = (v: Ts): Date => {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? new Date(8.64e15) : d; // inválida = bloqueado (fail closed)
};
```

- [ ] **Step 4: `dummyHash`:** não cachear rejeição:

```ts
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword("senha-descartavel-para-tempo-constante").catch((err) => {
    dummy = undefined;
    throw err;
  });
  return dummy;
}
```

- [ ] **Step 5:** `npm test`. Expected: PASS.
- [ ] **Step 6:** Commit `fix(auth): throttle e dummyHash resilientes a falhas`.

### Task 5: Middleware — `/_next` e `/api`

**Files:**
- Modify: `src/middleware.ts:6-8`
- Test: `tests/tenancy/middleware.test.ts`

- [ ] **Step 1: Teste falhando:** request em host de loja para `/_next/webpack-hmr` e `/_next/data/x.json` deve passar (`NextResponse.next`, sem header `x-middleware-rewrite`).
- [ ] **Step 2:** Rodar `npx vitest run tests/tenancy/middleware.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Ajustar matcher para excluir todo `/_next`:

```ts
export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
```

- [ ] **Step 4:** `/api/*`: sem rotas API hoje. Registrar decisão em comentário acima do matcher: "rotas /api em hosts de loja/painel serão tratadas no sub-projeto 3 (decidir passthrough vs. rewrite)".
- [ ] **Step 5:** `npm test` e `npm run e2e`. Expected: PASS.
- [ ] **Step 6:** Commit `fix(tenancy): _next passa direto pelo middleware`.

### Task 6: Higiene do repositório

**Files:**
- Modify: `src/app/globals.css:113` (sidebar-primary escuro → zinc), `.gitignore` (duplicatas)

- [ ] **Step 1:** `--sidebar-primary: oklch(0.985 0 0);` e `--sidebar-primary-foreground: oklch(0.21 0.006 285.885);` no bloco dark.
- [ ] **Step 2:** Remover linhas duplicadas de `.gitignore`.
- [ ] **Step 3:** `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 4:** Commit `chore: tokens zinc no sidebar e .gitignore sem duplicatas`.

### Task 7: Fechamento

- [ ] **Step 1:** `npm run lint && npm run typecheck && npm test && npm run e2e:prod`. Expected: tudo verde.
- [ ] **Step 2:** Atualizar `docs/superpowers/follow-ups-fundacao.md`: marcar itens resolvidos; manter o resto como backlog.
- [ ] **Step 3:** Commit `docs: follow-ups atualizados após hardening`.
- [ ] **Step 4:** Invocar `superpowers:finishing-a-development-branch`.

## Self-Review

- Cobertura: reset=ok (T1), logs (T2), send_failed (T3), dummyHash/throttle (T4), middleware (T5), sidebar/.gitignore (T6).
- Fora de escopo (backlog): grants RLS de `bora_app`, purge de tokens, revogação de sessão na troca de senha, testes fracos de RLS, `revalidateTag` (sub-projeto 4), canal WhatsApp real (sub-projeto 5).
