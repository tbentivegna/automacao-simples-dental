-- Vínculo responsável (WhatsApp da família) -> dependente menor de idade.
--
-- O Simples Dental tem esse dado (o cadastro da Lumi já manda
-- nomeResponsavel/celularResponsavel ao criar consulta pra menor), mas a
-- gente não guardava o vínculo localmente. Sem ele, a varredura da agenda
-- vê "Eduardo Voltolini Filho" e não sabe que é o número da mãe.
--
-- Preenchida:
--  - pra frente: criarAgendamento() no server.js, sempre que registra um
--    menor (nomeResponsavel presente);
--  - backfill dos existentes: script pontual que navega as fichas dos
--    menores no SD (feito depois do resto de pé).

CREATE TABLE IF NOT EXISTS public.paciente_dependente (
  id                    serial PRIMARY KEY,
  responsavel_telefone  text NOT NULL,        -- JID completo 55...@s.whatsapp.net, igual public.cliente.telefone
  dependente_nome       text NOT NULL,
  dependente_nascimento date,
  dependente_cpf        text,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (responsavel_telefone, dependente_nome)
);

CREATE INDEX IF NOT EXISTS idx_pac_dep_nome ON public.paciente_dependente (lower(dependente_nome));
