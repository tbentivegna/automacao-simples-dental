-- Etapas do funil de resgate: até aqui só existia a etapa "horario_oferecido"
-- (Lumi chegou a oferecer horários reais). Adiciona "interesse" -- paciente
-- perguntou sobre procedimento/valor/agendamento mas sumiu antes de chegar
-- na oferta de horário. Uma tentativa é sempre promovida pra etapa mais
-- avançada que já alcançou (nunca rebaixada), ver server.js
-- abrirOuAtualizarFunil().
ALTER TABLE public.funil_agendamento
  ADD COLUMN IF NOT EXISTS etapa text NOT NULL DEFAULT 'horario_oferecido'; -- interesse | horario_oferecido
