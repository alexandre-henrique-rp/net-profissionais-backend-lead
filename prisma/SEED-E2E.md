# Seed de homologação (E2E) — `TASK-S06-06`

Cenário determinístico para a homologação de ponta a ponta com Playwright.
Recria uma **corporação isolada** (`e2e.netprofissional.test`), com dados que
exercitam as telas e as regras do MVP sem tocar no tenant de desenvolvimento.

## Como rodar

```bash
cd backend

# 1. aplica as migrations (uma vez por banco)
yarn prisma:deploy

# 2. recria o cenário de homologação
yarn prisma:seed:e2e
```

Variáveis obrigatórias no `backend/.env` (veja `.env.example`):

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | Conexão do Postgres |
| `SEED_E2E_PASSWORD` | Senha de todas as contas de teste |
| `SEED_E2E_WEBHOOK_TOKEN` | Segredo HMAC do webhook da corporação de teste |
| `SEED_E2E_INVITE_TOKEN` | Token do convite pendente (fluxo de ativação) |

A seed **não** imprime a senha; ela só aparece no ambiente.

## Idempotência: reset, não `upsert`

Cada execução apaga o tenant de homologação e recria tudo com os **mesmos
IDs**. O reset roda numa transação e apaga na ordem das dependências (notas →
oportunidades → datas → contatos → etapas → usuários → tenant), porque
`TenantLead.stageId` é `ON DELETE RESTRICT` e o cascade puro do tenant pode
falhar no Postgres. Isso devolve o estado inicial mesmo depois de o teste
anterior ter captado leads, movido cards ou criado notas. Em seguida, são
removidos os `Lead` globais que ficaram sem vínculo — os do cenário e os que o
teste criou por webhook ou cadastro manual (capturados antes do reset).

> O ID do tenant é derivado de uma chave fixa (`E2E_TENANT_ID` em
> `prisma/e2e-scenario.ts`). Se esse ID existir com outro nome, a seed aborta
> sem apagar nada.

## Contas

| Papel | E-mail | Situação | Para testar |
|---|---|---|---|
| Administrador | `admin@e2e.netprofissional.test` | ACTIVE | visão gerencial, usuários, configurações |
| Vendedor 1 | `vendedor1@e2e.netprofissional.test` | ACTIVE | funil completo (1 card por etapa) |
| Vendedor 2 | `vendedor2@e2e.netprofissional.test` | ACTIVE | filtro por vendedor / card de outro dono |
| Captador | `captador@e2e.netprofissional.test` | ACTIVE | captação, esteira, dashboard do captador |
| Pendente | `pendente@e2e.netprofissional.test` | PENDING | ativação por convite (48 h) |
| Bloqueado | `bloqueado@e2e.netprofissional.test` | BLOCKED | login recusado |

Todas usam a senha de `SEED_E2E_PASSWORD`. Há **um único administrador**, então
rebaixá-lo responde `422 LAST_ADMIN`.

## Cenário de dados

- **Pool (5 disponíveis)**: UF `MG`/`SP`, setores variados, portes `ME`/`EPP`/
  `DEMAIS`, temperaturas `QUENTE`/`MORNO`/`FRIO`, e um lead **PF** com CPF.
- **Devolvido ao Pool (1)**: sem responsável, com `claimedAt` preservado.
- **Vendedor 1 (8 cards)**: um card em cada uma das sete etapas, incluindo
  card **perdido** com motivo `preco` e card **ganho**.
- **Vendedor 2 (2 cards)**: carteira separada para o filtro do Administrador.
- **Alerta de inatividade**: card nunca contatado e card parado há 5 dias.
- **Agenda do dia**: previsão **vencida**, previsão **para hoje** e um card só
  com inatividade.
- **Aniversariantes**: um aniversário de sócio em `+2` dias e um da empresa em
  `+6` dias (calculados na hora da seed, então sempre dentro da janela de 7).
- **Gaveta**: o lead `solar-tech` tem contato com telefone (WhatsApp), data
  especial e **três notas** na linha do tempo.

## Webhook de captura

`POST /api/v1/webhooks/leads/{tenantId}` com assinatura HMAC-SHA256 do **corpo
bruto** usando `SEED_E2E_WEBHOOK_TOKEN`:

```bash
BODY='{"lead":{"document":"12.345.678/0001-90","company_name":"Empresa Webhook E2E","contacts":[{"name":"Ana Souza","phone":"31999998888"}]},"lgpd_consent":true}'
TS=$(date +%s)
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SEED_E2E_WEBHOOK_TOKEN" -hex | sed 's/^.* //')

curl -i -X POST "http://localhost:3000/api/v1/webhooks/leads/<tenantId>" \
  -H "Content-Type: application/json" \
  -H "X-Timestamp: $TS" \
  -H "X-Signature: sha256=$SIG" \
  -H "Idempotency-Key: e2e-$(date +%s)" \
  --data-raw "$BODY"
```

O corpo precisa ser exatamente o mesmo dos dois lados — a assinatura usa os
bytes originais (`rawBody`), não o JSON re-serializado.

## Segurança

- Em `NODE_ENV=production` a seed se recusa a rodar sem `SEED_E2E_ALLOW_PROD=1`.
- Nenhum segredo no código: senha, token do webhook e token do convite vêm do
  ambiente.
- O tenant de homologação é identificado por nome (`NetProfissional E2E
  (homologação)`) antes de qualquer `delete`; um ID reaproveitado aborta a
  execução.

## Onde encostar no Playwright

- Login: `/login` com `admin@e2e.netprofissional.test` + `SEED_E2E_PASSWORD`.
- Ativação: `/ativar-conta?token=<SEED_E2E_INVITE_TOKEN>`.
- As telas usam rótulos acessíveis (não há `data-testid`), então prefira
  `getByRole`/`getByLabel` aos seletores de CSS.
- O cenário é reaplicado antes da suíte (`globalSetup` ou `webServer` +
  `yarn prisma:seed:e2e`), garantindo o mesmo ponto de partida em cada rodada.
