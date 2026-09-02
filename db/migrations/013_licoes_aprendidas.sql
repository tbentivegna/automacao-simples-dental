-- Achados da análise semanal de "lições aprendidas": pontos onde a equipe
-- interveio numa conversa da Lumi ([Equipe da clínica] em
-- n8n_chat_histories) e a análise (headless Claude, scripts/analise-
-- semanal-*) concluiu que era uma correção real, não um escalonamento
-- esperado -- com uma sugestão concreta de ajuste de prompt/código.
--
-- Fluxo de decisão, deliberadamente em 2 etapas: esta tabela só guarda a
-- SUGESTÃO e a DECISÃO (aprovar/rejeitar) via painel -- nenhuma automação
-- lê status='aprovado' e aplica sozinha. Aplicar de fato (testar no
-- harness, subir DEV->PROD, verificar) continua sendo uma sessão do
-- Claude Code, revisada por humano -- ver project_state sobre o motivo.
CREATE TABLE IF NOT EXISTS public.licoes_aprendidas (
  id serial PRIMARY KEY,
  periodo_inicio date NOT NULL,
  periodo_fim date NOT NULL,
  paciente_telefone text,
  resumo text NOT NULL,
  tipo_sugestao text NOT NULL CHECK (tipo_sugestao IN ('prompt', 'codigo', 'harness_only')),
  trecho_sugerido text,
  confianca text NOT NULL CHECK (confianca IN ('alta', 'media', 'baixa')),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'rejeitado', 'aplicado')),
  comentario_tiago text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decidido_em timestamptz
);

CREATE INDEX IF NOT EXISTS idx_licoes_aprendidas_status ON public.licoes_aprendidas (status);
