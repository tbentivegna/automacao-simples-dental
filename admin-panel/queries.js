'use strict';

const { pool } = require('./db');

const JANELAS_VALIDAS = ['hoje', 'ultimas_24h', 'ultima_semana', 'ultimo_mes', 'tudo'];

// Mesma janela usada em db/analytics-queries.sql (relatorio_geral), pra
// manter os números do painel iguais aos que o Analytics Agent já responde
// no WhatsApp -- evita a secretária ver dois números diferentes pra "hoje".
async function buscarAnalytics(janela) {
  const janelaSegura = JANELAS_VALIDAS.includes(janela) ? janela : 'hoje';

  const { rows } = await pool.query(
    `WITH parametros AS (
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
        count(*) FILTER (WHERE tipo = 'remarcado') AS remarcados,
        count(*) FILTER (WHERE tipo = 'lembrete_enviado') AS lembretes_enviados
      FROM public.eventos_agenda, parametros
      WHERE criado_em >= parametros.desde
    ),
    por_categoria AS (
      SELECT coalesce(categoria, 'outro') AS categoria, count(*) AS total
      FROM public.eventos_agenda, parametros
      WHERE tipo = 'criado' AND criado_em >= parametros.desde
      GROUP BY coalesce(categoria, 'outro')
      ORDER BY total DESC
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
        count(*) FILTER (WHERE resolved_at IS NULL AND detail LIKE 'URGÊNCIA%') AS urgentes_em_aberto
      FROM public.agent_actions
    ),
    suspensos AS (
      SELECT count(*) AS total
      FROM public.cliente
      WHERE bot_disabled = true
    )
    SELECT
      (SELECT row_to_json(agendamentos) FROM agendamentos) AS agendamentos,
      (SELECT coalesce(json_agg(por_categoria), '[]'::json) FROM por_categoria) AS por_categoria,
      (SELECT novos FROM pacientes) AS novos_pacientes,
      (SELECT total FROM mensagens) AS mensagens_trocadas,
      (SELECT row_to_json(pendencias) FROM pendencias) AS pendencias,
      (SELECT total FROM suspensos) AS pacientes_com_lumi_suspensa;`,
    [janelaSegura]
  );

  return { janela: janelaSegura, ...rows[0] };
}

// Pacientes com a Lumi desativada (atendimento humano assumido). Ordenado
// do mais parado pro mais recente -- é o que mais precisa de atenção.
async function buscarSuspensos() {
  const { rows } = await pool.query(
    `SELECT
      c.id,
      c.nome,
      c.telefone,
      c.human_assigned,
      to_char(c.last_handoff, 'DD/MM/YYYY "às" HH24:MI') AS last_handoff_formatado,
      EXTRACT(EPOCH FROM (now() - c.last_handoff)) / 3600 AS horas_desde_handoff
    FROM public.cliente c
    WHERE c.bot_disabled = true
    ORDER BY c.last_handoff ASC NULLS LAST;`
  );
  return rows;
}

// Pendências em aberto (agent_actions.resolved_at IS NULL), urgências
// primeiro e depois as mais antigas -- mesmo critério usado no resumo
// operacional que já existe no fluxo principal (node "Comando Resumo").
async function buscarPendencias() {
  const { rows } = await pool.query(
    `SELECT
      aa.id,
      aa.from_phone,
      c.nome AS paciente_nome,
      aa.action,
      aa.domain,
      aa.detail,
      aa.status,
      aa.assigned_to,
      to_char(aa.created_at, 'DD/MM/YYYY "às" HH24:MI') AS criado_em_formatado,
      EXTRACT(EPOCH FROM (now() - aa.created_at)) / 3600 AS horas_em_aberto,
      (aa.detail LIKE 'URGÊNCIA%') AS urgente
    FROM public.agent_actions aa
    LEFT JOIN public.cliente c ON c.telefone = aa.from_phone
    WHERE aa.resolved_at IS NULL
    ORDER BY urgente DESC, aa.created_at ASC;`
  );
  return rows;
}

// Marca como resolvida -- WHERE resolved_at IS NULL na própria query
// evita corrida (dois cliques quase simultâneos): só o primeiro afeta uma
// linha, o segundo não encontra nada pra atualizar.
async function resolverPendencia(id, resolvidoPor) {
  const { rows } = await pool.query(
    `UPDATE public.agent_actions
     SET resolved_at = now(),
         status = 'resolvido',
         assigned_to = COALESCE($2, assigned_to)
     WHERE id = $1 AND resolved_at IS NULL
     RETURNING id;`,
    [id, resolvidoPor || null]
  );
  return rows.length > 0;
}

// Diretório de pacientes, com busca opcional por nome/telefone.
async function buscarPacientes(busca) {
  const termo = (busca || '').trim();
  const { rows } = await pool.query(
    `SELECT
      c.id,
      c.nome,
      c.telefone,
      c.email,
      to_char(c.created_at, 'DD/MM/YYYY') AS criado_em_formatado,
      c.bot_disabled,
      c.human_assigned,
      c.consentimento_lembrete
    FROM public.cliente c
    WHERE $1 = '' OR c.nome ILIKE '%' || $1 || '%' OR c.telefone ILIKE '%' || $1 || '%'
    ORDER BY c.created_at DESC
    LIMIT 200;`,
    [termo]
  );
  return rows;
}

// Status do controle global (mesma tabela que o comando ##pausar/##retomar
// do fluxo principal usa -- linha única, id sempre 1).
async function buscarStatusGlobal() {
  const { rows } = await pool.query(
    `SELECT
      bot_pausado,
      pausado_por,
      to_char(pausado_em, 'DD/MM/YYYY "às" HH24:MI') AS pausado_em_formatado,
      retomado_por,
      to_char(retomado_em, 'DD/MM/YYYY "às" HH24:MI') AS retomado_em_formatado
    FROM public.controle_sistema
    WHERE id = 1;`
  );
  return rows[0] || { bot_pausado: false };
}

// Pausa/retoma valem pra TODOS os pacientes de uma vez -- mesmo efeito do
// comando ##pausar/##retomar mandado por um número master no WhatsApp.
async function pausarGlobal(por) {
  await pool.query(
    `UPDATE public.controle_sistema
     SET bot_pausado = true, pausado_por = $1, pausado_em = now()
     WHERE id = 1;`,
    [por || 'painel administrativo']
  );
}

async function retomarGlobal(por) {
  await pool.query(
    `UPDATE public.controle_sistema
     SET bot_pausado = false, retomado_por = $1, retomado_em = now()
     WHERE id = 1;`,
    [por || 'painel administrativo']
  );
}

// Devolve UM paciente específico pra Lumi (equivalente ao "##lumi" digitado
// na conversa dele) -- mesmo efeito do node "Ativar IA (paciente)" do
// fluxo principal. WHERE bot_disabled = true evita reprocessar à toa se
// clicarem duas vezes.
async function retomarPaciente(id) {
  const { rows } = await pool.query(
    `UPDATE public.cliente
     SET bot_disabled = false, human_assigned = false
     WHERE id = $1 AND bot_disabled = true
     RETURNING id;`,
    [id]
  );
  return rows.length > 0;
}

module.exports = {
  buscarAnalytics,
  buscarSuspensos,
  buscarPendencias,
  resolverPendencia,
  buscarPacientes,
  buscarStatusGlobal,
  pausarGlobal,
  retomarGlobal,
  retomarPaciente,
};
