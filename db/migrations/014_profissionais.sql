-- Multi-profissional -- Fase 1 (ver Plano_Multi_Profissional.md).
--
-- Só schema aqui. Sem seed e sem backfill dentro da migration, porque cada
-- ambiente tem um elenco de profissionais diferente (Lumi PROD = só a Dra.
-- Aline; Demo = 3 fictícios; cada clínica standalone = o(s) dentista(s)
-- dela). O seed + o backfill de consultas.profissional_id ficam em
-- db/seed-profissionais.js, rodado por ambiente com um JSON próprio.
--
-- Compatibilidade: enquanto public.profissionais estiver vazia, ou com
-- exatamente uma linha ativa, todo o resto (standalone-bridge, prompt da
-- Lumi) se comporta EXATAMENTE como antes -- profissional_id fica NULL,
-- disponibilidade/conflito seguem globais.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS public.profissionais (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                      text NOT NULL,                 -- como aparece pro paciente: "Dra. Aline Bentivegna"
  especialidades            text[] NOT NULL DEFAULT '{}',  -- {"Ortodontia","Harmonização Orofacial",...}
  especialidade_principal   text,                          -- opcional, desempate/exibição curta
  aceita_primeira_consulta  boolean NOT NULL DEFAULT true, -- especialista que só vê encaminhado => false
  ativo                     boolean NOT NULL DEFAULT true, -- inativo: não oferecido, some do painel
  padrao                    boolean NOT NULL DEFAULT false,-- fallback ("tanto faz" / sem match de especialidade)
  cor                       text,                          -- hex, pra colorir a agenda por profissional
  ordem                     smallint NOT NULL DEFAULT 0,   -- ordem de exibição no painel
  observacoes               text,                          -- notas internas
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  atualizado_em             timestamptz NOT NULL DEFAULT now()
);

-- nome é a chave natural pro upsert idempotente do seed (db/seed-profissionais.js).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_profissionais_nome
  ON public.profissionais (nome);

-- No máximo um profissional padrão.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_profissional_padrao
  ON public.profissionais (padrao) WHERE padrao;

-- Expediente por profissional. Quem não tem linha aqui usa
-- public.configuracao_horarios (o singleton continua sendo o padrão da
-- clínica). Aditivo: nada precisa de linha aqui pra continuar funcionando.
CREATE TABLE IF NOT EXISTS public.profissional_horarios (
  profissional_id           uuid PRIMARY KEY REFERENCES public.profissionais(id) ON DELETE CASCADE,
  horarios                  jsonb NOT NULL,   -- mesma forma de configuracao_horarios.horarios
  duracao_consulta_minutos  integer,          -- NULL = herda de configuracao_horarios
  sabado_data_referencia    date,             -- NULL = herda de configuracao_horarios
  atualizado_em             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.consultas
  ADD COLUMN IF NOT EXISTS profissional_id uuid REFERENCES public.profissionais(id);

CREATE INDEX IF NOT EXISTS idx_consultas_profissional
  ON public.consultas (profissional_id, inicio);
