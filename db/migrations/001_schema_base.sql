-- Schema base do ecossistema Lumi -- cliente, agent_actions,
-- n8n_chat_histories, whatsapp_debounce. Essas 4 tabelas existem em
-- produção desde antes deste sistema de migrations existir, e nunca
-- tinham sido capturadas em arquivo nenhum -- toda vez que alguém seguia
-- o Checklist_Onboarding_Nova_Clinica.md ("rodar TODAS as migrations em
-- db/migrations/") pra um banco novo, essas 4 tabelas ficavam faltando
-- (migrations 002+ pressupõem que já existem). Descoberto 2026-09-03 ao
-- criar o 1º banco vazio de verdade (teste do standalone-bridge) --
-- schema reconstruído a partir do banco real de produção via
-- information_schema/pg_constraint/pg_indexes, não escrito de memória.
--
-- Numerado 001 (antes de tudo) de propósito -- as migrations seguintes
-- (002 em diante) dependem dessas tabelas existindo.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- Cadastro de pacientes/contatos -- telefone é o JID completo do
-- WhatsApp (5511999998888@s.whatsapp.net), chave de junção usada em
-- praticamente todo o resto do banco.
CREATE TABLE IF NOT EXISTS public.cliente (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                       text,
  email                      text,
  telefone                   text UNIQUE,
  created_at                 timestamp DEFAULT now(),
  updated_at                 timestamp DEFAULT now(),
  bot_disabled               boolean DEFAULT false,
  human_assigned             boolean DEFAULT false,
  last_handoff               timestamp,
  processando_desde          timestamptz,
  aviso_espera_enviado       boolean DEFAULT false,
  consentimento_lembrete     boolean DEFAULT true,
  consentimento_lembrete_em  timestamptz,
  se_apresentou              boolean NOT NULL DEFAULT false,
  apelido_whatsapp           text,
  lembrete_informado_em      timestamptz
);

-- Pendências levantadas pela Lumi (ou detectadas automaticamente pela
-- rede de segurança do prompt) pra equipe resolver -- ver painel admin,
-- seção Pendências.
CREATE TABLE IF NOT EXISTS public.agent_actions (
  id           serial PRIMARY KEY,
  from_phone   text NOT NULL,
  action       text NOT NULL,
  domain       text,
  detail       text,
  created_at   timestamp DEFAULT now(),
  status       text DEFAULT 'Pendente',
  assigned_to  text,
  resolved_at  timestamp
);

-- Histórico de mensagens -- schema fixo esperado pelo node "Postgres Chat
-- Memory" do n8n (LangChain), não é livre pra mudar. session_id = telefone
-- (JID completo). message->>'type' é 'human' | 'ai' | 'tool'.
CREATE TABLE IF NOT EXISTS public.n8n_chat_histories (
  id          serial PRIMARY KEY,
  session_id  varchar(255) NOT NULL,
  message     jsonb NOT NULL,
  hora        timestamp,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_n8n_chat_histories_created_at ON public.n8n_chat_histories (created_at);
CREATE INDEX IF NOT EXISTS idx_n8n_chat_histories_session_id ON public.n8n_chat_histories (session_id, created_at DESC);

-- Fila de debounce -- junta mensagens que chegam em rajada (paciente
-- manda várias seguidas) antes de processar como uma só.
CREATE TABLE IF NOT EXISTS public.whatsapp_debounce (
  id          bigserial PRIMARY KEY,
  telefone    text NOT NULL,
  instance    text,
  mensagem    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  processado  boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_debounce_telefone_created ON public.whatsapp_debounce (telefone, created_at);
