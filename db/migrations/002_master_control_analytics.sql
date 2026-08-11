-- Master control (pausar/retomar globalmente) + base de dados pro Analytics Agent.
-- Rode isso uma vez no mesmo Postgres que o n8n já usa.

-- ============================================================
-- 1) Estado global do bot (pausado ou não)
-- ============================================================
-- Linha única (id sempre 1) -- consulta/atualiza sem precisar de WHERE por telefone.
CREATE TABLE IF NOT EXISTS public.controle_sistema (
  id smallint PRIMARY KEY DEFAULT 1,
  bot_pausado boolean NOT NULL DEFAULT false,
  pausado_por text,
  pausado_em timestamptz,
  retomado_por text,
  retomado_em timestamptz,
  CHECK (id = 1)
);

INSERT INTO public.controle_sistema (id, bot_pausado)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2) Números autorizados a usar ##pausar/##retomar e o Analytics Agent
-- ============================================================
-- IMPORTANTE: guarde o telefone no MESMO formato usado em public.cliente.telefone
-- e no campo "From" do fluxo (JID completo, ex: '5511981174657@s.whatsapp.net'),
-- já que a checagem no n8n compara direto contra esse campo.
CREATE TABLE IF NOT EXISTS public.numeros_master (
  telefone text PRIMARY KEY,
  nome text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- Exemplo de como adicionar um número master (ajuste o telefone/nome e descomente):
-- INSERT INTO public.numeros_master (telefone, nome) VALUES ('5511999999999@s.whatsapp.net', 'Tiago');

-- ============================================================
-- 3) Log de eventos de agenda -- fonte pro Analytics Agent
-- ============================================================
-- Gravado pelo server.js (não pelo n8n) logo após cada operação de agenda
-- confirmar sucesso de verdade -- é o único lugar que sabe com certeza, no
-- momento exato, que a ação aconteceu.
CREATE TABLE IF NOT EXISTS public.eventos_agenda (
  id serial PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo IN ('criado', 'confirmado', 'cancelado', 'remarcado')),
  -- Nullable: no criado sempre vem preenchido, mas confirmar/cancelar/
  -- remarcar só mandam telefone se o node correspondente no n8n for
  -- ajustado pra auto-preencher (mesmo padrão do Cria Agendamento).
  telefone text,
  categoria text CHECK (
    categoria IN (
      'primeira_consulta',
      'ortodontia',
      'odontopediatria',
      'hof',
      'clareamento',
      'limpeza_prevencao',
      'consulta_estetica',
      'dor_urgencia',
      'outro'
    )
  ),
  data_consulta date,
  hora_consulta text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eventos_agenda_criado_em ON public.eventos_agenda (criado_em);
CREATE INDEX IF NOT EXISTS idx_eventos_agenda_tipo ON public.eventos_agenda (tipo);

-- ============================================================
-- 4) Timestamp na memória de chat -- necessário pro Analytics Agent contar
--    "mensagens trocadas por período"
-- ============================================================
-- A tabela de memória padrão do n8n (Postgres Chat Memory) normalmente NÃO
-- tem coluna de data/hora -- só session_id e message. Sem isso não tem como
-- filtrar por período. O DEFAULT now() preenche sozinho as próximas
-- mensagens (o n8n não precisa saber que essa coluna existe); linhas
-- antigas, se existirem, ficam com a data desta migração, não a data real
-- de quando foram trocadas -- ok pra fins de "essa semana/esse mês" daqui
-- pra frente, mas não é retroativo.
ALTER TABLE public.n8n_chat_histories
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_n8n_chat_histories_created_at ON public.n8n_chat_histories (created_at);
