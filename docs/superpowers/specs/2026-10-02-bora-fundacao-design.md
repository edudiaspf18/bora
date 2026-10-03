# Bora — Sub-projeto 1: Fundação (design)

Data: 2026-10-02
Status: aguardando revisão

## 1. Contexto e objetivo

O sistema atual (Baratão, PHP + MySQL) atende um único restaurante. O objetivo é criar o **Bora**, plataforma multi-loja de cardápio digital e pedidos para restaurantes, lanchonetes, açaiterias e quiosques. O Baratão passa a ser apenas mais uma loja (tenant) no futuro. Nenhum nome ou dado do Baratão permanece no código do Bora.

Decisões tomadas:

- Projeto novo, repositório `bora`, começando do zero. Dados atuais podem ser descartados. O repositório `baratao` serve só como referência de regras de negócio (disponibilidade por horário, estoque do dia, taxa por bairro).
- Stack: Next.js (App Router) + TypeScript + PostgreSQL + Drizzle + Zod + Tailwind + Shadcn + lucide-react.
- Tenancy: banco único, `tenant_id` em toda tabela por loja, isolamento por Row Level Security (RLS) do Postgres.
- Acesso por subdomínio por loja (`{slug}.bora.app`), com domínio próprio opcional.
- Cliente final pede como convidado (nome + telefone). Staff autentica com e-mail e senha.
- Design: regras do `CLAUDE.md` global (minimalismo Linear/Vercel/Editorial, base Zinc, uma cor de destaque).

## 2. Escopo desta spec

Inclui: estrutura do repositório, resolução de tenant, modelo de dados base, isolamento por RLS, autenticação de staff e de cliente, sistema de tema por loja, marca Bora.

Fora de escopo (sub-projetos seguintes, cada um com spec própria):

2. Catálogo (produtos, grupos de opções, combos, horários)
3. Vitrine e checkout (carrinho, pedido, taxa, cupom, modos de atendimento)
4. Painel da loja (pedidos em tempo real, estoque, dashboard, equipe)
5. Integrações (WhatsApp por loja, push, pagamento online)

## 3. Resolução de tenant

- `middleware.ts` lê o header `Host`.
  - `{slug}.bora.app` → tenant com aquele slug.
  - `bora.app` e `www.bora.app` → landing.
  - `app.bora.app` → login e painel do staff.
  - Host customizado → consulta `tenant_domains` (com cache).
- Slug desconhecido retorna 404. O middleware roda no Edge e não consulta o banco: ele só reescreve a URL para uma rota interna (`/s/{slug}` ou `/s/{host}` na vitrine, `/panel` no painel). A existência do tenant é checada no layout da vitrine, em Node, com cache curto. Acessar `/s/*` ou `/panel/*` direto, fora do host correto, retorna 404.
- Slugs reservados: `app`, `www`, `api`, `admin`, `static`.
- Em desenvolvimento, `*.localhost` resolve para o tenant.

## 4. Modelo de dados

Convenções: UUID v7 gerado pelo app nos inserts via Drizzle (o default do banco é `gen_random_uuid()`, v4, para inserts diretos como o seed); dinheiro em centavos (`integer`); datas em `timestamptz`, exibidas no timezone da loja.

**Tabelas globais (sem RLS).** `tenants` e `tenant_domains` são globais porque a vitrine precisa resolver a loja antes de saber o `tenant_id`.

| Tabela | Campos principais |
|---|---|
| `tenants` | id, slug UNIQUE, nome, vertical (`restaurante`, `lanchonete`, `acaiteria`, `quiosque`), status, timezone, país, moeda, criado_em |
| `tenant_domains` | tenant_id, host UNIQUE, verificado |
| `customers` | id, telefone UNIQUE (E.164), nome |
| `staff_users` | id, email UNIQUE, senha_hash, nome |

**Tabelas por loja (RLS)**

| Tabela | Campos principais |
|---|---|
| `staff_memberships` | tenant_id, staff_id, papel (`owner`, `manager`, `attendant`) |
| `customer_profiles` | tenant_id, customer_id (base para fidelidade e endereços por loja) |
| `tenant_settings` | tenant_id, tema (JSONB), tipos de atendimento ativos (entrega, retirada, local), pagamentos aceitos, contato, endereço |
| `audit_log` | tenant_id, actor, ação, recurso, ip, criado_em |

Também existem tabelas de apoio de auth: tokens de reset de senha, códigos OTP (hash, expiração, tentativas) e contadores de tentativas de login.

## 5. Isolamento por RLS

- Todo acesso a dados por loja passa por `withTenant(tenantId, fn)`: abre transação, executa `SET LOCAL app.tenant_id = '<id>'` e roda `fn`.
- Cada tabela por loja tem policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)` e `WITH CHECK` equivalente.
- A aplicação conecta com um papel Postgres **sem** `BYPASSRLS`. Migrations rodam com papel separado.
- Testes obrigatórios: (a) query fora de `withTenant` retorna zero linhas; (b) a loja A não lê nem escreve dados da loja B.

## 6. Autenticação

**Staff (`app.bora.app`)**

- E-mail + senha com Argon2id. Sessão JWT própria (biblioteca `jose`) em cookie `httpOnly`, `secure`, `sameSite=lax`. Não usa Auth.js: staff e cliente compartilham o mesmo módulo de sessão e o tenant ativo é um claim do próprio token.
- Staff com mais de uma loja escolhe a loja ativa. O `tenant_id` da sessão é revalidado contra `staff_memberships` a cada request.
- Papéis: `owner` (tudo, inclusive equipe e cobrança), `manager` (catálogo, pedidos, configurações), `attendant` (pedidos e estoque do dia). Checagem centralizada em `can(papel, ação)`.
- Brute force: 5 tentativas por e-mail por janela de 15 min, depois bloqueio de 15 min; por IP o limite é 60 tentativas (um IP pode ser uma rede inteira); contador no Postgres e a tentativa é reservada de forma atômica antes do Argon2.
- Reset de senha por e-mail, token de uso único, validade de 30 min.

**Cliente (`{slug}.bora.app`)**

- Pedido como convidado: nome + telefone.
- Para ver histórico, o cliente recebe código de 6 dígitos por telefone. O envio passa pela interface `OtpSender` (implementação de console em dev; WhatsApp no sub-projeto 5).
- Código: validade de 10 min, 5 tentativas, guardado com hash, rate limit por telefone e por IP.
- Sessão do cliente em cookie isolado por subdomínio. A conta `customers` é global, mas a sessão não é compartilhada entre lojas.
- Pedidos de convidado são vinculados à conta quando o telefone é verificado.

**Transversal**

- CSRF: Server Actions validam origem; rotas `route.ts` que mutam checam o header `Origin`.
- CSP com nonce gerado no middleware.
- CPF não é coletado. Se uma loja precisar, vira campo opcional do checkout (sub-projeto 3).

## 7. Tema por loja

A interface é monocromática (Zinc). Cada loja personaliza **uma cor de destaque**, logo, fonte e raio.

- Tokens fixos: `--background`, `--foreground`, `--muted`, `--border`. Tokens por loja: `--brand`, `--brand-foreground`, `--radius`. O `--primary` do Shadcn é mapeado para `--brand` no layout do tenant. (O nome `--accent` já é usado pelo Shadcn para outra coisa.)
- `tenant_settings.theme` (validado com Zod): `accent` (hex livre validado pela guarda de contraste; presets curados ficam para o painel de configurações, sub-projeto 4), `logoUrl` (URL nesta fase; upload no sub-projeto 2), `font` (3 opções curadas: Geist, Inter, uma serifada editorial), `radius` (`sm`, `md`, `lg`).
- Guarda de contraste WCAG: o sistema escolhe `brand-foreground` branco ou preto (o de maior contraste, sempre ≥ 4.5:1) e rejeita cores quase idênticas ao fundo branco ou ao fundo preto, que sumiriam em um dos modos.
- Modo claro e escuro automáticos.
- Injeção sem flash: o layout do tenant (Server Component) lê o tema (cache por slug) e escreve as variáveis em `<style nonce>` no HTML do servidor (no início do corpo da página).

**Marca Bora:** wordmark "bora" em minúsculas, tipografia pesada com `tracking-tight`. Destaque da plataforma: laranja-queimado `#EA580C`.

## 8. Estrutura do repositório

```
src/
  app/
    (platform)/   landing e login do staff
    (store)/      vitrine do cliente (por host)
    (admin)/      painel da loja
  server/
    db/           drizzle, schema, migrations, withTenant
    tenancy/      resolução de host, cache
    auth/         staff, cliente, can()
    otp/          OtpSender (console, whatsapp)
  components/ui/  Shadcn
```

Regras do projeto: Server Components por padrão; `'use client'` só com estado ou eventos; sem `any`; Tailwind apenas; ícones só de `lucide-react`; `focus-visible:` e `transition-all duration-200` em toda interação.

## 9. Ambiente e operação

- Dev: PostgreSQL local gerenciado no pgAdmin via `DATABASE_URL`, sem Docker. Verificar com `psql -lqt` e criar o banco com `createdb` se não existir.
- Hospedagem de produção: a decidir (Vercel ou VPS). Não bloqueia a Fundação.
- Migrations versionadas em arquivo (Drizzle). O schema vive no repositório.

## 10. Testes

- Unitários: `can()`, guarda de contraste, validação do tema, geração e validação de OTP.
- Integração (Postgres real): RLS (isolamento entre lojas, query sem tenant), `withTenant`, bloqueio por brute force, fluxo de reset de senha.
- E2E (Playwright): resolução de subdomínio, login do staff, 404 de slug desconhecido, tema aplicado sem flash.

## 11. Critérios de sucesso

1. Duas lojas de teste em subdomínios distintos, cada uma com seu tema, sem acesso cruzado aos dados.
2. Staff entra, escolhe a loja e só vê o que o papel permite.
3. Cliente verifica telefone por OTP (console) e recebe sessão limitada à loja.
4. Suíte de RLS passa em CI com Postgres real.
5. Nenhuma ocorrência de "baratao" no código do Bora.

## 12. Riscos

- **RLS mal configurado** (papel com `BYPASSRLS`, tabela sem policy): mitigado com teste automático que lista tabelas por loja sem policy e falha.
- **Wildcard DNS e certificado** em produção: depende da hospedagem escolhida.
- **OTP sem canal real** até o sub-projeto 5: mitigado pela interface `OtpSender`.
