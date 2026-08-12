-- Queries de referência pros nodes do n8n (master control + Analytics Agent).
-- Rode a migração 002_master_control_analytics.sql antes de usar qualquer uma destas.

-- ============================================================
-- MASTER CONTROL
-- ============================================================

-- Checar se o remetente é um número master (usar num node IF logo após
-- identificar o "From", antes de decidir se cai no fluxo normal ou no admin).
-- Parâmetro $1 = From (JID completo, ex: '5511999999999@s.whatsapp.net')
SELECT EXISTS (
  SELECT 1 FROM public.numeros_master WHERE telefone = $1
) AS eh_master;

-- Checar se o bot está pausado globalmente (rodar isso ANTES de "Humano ou IA?"
-- pra todo mundo que não for master -- se pausado, não chama a Lumi, manda a
-- mensagem fixa de pausado).
SELECT bot_pausado FROM public.controle_sistema WHERE id = 1;

-- ##pausar (só executar se eh_master = true)
-- Parâmetro $1 = From de quem pausou
UPDATE public.controle_sistema
SET bot_pausado = true, pausado_por = $1, pausado_em = now()
WHERE id = 1;

-- ##retomar (só executar se eh_master = true)
-- Parâmetro $1 = From de quem retomou
UPDATE public.controle_sistema
SET bot_pausado = false, retomado_por = $1, retomado_em = now()
WHERE id = 1;

-- ============================================================
-- ANALYTICS AGENT -- tool "relatorio_geral"
-- ============================================================
-- Parâmetro $1 = janela ('hoje' | 'ultimas_24h' | 'ultima_semana' | 'ultimo_mes' | 'tudo'),
-- exatamente o valor que o $fromAI() extrair da pergunta do número master.
WITH parametros AS (
  SELECT CASE $1
    WHEN 'hoje' THEN date_trunc('day', now())
    WHEN 'ultimas_24h' THEN now() - interval '24 hours'
    WHEN 'ultima_semana' THEN now() - interval '7 days'
    WHEN 'ultimo_mes' THEN now() - interval '30 days'
    ELSE '1970-01-01'::timestamptz
  END AS desde
),
agendamentos AS (
  SELECT
    count(*) FILTER (WHERE tipo = 'criado') AS criados,
    count(*) FILTER (WHERE tipo = 'confirmado') AS confirmados,
    count(*) FILTER (WHERE tipo = 'cancelado') AS cancelados,
    count(*) FILTER (WHERE tipo = 'remarcado') AS remarcados
  FROM public.eventos_agenda, parametros
  WHERE criado_em >= parametros.desde
),
por_categoria AS (
  SELECT coalesce(categoria, 'outro') AS categoria, count(*) AS total
  FROM public.eventos_agenda, parametros
  WHERE tipo = 'criado' AND criado_em >= parametros.desde
  GROUP BY coalesce(categoria, 'outro')
),
pacientes AS (
  SELECT count(*) AS novos
  FROM public.cliente, parametros
  WHERE created_at >= parametros.desde
),
mensagens AS (
  SELECT count(*) AS total
  FROM public.n8n_chat_histories, parametros
  WHERE created_at >= parametros.desde
),
pendencias AS (
  SELECT
    count(*) FILTER (WHERE resolved_at IS NULL) AS total_em_aberto,
    count(*) FILTER (WHERE resolved_at IS NULL AND created_at >= parametros.desde) AS abertas_na_janela,
    count(*) FILTER (WHERE resolved_at IS NULL AND detail LIKE 'URGÊNCIA%') AS urgentes_em_aberto
  FROM public.agent_actions, parametros
),
-- Conversão: de quem mandou a primeira mensagem na janela, quantos viraram
-- agendamento criado na mesma janela. Aproximação (a pessoa pode contatar
-- numa janela e agendar só na próxima), mas é o número que mais importa pra
-- responder "o bot compensa" -- sem ele "novos_pacientes" é só contagem de
-- gente que mandou mensagem, não de quem virou agendamento.
conversao AS (
  SELECT
    (SELECT novos FROM pacientes) AS contatos_novos,
    (SELECT criados FROM agendamentos) AS agendamentos_criados,
    CASE
      WHEN (SELECT novos FROM pacientes) = 0 THEN NULL
      ELSE round(((SELECT criados FROM agendamentos)::numeric / (SELECT novos FROM pacientes)) * 100, 1)
    END AS taxa_conversao_pct
),
-- Recorrência: dos agendamentos criados na janela, quantos são de um
-- telefone que já tinha criado outro agendamento antes (retorno) vs.
-- primeira vez. Indica se o bot só está drenando pacientes já cativos ou
-- também trazendo gente nova pra base.
recorrencia AS (
  SELECT
    count(*) FILTER (WHERE vezes_antes = 0) AS agendamentos_primeira_vez,
    count(*) FILTER (WHERE vezes_antes > 0) AS agendamentos_recorrentes
  FROM (
    SELECT
      ea.id,
      (
        SELECT count(*)
        FROM public.eventos_agenda anterior
        WHERE anterior.tipo = 'criado'
          AND anterior.telefone = ea.telefone
          AND anterior.criado_em < ea.criado_em
      ) AS vezes_antes
    FROM public.eventos_agenda ea, parametros
    WHERE ea.tipo = 'criado'
      AND ea.telefone IS NOT NULL
      AND ea.criado_em >= parametros.desde
  ) sub
)
SELECT
  $1 AS janela,
  (SELECT row_to_json(agendamentos) FROM agendamentos) AS agendamentos,
  (SELECT coalesce(json_agg(por_categoria), '[]'::json) FROM por_categoria) AS agendamentos_por_categoria,
  (SELECT novos FROM pacientes) AS novos_pacientes,
  (SELECT total FROM mensagens) AS mensagens_trocadas,
  (SELECT row_to_json(pendencias) FROM pendencias) AS pendencias,
  (SELECT row_to_json(conversao) FROM conversao) AS conversao,
  (SELECT row_to_json(recorrencia) FROM recorrencia) AS agendamentos_por_recorrencia;

-- ============================================================
-- ANALYTICS AGENT -- tool "comparar_periodos"
-- ============================================================
-- Parâmetro $1 = periodo ('semana' | 'mes'), exatamente o valor que o
-- $fromAI() extrair da pergunta do número master. Compara o período atual
-- (últimos 7 ou 30 dias) contra o período imediatamente anterior de mesmo
-- tamanho, pra enxergar tendência (crescendo, estável ou caindo) em vez de
-- só um número absoluto isolado.
WITH parametros AS (
  SELECT CASE $1
    WHEN 'mes' THEN 30
    ELSE 7
  END AS dias
),
janelas AS (
  SELECT
    now() - (dias || ' days')::interval AS atual_desde,
    now() AS atual_ate,
    now() - (dias * 2 || ' days')::interval AS anterior_desde,
    now() - (dias || ' days')::interval AS anterior_ate
  FROM parametros
),
agendamentos_atual AS (
  SELECT
    count(*) FILTER (WHERE tipo = 'criado') AS criados,
    count(*) FILTER (WHERE tipo = 'confirmado') AS confirmados,
    count(*) FILTER (WHERE tipo = 'cancelado') AS cancelados,
    count(*) FILTER (WHERE tipo = 'remarcado') AS remarcados
  FROM public.eventos_agenda, janelas
  WHERE criado_em >= janelas.atual_desde AND criado_em < janelas.atual_ate
),
agendamentos_anterior AS (
  SELECT
    count(*) FILTER (WHERE tipo = 'criado') AS criados,
    count(*) FILTER (WHERE tipo = 'confirmado') AS confirmados,
    count(*) FILTER (WHERE tipo = 'cancelado') AS cancelados,
    count(*) FILTER (WHERE tipo = 'remarcado') AS remarcados
  FROM public.eventos_agenda, janelas
  WHERE criado_em >= janelas.anterior_desde AND criado_em < janelas.anterior_ate
),
contatos_atual AS (
  SELECT count(*) AS novos
  FROM public.cliente, janelas
  WHERE created_at >= janelas.atual_desde AND created_at < janelas.atual_ate
),
contatos_anterior AS (
  SELECT count(*) AS novos
  FROM public.cliente, janelas
  WHERE created_at >= janelas.anterior_desde AND created_at < janelas.anterior_ate
)
SELECT
  $1 AS periodo,
  (SELECT dias FROM parametros) AS dias_por_periodo,
  (SELECT row_to_json(agendamentos_atual) FROM agendamentos_atual) AS agendamentos_periodo_atual,
  (SELECT row_to_json(agendamentos_anterior) FROM agendamentos_anterior) AS agendamentos_periodo_anterior,
  (SELECT novos FROM contatos_atual) AS novos_contatos_periodo_atual,
  (SELECT novos FROM contatos_anterior) AS novos_contatos_periodo_anterior;

-- ============================================================
-- ANALYTICS AGENT -- tool "listar_pendencias"
-- ============================================================
-- Parâmetro $1 = apenasUrgentes (boolean -- true ou false; se o modelo não
-- passar, trate como false no n8n antes de mandar pra query)
SELECT
  action,
  domain,
  detail,
  created_at
FROM public.agent_actions
WHERE resolved_at IS NULL
  AND ($1 = false OR detail LIKE 'URGÊNCIA%')
ORDER BY created_at DESC;
