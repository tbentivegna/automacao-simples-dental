-- Cada tentativa de agendamento vira uma linha própria, com identificação
-- estável (id). Uma tentativa fica "em_andamento" desde que a Lumi mostra
-- horários reais até o paciente confirmar (concluido) ou sumir (resgate
-- enviado, no máximo uma vez por tentativa -- resgate_enviado_em é a trava).
-- Se o paciente voltar a demonstrar interesse depois de "resgate_enviado"
-- ou "expirado", uma tentativa NOVA é aberta (nunca reaproveita uma linha
-- já fechada) -- assim ele pode ser "fisgado" pelo resgate de novo no futuro.
CREATE TABLE IF NOT EXISTS public.funil_agendamento (
  id serial PRIMARY KEY,
  telefone text NOT NULL,
  instancia text,
  status text NOT NULL DEFAULT 'em_andamento', -- em_andamento | resgate_enviado | concluido | expirado
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  ultima_interacao_em timestamptz NOT NULL DEFAULT now(),
  resgate_enviado_em timestamptz,
  concluido_em timestamptz
);

CREATE INDEX IF NOT EXISTS idx_funil_agendamento_telefone_status
  ON public.funil_agendamento (telefone, status);
