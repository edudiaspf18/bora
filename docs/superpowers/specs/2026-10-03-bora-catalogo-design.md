# Bora — Sub-projeto 2: Catálogo (design)

Data: 2026-10-03
Status: aguardando revisão

## 1. Contexto e objetivo

A Fundação (sub-projeto 1) está em `main`: tenancy por host, RLS, auth de staff e de cliente, tema por loja. O Catálogo é o segundo sub-projeto: o que a loja vende, quando está disponível e como o cliente vê o cardápio.

O Baratão (PHP + MySQL, uma loja) é **inspiração**, não fonte de código nem de dados. Foram aproveitadas as regras de negócio que valem a pena (variações de tamanho, disponibilidade por horário) e corrigidos os problemas do legado (adicionais sem regra, horário que mostra só o primeiro serviço ativo, edição de produto que apaga variações, categoria ligada por nome). **Estoque não é portado.**

Público: lojas de uma pessoa (dono que também atende) e lojas com equipe. É um produto só, que começa simples e cresce com a loja. O modelo de permissões da fundação não muda: o dono tem todas, e o atendente é restrito.

## 2. Escopo

Inclui:

- Categorias, produtos, variações com preço próprio, grupos de opções com regras (mínimo e máximo), horários nomeados de disponibilidade.
- Pausa rápida ("esgotado hoje"), etiquetas dietéticas, duplicar produto e categoria.
- "Volta às 18h": item fora de horário aparece desabilitado com o horário de retorno.
- Telas de cadastro no painel (`/panel`) e listagem pública somente leitura na vitrine.
- Modelos iniciais por tipo de loja, opcionais.

Fora do v1 (registrado):

- Estoque em qualquer forma. Nenhuma tabela deste sub-projeto tem campo de quantidade.
- Combos, importação por planilha ou IA, feriados e exceções por data, preço por modo de atendimento ou por horário, upload de imagem (só URL), "mais pedidos", busca textual, tradução, sugestão de complemento.
- Carrinho, pedido e checkout (sub-projeto 3).
- Alerta sonoro de pedido novo (sub-projeto 4, anotado como requisito).

## 3. Modelo de dados

Convenções da fundação: UUID v7 gerado pelo app, dinheiro em centavos (`integer`), `timestamptz`, `tenant_id` em toda tabela com RLS `tenant_isolation` e acesso só por `withTenant`.

| Tabela | Campos principais |
|---|---|
| `catalog_categories` | tenant_id, nome, ordem, ativo |
| `catalog_products` | tenant_id, category_id (FK), nome, descrição, image_url, ordem, ativo, `paused_until` (timestamptz, nulo = não pausado), `dietary` (text[]) |
| `catalog_variants` | tenant_id, product_id (FK), nome, `price_cents`, ordem, ativo |
| `option_groups` | tenant_id, nome, `min_select`, `max_select`, ordem |
| `option_items` | tenant_id, group_id (FK), nome, `price_delta_cents` (≥ 0), ordem, ativo |
| `product_option_groups` | tenant_id, product_id, group_id, ordem (PK composta) |
| `schedules` | tenant_id, nome |
| `schedule_windows` | tenant_id, schedule_id (FK), `weekday` (0-6), `opens_min` (0-1439), `closes_min` (1-1440) |
| `category_schedules`, `product_schedules` | tenant_id, FK, schedule_id (PK composta) |

Decisões:

- **Obrigatório é `min_select >= 1`.** Sem coluna `required`: uma regra só.
- **Todo produto tem ao menos uma variação.** Produto sem tamanho tem a variação "Único". O preço fica sempre em `catalog_variants`.
- **Janelas em minutos desde a meia-noite.** `closes_min <= opens_min` significa que cruza a meia-noite; `opens_min = closes_min` é recusado. 24h é `0..1440`.
- **`paused_until` em vez de booleano.** "Esgotado hoje" grava a próxima meia-noite no fuso da loja. Volta sozinho, sem job. Pausa indefinida usa uma data distante.
- **Etiquetas dietéticas** são `text[]` validado por Zod contra lista fixa (`vegan`, `vegetarian`, `gluten_free`, `lactose_free`, `contains_peanut`, `contains_nuts`, `contains_egg`, `contains_shellfish`, `spicy`).
- **Arquivar, nunca apagar.** Produto e categoria usam `ativo=false`. Pedidos futuros guardam snapshot do item, então o catálogo muda sem reescrever o histórico.
- **FKs compostas com `tenant_id`** nas tabelas de ligação, para que uma ligação entre lojas diferentes seja impossível no banco, não só na aplicação.
- **Grants:** `bora_app` já recebe CRUD por default privileges; as tabelas novas entram com RLS habilitada na mesma migration.

## 4. Regras de disponibilidade

Função pura em `src/server/catalog/availability.ts`, sem banco e sem relógio global:

```ts
type Availability =
  | { state: "available" }
  | { state: "paused"; until: Date }
  | { state: "out_of_hours"; nextOpensAt: Date | null };

itemAvailability(item, now: Date, timezone: string): Availability
```

Ordem de precedência:

1. Arquivado (produto ou categoria): fora da listagem, não é um estado.
2. Pausado (`paused_until > now`): `paused`. Vence o horário.
3. Horários efetivos: os do produto, se houver; senão os da categoria; senão sempre disponível.
4. Aberto se qualquer horário efetivo tiver janela aberta agora. Isso corrige o "primeiro serviço ativo" do Baratão.
5. Fechado: `out_of_hours` com `nextOpensAt` (próximo início de janela em até 7 dias, ou `null`).

Detalhes fixados por teste: dia e hora locais via `Intl.DateTimeFormat` com o fuso da loja; janela que cruza a meia-noite vale até o dia seguinte; abre em `opens_min` inclusive e fecha em `closes_min` exclusivo; fuso fora do Brasil; vários horários ligados usam o menor `nextOpensAt`.

O sub-projeto 3 reutiliza a mesma função ao confirmar o pedido.

## 5. Camada de servidor e permissões

Diretório `src/server/catalog/`:

| Arquivo | Responsabilidade |
|---|---|
| `schemas.ts` | Zod de entrada e `parseBRL` |
| `availability.ts` | `itemAvailability` |
| `queries.ts` | `listMenu(tenantId, now, tz)` (vitrine) e `listForPanel(tenantId)` |
| `commands.ts` | criar, editar, arquivar, reordenar, duplicar, pausar |
| `templates.ts` | modelos iniciais por tipo de loja |

Regras:

- Toda escrita começa com `requireAction("catalog:edit")` (dono e gerente). **Pausar** exige só `stock:edit`, que o atendente já tem: quem está no balcão pausa sem poder editar preço.
- Cada comando grava auditoria (`catalog.product.create`, `catalog.product.pause` etc.) com o id em `resource`.
- Nenhum comando aceita `tenant_id` do cliente. Id de outra loja não existe pela RLS e devolve `not_found`.
- Resultado tipado, sem exceção para erro de negócio: `{ ok: true, id } | { ok: false, reason: "not_found" | "invalid" }` (não há restrição de unicidade que gere conflito neste sub-projeto); `applyTemplate` devolve `reason: "not_empty"`.
- Duplicar copia produto, variações, grupos e horários em uma transação, com nome "(cópia)" e `ativo=false`. Duplicar categoria copia a categoria e seus produtos.
- Reordenar recebe a lista completa de ids; id estranho ou ausente aborta a operação.
- A listagem depende de `now`, então não entra em cache de página.
- Sem rotas `/api`: só Server Actions e Server Components. A decisão sobre `/api` em hosts de loja fica para o sub-projeto 3.

### Modelos iniciais

`templates.ts` define 4 modelos (restaurante, lanchonete, açaíteria, quiosque) com categorias, produtos de exemplo, variações e grupos de opções. O botão "Começar com um modelo" aparece só no estado vazio do catálogo e só funciona se a loja não tem nenhuma categoria. Tudo é criado em uma transação, editável e arquivável. Quem prefere cadastrar do zero ignora o botão. Não é um assistente obrigatório.

## 6. Painel

**Mudança estrutural.** O `panel/layout.tsx` atual é uma coluna estreita para login. Passa a haver dois route groups em `src/app/panel/`:

- `(auth)/`: login, esqueci-senha, redefinir-senha, com o layout estreito atual (apenas movidos).
- `(shell)/`: página inicial e `catalogo/*`, com cabeçalho da loja, navegação e largura total.

O `panel/layout.tsx` raiz vira passthrough.

Rotas: `/catalogo`, `/catalogo/produtos/novo`, `/catalogo/produtos/[id]`, `/catalogo/opcoes`, `/catalogo/opcoes/[id]`, `/catalogo/horarios`, `/catalogo/horarios/[id]`.

**Lista.** Categorias como seções, produtos em linhas com borda de 1px: nome, faixa de preço, etiquetas e selo de estado ("Pausado até 00:00", "Fora do horário · volta às 18h", "Arquivado"), todos em zinc. Ações por linha: Esgotado hoje / Voltar a vender, editar, duplicar. A pausa fica em destaque no topo, um toque. Reordenar por botões subir e descer (acessível, sem dependência nova). Atendente vê tudo somente leitura e só tem a pausa.

**Formulário do produto.** Uma página. Produto novo pede só nome, preço e categoria; o resto fica em "Mais opções" recolhido:

1. Dados: nome, descrição, categoria, URL da imagem com pré-visualização.
2. Variações: linhas com nome e preço em reais (único trecho cliente). `parseBRL` converte para centavos em um só ponto.
3. Etiquetas dietéticas.
4. Grupos de opções: marcar da biblioteca ou criar dentro do produto ("Adicionar opções"), que fica salvo na biblioteca.
5. Horários: "Sempre disponível" ou "Só em certos horários" (escolhe horários nomeados). Nenhum marcado herda da categoria.
6. Arquivar e duplicar.

**Grupos de opções.** Nome, mínimo, máximo, itens com acréscimo. Texto de ajuda em linguagem normal ("Obrigatório, escolha 1", "Opcional, até 3").

**Horários.** Nome e janelas (dia, abre, fecha via `<input type="time">`, convertidos para minutos). Aviso quando a janela cruza a meia-noite.

**Regras de UI.** Mobile primeiro (uma mão, alvos grandes), também em desktop. Server Components por padrão; `'use client'` só nas linhas de variação, nas janelas de horário e onde houver estado; sem `useEffect`. Formulários são Server Actions com `useActionState`. Componentes Shadcn novos: `textarea`, `select`, `checkbox`, `badge`. Ícones só `lucide-react`. Zinc, bordas de 1px, uma cor de destaque só na ação primária.

**Tom.** Textos curtos e amigáveis em PT-BR, estados vazios com ilustração simples em linha e ação clara, confirmações com micro-animação sutil (`transition-all duration-200`). Sem gradientes, sem glassmorphism.

## 7. Vitrine

A home da loja (`/s/[slug]/page.tsx`) passa a mostrar o cardápio, somente leitura.

- Página dinâmica (`export const dynamic = "force-dynamic"`). Tenant e tema seguem no cache de 60s; só `listMenu` roda por request.
- Barra de categorias fixa com âncoras (`#categoria`, sem estado cliente).
- Linha de produto: nome, descrição curta, "a partir de R$ X" quando há mais de uma variação, imagem pequena opcional, etiquetas em texto zinc.
- Item `out_of_hours`: esmaecido, "Disponível a partir das 18:00" (ou "Disponível às terças, 18:00"). Item `paused`: esmaecido, "Esgotado hoje". Nada é clicável para pedir ainda.
- Categoria sem item visível não aparece. Loja sem catálogo mantém o texto atual.
- Filtro por etiqueta (`?dieta=vegan`) lido no servidor, com chips só das etiquetas existentes.
- Detalhe do produto em `/p/[id]`: variações, preços e grupos com a regra em texto, somente leitura.
- `image_url` só aceita `https:`. O CSP (`src/server/security/csp.ts`) já libera `img-src https:`; um teste passa a travar esse comportamento. `<img>` com `loading="lazy"`, `width` e `height`.
- Metadados com o nome da loja. Sem JSON-LD no v1.

## 8. Testes

Vitest contra `bora_test` e Playwright, mesmo padrão da fundação.

| Camada | O que prova |
|---|---|
| `availability.test.ts` | Fronteiras abre/fecha, janela que cruza a meia-noite, herança produto > categoria, vários horários, `nextOpensAt` e `null`, pausa vence horário, fuso fora do Brasil |
| `schemas.test.ts` | `min_select <= max_select`, `opens_min != closes_min`, preço inteiro >= 0, `image_url` só `https:`, etiqueta inválida, `parseBRL` |
| `catalog.rls.test.ts` | Loja A não lê nem escreve dados da B; id de outra loja dá `not_found`; ligação entre lojas recusada no banco |
| `commands.test.ts` | Arquivar não apaga variações; duplicar copia tudo com `ativo=false`; reordenar com id estranho aborta; atendente pausa mas não edita preço; auditoria gravada; modelo só aplica em catálogo vazio |
| `queries.test.ts` | Arquivados excluídos; categoria arquivada esconde produtos; estados corretos |
| e2e | Dono cadastra produto com variação, grupo e horário e a vitrine mostra; pausa rápida; atendente sem edição; filtro `?dieta=`; modelo inicial; CSP libera `https:` e bloqueia `http:`; e2e de staff existente continua verde após o move para `(auth)` |

## 9. Critérios de sucesso

1. Dono e gerente fazem o ciclo completo no painel. Atendente só pausa.
2. Dono sozinho cadastra um produto simples (nome, preço, categoria) sem tocar em horários nem grupos.
3. A vitrine respeita horário e pausa no fuso da loja.
4. Nenhuma tabela do sub-projeto tem campo de estoque.
5. Isolamento entre lojas provado por teste e imposto pelo banco.
6. `lint`, `typecheck`, `test`, `e2e:prod` e CI verdes.

## 10. Riscos

- **Mover rotas do painel** pode quebrar redirects e o e2e de staff. Mitigação: primeira task do plano, com e2e antes e depois.
- **Janelas que cruzam a meia-noite** são fonte clássica de bug. Mitigação: casos de borda obrigatórios.
- **Imagem por URL externa** pode quebrar ou sumir. Aceito no v1; upload fica no backlog.
- **Virada de dia da pausa** depende do fuso da loja. Mitigação: teste de virada de dia.
- **Modelos iniciais** podem envelhecer ou destoar de uma loja real. Mitigação: são dados editáveis, aplicados só uma vez.
