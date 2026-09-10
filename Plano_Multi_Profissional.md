# Plano — Suporte a múltiplos profissionais

**Status:** Fase 1 (fundação) **NO AR em produção** desde 2026-09-10 — commits `b761f93`, `05127bc`, `2939bf7`. Migration 014 + seed aplicados no banco de produção da Lumi (`whatsapp-teste`, 1 profissional: Dra. Aline) e no banco do demo standalone (3 profissionais fictícios); standalone-bridge e admin-panel redeployados; seletor confirmado aparecendo no painel do demo. **Fase 1.5** (CRUD de profissionais no painel) e **Fases 2–5** não começaram.

## Feito na Fase 1

- `db/migrations/014_profissionais.sql` — `profissionais` (com `especialidades text[]`, `aceita_primeira_consulta`, `padrao` unique parcial), `profissional_horarios` (aditiva, fallback pro singleton), `consultas.profissional_id` uuid nullable. Só schema.
- `db/seed-profissionais.js` + `db/profissionais.aline.json` (Lumi: 1 profissional) + `db/profissionais.demo.json` (standalone demo: 3 com agendas distintas) + `.exemplo.json`. Upsert idempotente por `nome` + backfill de `consultas.profissional_id` pro padrão.
- `standalone-bridge`: `buscarConfiguracaoHorarios(profissionalId?)` com merge; `listarProfissionais()`; `resolverProfissionalParaAgenda({profissionalId, especialidade})`; verificar/criar/remarcar escopam conflito por profissional; `buscarAgendamentosPaciente` devolve `profissionalNome`; `listarAgendaSemana` aceita filtro; rota `GET /profissionais`.
- `admin-panel`: `GET /api/profissionais` (via bridge, tolerante a 404); `<select>` de filtro no topo da Agenda + campo de profissional na Nova consulta, ambos só aparecem com 2+ profissionais ativos; filtro client-side sobre `agendaCache`.
- **Retrocompatível:** 0 profissionais cadastrados (ou migration não rodada) => tudo opera como hoje. Testado contra `whatsapp-teste` (Aline) e `lumi_standalone_teste` (3 demo).

### Ainda aberto dentro do escopo "fundação"
- **CRUD de profissionais no painel** (adicionar/editar/desativar sem re-rodar o seed) — não feito. Por enquanto: editar o JSON e re-rodar `db/seed-profissionais.js`. É a "Fase 1.5".
- Colorir a agenda por profissional quando "Todos" (usar `profissionais.cor`) — não feito, polimento.

---

**Decisões do Tiago que abriram este plano:**
- Preparar Demo **e** PROD para multi-profissional, mesmo que PROD só tenha a Dra. Aline por enquanto.
- A tabela de profissionais precisa de **especialidade**, pra rotear o paciente quando a necessidade for específica.
  Exemplo dado: *"preciso tratar o canal"* → *"o Dr. Fulano é endodontista e tem a próxima agenda livre dia X às Y horas."*
- **Simples Dental / Playwright (`server.js` da raiz) fica pra depois** — só adaptar quando uma clínica SD com mais de um dentista realmente assinar. Risco de regressão no calendário real de produção por benefício zero agora.

Relacionado: [[project_configuracao_horarios]], [[project_standalone_bridge]], [[feedback_prompt_vs_code_guarantees]], [[feedback_n8n_draft_publish]], `Template_Prompt_Assistente_IA.md`.

---

## 0. Estado atual (levantado antes de escrever este plano)

O sistema inteiro assume **um profissional só**, em todas as camadas:

| Camada | Situação |
|---|---|
| `public.consultas` (migration 011) | Sem coluna de profissional. Na sincronização com o Simples Dental o sufixo "` - Dr(a). Fulano`" do título é **removido de propósito** (`nomeSemSufixoProfissional` em `server.js`) e descartado. |
| `public.configuracao_horarios` (migration 009) | Linha **única** (`CHECK id = 1`). Um expediente pra clínica toda. |
| `standalone-bridge/consultas.js` | `verificarDisponibilidade` calcula slots contra **todas** as consultas juntas; `criarAgendamento` não recebe profissional; conflito é global; `buscarAgendamentosPaciente` devolve `{paciente, status, jaOcorreu, horário}` — **sem dentista**. |
| `server.js` (raiz / Simples Dental) | `criarAgendamento` preenche o campo "profissional" do SD com `process.env.SIMPLES_DENTAL_PROFISSIONAL \|\| 'Aline Ramos Bentivegna'` — fixo. |
| Prompt n8n (`system-prompt.txt` / template) | `{{NOME_PROFISSIONAL}}` é variável única. Texto todo no singular. Nenhuma regra de "pergunta com qual dentista" nem de "diz o nome do dentista ao confirmar". |
| `admin-panel` | Sem seletor de profissional. Existe o padrão visual `.seletor-janela` (pills) pra reaproveitar. |
| Demo / `lumi-harness` | Persona única ("Dra. Camila Duarte"); mocks espelham 1 profissional. |

---

## 1. Modelo de dados — migration `014_profissionais.sql`

### 1.1 `public.profissionais`

```sql
CREATE TABLE IF NOT EXISTS public.profissionais (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                      text NOT NULL,          -- como aparece pro paciente: "Dra. Aline Bentivegna"
  especialidades            text[] NOT NULL DEFAULT '{}',  -- {"Ortodontia","Harmonização Orofacial",...}
  especialidade_principal   text,                   -- opcional, pra desempate/exibição curta
  aceita_primeira_consulta  boolean NOT NULL DEFAULT true, -- especialista que só vê encaminhado = false
  ativo                     boolean NOT NULL DEFAULT true, -- inativo: não oferecido, some do painel
  padrao                    boolean NOT NULL DEFAULT false,-- o fallback ("tanto faz" / sem match de especialidade)
  cor                       text,                   -- hex, pra colorir a agenda por profissional (polimento)
  ordem                     smallint NOT NULL DEFAULT 0,   -- ordem de exibição no painel
  observacoes               text,                   -- notas internas
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  atualizado_em             timestamptz NOT NULL DEFAULT now()
);

-- no máximo um profissional padrão
CREATE UNIQUE INDEX IF NOT EXISTS uniq_profissional_padrao
  ON public.profissionais (padrao) WHERE padrao;
```

**Seed PROD:** uma linha — Dra. Aline Bentivegna, `padrao = true`, `ativo = true`,
`especialidades = {Ortodontia, "Invisalign", "Harmonização Orofacial", "Clareamento Dental", "Odontopediatria"}`.
Resultado: PROD continua idêntico (um profissional, é o padrão).

**Seed Demo:** 3 linhas, agendas diferentes —
Dra. Camila Duarte (Ortodontia/Clínico, `padrao`), Dr. Rafael Nunes (Endodontia), Dra. Beatriz Lima (Implantodontia).

### 1.2 `public.consultas.profissional_id`

```sql
ALTER TABLE public.consultas
  ADD COLUMN IF NOT EXISTS profissional_id uuid REFERENCES public.profissionais(id);

CREATE INDEX IF NOT EXISTS idx_consultas_profissional
  ON public.consultas (profissional_id, inicio);

-- backfill: toda consulta existente passa a ser do profissional padrão
UPDATE public.consultas
   SET profissional_id = (SELECT id FROM public.profissionais WHERE padrao)
 WHERE profissional_id IS NULL;
```

Nullable de propósito: linhas antigas, sync do SD que ainda não resolve, clínica de 1 profissional.

### 1.3 `public.profissional_horarios` (expediente por profissional)

```sql
CREATE TABLE IF NOT EXISTS public.profissional_horarios (
  profissional_id           uuid PRIMARY KEY REFERENCES public.profissionais(id) ON DELETE CASCADE,
  horarios                  jsonb NOT NULL,        -- mesma forma de configuracao_horarios.horarios
  duracao_consulta_minutos  integer,              -- NULL = herda de configuracao_horarios
  sabado_data_referencia    date,                 -- NULL = herda de configuracao_horarios
  atualizado_em             timestamptz NOT NULL DEFAULT now()
);
```

**Regra de fallback:** profissional sem linha aqui usa `configuracao_horarios` (o singleton continua sendo o padrão da clínica). A migration é não-destrutiva — **não** mexe no `CHECK (id = 1)` de `configuracao_horarios`, e nada precisa de linha em `profissional_horarios` pra continuar funcionando.

`db.js` ganha `buscarConfiguracaoHorarios(profissionalId?)` que faz o merge (linha do profissional sobre o singleton) e `buscarProfissionalPadrao()`.

---

## 2. `standalone-bridge` (a fonte de verdade é `public.consultas` — caso mais limpo)

### 2.1 `listarProfissionais()` — nova função + rota

`SELECT id, nome, especialidades, especialidade_principal, aceita_primeira_consulta, padrao
 FROM public.profissionais WHERE ativo ORDER BY ordem, nome`

Rota nova no `server.js` da bridge: `GET /profissionais`.
Consumida por: (a) o n8n (nova tool "Lista Profissionais"), (b) o `admin-panel` (dropdown).

### 2.2 `verificarDisponibilidade({ diaSemana, periodo, profissionalId?, especialidade? })`

- **`profissionalId` informado:** expediente = `buscarConfiguracaoHorarios(profissionalId)`; janela de conflito = `consultas WHERE profissional_id = $x AND ...`.
- **`especialidade` informada (sem id):** resolve pro(s) profissional(is) com aquela especialidade; se um só, usa ele; se vários, devolve por profissional.
- **Nada informado:**
  - 1 profissional ativo → comportamento de hoje, inalterado.
  - vários → devolve os slots do **profissional padrão** + `outrosProfissionais: [{id, nome, especialidades, proximoSlot}]` pra Lumi conseguir pivotar sem uma segunda tool call.

### 2.3 `criarAgendamento({ ..., profissionalId? })`

- Resolução: `profissionalId` explícito → usa; senão, se 1 ativo → esse; senão → `padrao`.
- Grava em `consultas.profissional_id`.
- **Mudança de semântica no conflito:** hoje qualquer sobreposição bloqueia o slot. Depois, só sobreposição **com o mesmo profissional** (`AND profissional_id = $x`). É o comportamento correto pra multi-prof, mas é uma mudança real — documentar. Pra clínica de 1 profissional (todas as linhas com o mesmo id) o efeito é nulo.

### 2.4 `buscarAgendamentosPaciente`

`LEFT JOIN public.profissionais p ON p.id = c.profissional_id`
→ cada item do resultado ganha `profissionalNome: p.nome` (ou `null`).
A regra de "sempre diga o nome" no prompt se apoia neste campo (código, não prosa — [[feedback_prompt_vs_code_guarantees]]).

### 2.5 `remarcarAgendamento({ ..., profissionalId? })`

Conflito por profissional. Trocar de profissional na remarcação: **não** por padrão (mantém o mesmo), só se `profissionalId` vier explícito e diferente.

### 2.6 `listarAgendaSemana({ semanas, profissionalId? })`

Filtro opcional pro painel; devolve `profissionalId` + `profissionalNome` por item (pra colorir/agrupar).
`mudarStatusAgendamento` / `mudarRotuloAgendamento`: sem mudança (operam por id).

---

## 3. n8n — prompt + tools (PROD + DEV + Standalone, os 3)

Disciplina de sempre: `realinha-draft` → GET → conferir texto exato → PUT → `/activate` → GET conferir `versionId === activeVersionId` → sticky vermelha ([[feedback_n8n_draft_publish]], [[feedback_n8n_red_sticky]]). `Template_Prompt_Assistente_IA.md` atualizado no mesmo passo (não há sync automático).

### 3.1 Tool nova: **"Lista Profissionais"**

Retorna `[{ id, nome, especialidades, especialidadePrincipal, aceitaPrimeiraConsulta, padrao }]`.
A Lumi chama quando: o paciente descreve uma necessidade que casa com uma especialidade, pergunta "com qual dentista", ou precisa oferecer escolha.

### 3.2 Tools existentes ganham argumento

- **"Verifica Disponibilidade"**: `profissionalId?` e/ou `especialidade?` (a Lumi pega os ids da Lista Profissionais).
- **"Cria Agendamento"**: `profissionalId?`.
- **"Busca Agendamentos do Paciente"**: resultado já traz `profissionalNome` (vem do §2.4, sem novo argumento).

### 3.3 Regras novas no prompt

1. **Sempre dizer o nome do profissional** ao confirmar e ao ler um agendamento de volta:
   *"Sua consulta é com a Dra. Aline no dia 12/03 às 14h."*
2. **Roteamento por especialidade** (o exemplo do Tiago): se o paciente descreve uma necessidade ligada a uma especialidade que a clínica separa por profissional (canal → Endodontia, implante → Implantodontia, etc.) e existe profissional pra isso →
   *"O Dr. Rafael é endodontista e tem a próxima agenda livre dia X às Y."*
   Se ambíguo ou "tanto faz" → profissional padrão.
3. **Guarda de 1 profissional (anti-ruído / anti-regressão):** se a Lista Profissionais retornar **um só**, NUNCA perguntar "com qual", NUNCA citar especialidade pra escolher — só dizer o nome dele ao confirmar. O fluxo pra Aline tem que ficar idêntico ao de hoje.
4. **Encaminhamento sem agenda própria:** se `aceitaPrimeiraConsulta = false` pro profissional que casaria, a Primeira Consulta vai pro profissional padrão e o encaminhamento interno pro especialista segue as regras de `DUVIDA_PROCEDIMENTO` / pendência.

### 3.4 `Template_Prompt_Assistente_IA.md`

Novo bloco no núcleo fixo (multi-profissional + roteamento por especialidade), com a variável `{{NOME_PROFISSIONAL}}` virando "o profissional padrão" e o texto tolerando 1..N profissionais via a guarda do item 3.

---

## 4. `admin-panel`

- **Seletor no topo** (o que o Tiago descreveu: "Dra Aline Bentivegna ▾"): `<select>` no estilo `.seletor-janela`, populado por `GET /api/profissionais` (rota nova do painel → `listarProfissionais` da bridge). Opções: cada profissional ativo + "Todos". Default: o `padrao`.
  Escopo: filtra a página **Agenda** (passa `profissionalId` pra `/api/agenda/consultas`) e pré-seleciona o profissional na criação manual de consulta.
- **CRUD de profissionais** — card em "Configurações" (mesmo padrão de Horários / Lições aprendidas): listar, adicionar, editar (nome, especialidades, ativo, padrão, cor, expediente próprio), desativar. Onboarding de um 2º dentista **não** deve exigir migration.
- **Agenda visual**: quando "Todos", colorir por `profissionais.cor` (polimento, pode ficar pra depois).
- **Analytics por profissional**: futuro (Fase 5).

---

## 5. Demo + `lumi-harness`

- **Demo DB**: seed dos 3 profissionais (§1.1) + uma linha em `profissional_horarios` pra cada (agendas diferentes, pra dar o que demonstrar).
- **`lumi-harness/mock-tools.js`**: `profissional` nos seeds de agendamento e no retorno de `buscar_agendamentos_paciente`; mock de `lista_profissionais`; `verificar_disponibilidade` / `criar_agendamento` aceitam `profissionalId`; `criarSessao` ganha `seedProfissionais`.
- **Checks novos**:
  - `check-multiprofissional-nome-na-confirmacao.js` — marca consulta, a confirmação nomeia o profissional.
  - `check-multiprofissional-roteamento-especialidade.js` — "preciso tratar canal" → oferece o endodontista por nome + próximo horário.
  - `check-multiprofissional-desambiguacao.js` — paciente não especifica → pergunta ou usa o padrão corretamente.
  - `check-um-profissional-sem-ruido.js` — clínica de 1 profissional → Lumi nunca pergunta "com qual", fluxo idêntico ao de hoje (**guarda de regressão**).

---

## 6. Sequência (fases)

| Fase | Entrega | Testável por |
|---|---|---|
| **1 — Fundação** ✅ **NO AR** | migration 014 (profissionais + `profissional_id` + `profissional_horarios`), funções da `standalone-bridge`, rota `listarProfissionais`, seletor no painel. Aplicado em produção 2026-09-10 (Lumi PROD = só Aline, zero mudança de comportamento; Demo = 3). Falta CRUD no painel (Fase 1.5). | painel, ponta a ponta, sem tocar na Lumi |
| **2 — Lumi** | tool nova, regras de prompt (nome + roteamento + guarda de 1 prof), os 3 workflows, template, checks do harness. | `lumi-harness` |
| **3 — Demo** | personas do demo + `Roteiro_Demo_Vendas.md` mostrando o fluxo multi-prof. | roteiro de venda |
| **4 — Simples Dental (adiado)** | parsear "` - Dr(a).`", filtrar o calendário do SD por profissional, passar o profissional na criação via Playwright. | **gatilho:** clínica SD com >1 dentista assina |
| **5 — futuro** | Analytics por profissional; `clinicorp-bridge` no mesmo contrato. | — |

### 6.1 Passos pra aplicar a Fase 1 em produção (Tiago)

Ordem importa: migration **antes** do redeploy do código.

1. **Migration 014** em cada banco real:
   - Lumi PROD: `node db/run-migration.js 014_profissionais.sql` (com `DATABASE_URL` do banco de produção da Lumi).
   - Banco do demo standalone: idem, com o `DATABASE_URL` do demo.
   - (Se houver clínica standalone real já no ar: idem no banco dela.)
2. **Seed** em cada banco:
   - Lumi PROD: `node db/seed-profissionais.js db/profissionais.aline.json`.
   - Demo: `DATABASE_URL="<demo>" node db/seed-profissionais.js db/profissionais.demo.json`.
   - É idempotente — pode rodar de novo sem medo.
3. **Redeploy no Easypanel**: `standalone-bridge` (rota `/profissionais` + agenda por profissional) e `admin-panel` (seletor). O `server.js` da raiz **não** precisa (Fase 4).
4. Conferir no painel do demo: seletor aparece com os 3, filtra a agenda.

---

## 7. Decisões de design a fechar na Fase 1

- Tipo do `id` de `profissionais` — **uuid** (proposto) vs smallint.
- `especialidades` como `text[]` (proposto) vs `text` único.
- Vocabulário de especialidades — lista semeada que o painel oferece + texto livre permitido (proposto).
- `verificarDisponibilidade` sem `profissionalId` e com >1 profissional — devolver padrão + `outrosProfissionais` (proposto) vs exigir o id.
- Remarcação trocando de profissional — não por padrão (proposto).
- Mudança de semântica do conflito (por profissional em vez de global) — é o comportamento pretendido; documentar pra qualquer clínica que hoje compartilha uma agenda informalmente entre 2 pessoas.
- Default do seletor do painel — o `padrao` (proposto) vs "Todos".
- `aceita_primeira_consulta` entra na v1 — **sim** (proposto): barato e o exemplo do roteamento já implica especialista que não pega primeira consulta.

## 8. Riscos / regressão

- **PROD tem que ficar idêntico** enquanto `profissionais` tiver 1 linha ativa: a guarda do §3.3.3 + o check `check-um-profissional-sem-ruido` garantem isso.
- A migration **precisa** fazer o backfill de `consultas.profissional_id` pro profissional padrão — nenhuma consulta pode ficar "órfã".
- `configuracao_horarios` singleton **permanece** — `profissional_horarios` é puramente aditivo com fallback.
- A mudança de semântica do conflito só tem efeito quando `profissional_id` está populado por linha e difere — pra clínica de 1 profissional, nulo.
