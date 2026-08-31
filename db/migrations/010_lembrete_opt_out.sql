-- Consentimento de lembrete de consulta passa de opt-in pra opt-out
-- (pedido do Tiago, 2026-08-31): por padrão o paciente já recebe
-- lembrete automático por WhatsApp, só deixa de receber se pedir
-- explicitamente pra sair da lista.
--
-- lembrete_informado_em é uma coluna NOVA, separada do VALOR do
-- consentimento -- sem ela, ao setar consentimento_lembrete = true pra
-- todo mundo de uma vez, a nota interna que hoje diz "já registrado,
-- não pergunte de novo" passaria a valer pra todo mundo instantaneamente,
-- e a Lumi nunca mais avisaria ninguém sobre a política nova.
-- lembrete_informado_em marca só quando a Lumi de fato AVISOU o
-- paciente sobre isso -- separado de qual é o valor atual do consentimento.

-- 1) Novos pacientes já nascem opt-in por padrão.
ALTER TABLE public.cliente
  ALTER COLUMN consentimento_lembrete SET DEFAULT true;

-- 2) Nova coluna: quando a Lumi avisou o paciente sobre a política de
-- lembrete (independente do valor do consentimento em si).
ALTER TABLE public.cliente
  ADD COLUMN IF NOT EXISTS lembrete_informado_em timestamptz;

-- 3) Backfill 1: só quem NUNCA foi perguntado (NULL) vira true --
-- preserva qualquer "não" explícito que já exista, não reabre
-- consentimento que o paciente já negou de propósito no passado.
UPDATE public.cliente
SET consentimento_lembrete = true
WHERE consentimento_lembrete IS NULL;

-- 4) Backfill 2: quem já tinha respondido antes (sim ou não, sob o
-- fluxo antigo de pergunta) já foi avisado de verdade -- marca como
-- informado, pra Lumi não repetir o aviso pra quem já passou por isso.
UPDATE public.cliente
SET lembrete_informado_em = consentimento_lembrete_em
WHERE consentimento_lembrete_em IS NOT NULL
  AND lembrete_informado_em IS NULL;

-- Quem nunca foi perguntado antes (a maioria, agora com consentimento_
-- lembrete = true recém-preenchido no passo 3) fica com
-- lembrete_informado_em ainda NULL de propósito -- a Lumi vai avisar
-- cada um desses no próximo agendamento/remarcação, no ritmo natural
-- da conversa, em vez de todo mundo de uma vez.
