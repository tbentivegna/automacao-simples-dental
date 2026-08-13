-- Lembretes automáticos de consulta (workflow separado, n8n/lembretes-workflow.json).
-- Rode isso uma vez no mesmo Postgres que o n8n já usa.

-- ============================================================
-- 1) Consentimento do paciente para receber lembrete por WhatsApp
-- ============================================================
-- NULL = nunca foi perguntado (comportamento seguro por padrão: sem
-- resposta = sem lembrete). true/false = já respondeu.
ALTER TABLE public.cliente
  ADD COLUMN IF NOT EXISTS consentimento_lembrete boolean,
  ADD COLUMN IF NOT EXISTS consentimento_lembrete_em timestamptz;

-- ============================================================
-- 2) Mapeamento agendamento (Simples Dental) -> telefone
-- ============================================================
-- O calendário do Simples Dental nunca expõe telefone, só nome. Em vez de
-- casar por nome (frágil), gravamos aqui o telefone toda vez que o bot cria/
-- confirma/cancela/remarca um agendamento (server.js: salvarTelefoneAgendamento),
-- já que nesses momentos o telefone do paciente é conhecido com certeza.
-- Agendamentos feitos manualmente, sem nenhuma interação via WhatsApp, não
-- aparecem aqui -- o workflow de lembretes simplesmente pula esses casos.
CREATE TABLE IF NOT EXISTS public.agendamento_telefone (
  agendamento_id text PRIMARY KEY,
  telefone text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 3) Novo tipo de evento em eventos_agenda -- lembrete enviado
-- ============================================================
-- Mesma tabela que já alimenta o Analytics Agent (ver
-- db/migrations/002_master_control_analytics.sql).
ALTER TABLE public.eventos_agenda DROP CONSTRAINT IF EXISTS eventos_agenda_tipo_check;
ALTER TABLE public.eventos_agenda ADD CONSTRAINT eventos_agenda_tipo_check
  CHECK (tipo IN ('criado', 'confirmado', 'cancelado', 'remarcado', 'lembrete_enviado'));
