-- Índice pra buscar o histórico de conversa de UM paciente rapidamente.
-- Rode isso uma vez no mesmo Postgres que o n8n já usa.

-- ============================================================
-- Preview de conversa por paciente (painel administrativo)
-- ============================================================
-- n8n_chat_histories já tinha índice em created_at (migração 002), mas não
-- em session_id (= telefone do paciente). Sem isso, "me mostra as últimas
-- mensagens desse paciente" varre a tabela inteira -- ok com poucas
-- mensagens, mas piora conforme a conversa de 380+ pacientes cresce.
CREATE INDEX IF NOT EXISTS idx_n8n_chat_histories_session_id
  ON public.n8n_chat_histories (session_id, created_at DESC);
