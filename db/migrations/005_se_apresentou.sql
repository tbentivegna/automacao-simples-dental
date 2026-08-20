-- Substitui o cálculo on-the-fly de "primeiro contato" (NOT EXISTS em
-- n8n_chat_histories, recalculado a cada mensagem e injetado como nota
-- condicional no prompt da Lumi) por uma flag persistida e determinística.
-- Motivo: o cálculo dinâmico dependia do modelo interpretar corretamente a
-- combinação de notas do sistema, e já causou pelo menos um bug real (Lumi
-- deixou de se apresentar para pacientes importados em lote quando a nota
-- de "primeiro contato" chegava junto com a de "nome já cadastrado").

ALTER TABLE public.cliente
  ADD COLUMN IF NOT EXISTS se_apresentou boolean NOT NULL DEFAULT false;

-- Backfill: quem já trocou mensagem com a Lumi antes não deve receber a
-- apresentação de novo. Só fica false quem nunca teve nenhuma entrada em
-- n8n_chat_histories (ex.: os pacientes importados em lote só com nome e
-- telefone, sem histórico de conversa).
UPDATE public.cliente c
SET se_apresentou = true
WHERE EXISTS (
  SELECT 1 FROM public.n8n_chat_histories h WHERE h.session_id = c.telefone
);
