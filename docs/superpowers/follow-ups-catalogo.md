# Pendências do Catálogo (servidor)

Origem: revisão final da branch feat/catalogo.

## Catálogo (servidor) → plano da UI

- Toda Server Action de catálogo chama `requireAction("catalog:edit")`; exceção: pausar/retomar (`pauseProduct`), que chama `requireAction("stock:edit")`.
- O teste (e2e/unit) "atendente pausa mas não edita preço" vive no plano da UI.
- Opcional: `Ctx` com marca (branded type) emitido só por `requireAction`, para que esquecer a checagem quebre o typecheck.
- `buildPanel` descarta produtos sem variação ativa (latente; inalcançável pelos writers atuais).
