-- Guarda o "pushName" do WhatsApp (nome que a própria pessoa configurou no
-- perfil dela) como um apelido de exibição -- só pra ajudar a administrar
-- pacientes que ainda não confirmaram o nome oficial pra Lumi (hoje aparecem
-- como "sem nome" no painel, o que dificulta bastante o atendimento).
--
-- NUNCA usar isso como nome oficial/clínico: é auto-declarado pela pessoa no
-- WhatsApp, pode ser apelido, nome de terceiro, emoji etc. Só serve de
-- fallback de exibição quando cliente.nome ainda é null.

ALTER TABLE public.cliente
  ADD COLUMN IF NOT EXISTS apelido_whatsapp text;
