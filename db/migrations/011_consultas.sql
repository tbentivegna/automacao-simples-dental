-- Espelho local da agenda do Simples Dental.
--
-- Contexto: o guard do resgate (e o painel) precisam saber "esse número tem
-- consulta futura?". Hoje isso depende de eventos_agenda, que só é escrita
-- quando um agendamento passa pela Lumi/bridge -- consulta marcada na mão
-- pela equipe dentro do Simples Dental nunca chega lá (caso Daniela, 28/08:
-- consulta do filho marcada pela Dra. Aline, resgate quase disparou errado).
--
-- Esta tabela é preenchida pelo /sincronizar-agenda no server.js (varredura
-- Playwright da agenda, 4 semanas), que roda acoplado ao cron do resgate.
-- telefone guarda o JID completo (igual public.cliente.telefone) e fica NULL
-- enquanto a resolução por nome/dependente não consegue casar.

CREATE TABLE IF NOT EXISTS public.consultas (
  agendamento_id  text PRIMARY KEY,          -- data-consulta-id do Simples Dental
  paciente_nome   text NOT NULL,             -- já sem o sufixo " - Dr(a). Fulano"
  inicio          timestamptz NOT NULL,
  fim             timestamptz,
  status          text,                      -- title do evento no SD (Agendada, Confirmada, Cancelada..., Falta)
  telefone        text,                      -- JID completo 55...@s.whatsapp.net, ou NULL (consulta "órfã")
  rotulo          text,                      -- bolinha de tipo do SD (Primeira Consulta, Invisalign...), opcional
  origem          text NOT NULL DEFAULT 'sync',   -- 'sync' | 'bot'
  visto_em        timestamptz NOT NULL DEFAULT now(),  -- última varredura que ainda enxergou esta consulta
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consultas_telefone ON public.consultas (telefone);
CREATE INDEX IF NOT EXISTS idx_consultas_inicio   ON public.consultas (inicio);
