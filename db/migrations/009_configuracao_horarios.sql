-- Expediente da clínica (dias/horários oferecidos, duração da consulta,
-- referência do sábado quinzenal), antes hardcoded em server.js
-- (MODELO_HORARIOS/DURACAO_CONSULTA_MINUTOS/SABADO_DATA_REFERENCIA). Vira
-- config editável pelo painel admin, sem precisar de redeploy a cada
-- mudança. Linha única (singleton, id sempre 1) -- não é uma lista de
-- registros, é a "configuração atual" inteira.
CREATE TABLE IF NOT EXISTS public.configuracao_horarios (
  id smallint PRIMARY KEY DEFAULT 1,
  horarios jsonb NOT NULL, -- {"segunda": ["08:30", ...], "terca": [], ...} -- uma chave por dia da semana
  duracao_consulta_minutos integer NOT NULL DEFAULT 60,
  sabado_data_referencia date, -- mesmo critério de SABADO_DATA_REFERENCIA: um sábado "aberto" conhecido, contado de 14 em 14 dias
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracao_horarios_singleton CHECK (id = 1)
);

-- Semeia com os valores que já estão em produção agora (server.js), pra não
-- haver gap entre o deploy desta migration e a primeira edição pelo painel.
INSERT INTO public.configuracao_horarios (id, horarios, duracao_consulta_minutos, sabado_data_referencia)
VALUES (
  1,
  '{"segunda":["08:30","09:30","10:30","13:30","14:30","15:30","16:30"],"terca":[],"quarta":["08:30","09:30","10:30","13:30","14:30","15:30","16:30"],"quinta":[],"sexta":["08:00","09:00","10:00"],"sabado":["08:00","09:00","10:00"],"domingo":[]}'::jsonb,
  60,
  '2026-08-01'
)
ON CONFLICT (id) DO NOTHING;
