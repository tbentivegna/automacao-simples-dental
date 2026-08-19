'use strict';

const { pool } = require('./db');

const JANELAS_VALIDAS = ['hoje', 'ultimas_24h', 'ultima_semana', 'ultimo_mes', 'tudo'];
const TIPOS_AGENDAMENTO_VALIDOS = ['criado', 'confirmado', 'cancelado', 'remarcado', 'lembrete_enviado'];

// Mesmo CASE usado em buscarAnalytics, só que como função pra reaproveitar
// nas queries de detalhe (drill-down dos cards da Visão Geral) sem duplicar
// o texto em cada uma. `parametro` é o placeholder posicional ($1, $2...).
function clausulaDesde(parametro) {
  return `CASE ${parametro}
      WHEN 'hoje' THEN date_trunc('day', now())
      WHEN 'ultimas_24h' THEN now() - interval '24 hours'
      WHEN 'ultima_semana' THEN now() - interval '7 days'
      WHEN 'ultimo_mes' THEN now() - interval '30 days'
      ELSE '1970-01-01'::timestamptz
    END`;
}

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
      WHERE (created_at AT TIME ZONE 'UTC') >= parametros.desde
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

// Drill-down do card de agendamento clicado na Visão Geral (criados,
// confirmados, cancelados, remarcados ou lembretes enviados). Mesmo filtro
// de janela do card, só trocando COUNT por SELECT.
async function buscarDetalheAgendamentos(tipo, janela) {
  const tipoSeguro = TIPOS_AGENDAMENTO_VALIDOS.includes(tipo) ? tipo : 'criado';
  const janelaSegura = JANELAS_VALIDAS.includes(janela) ? janela : 'hoje';

  const { rows } = await pool.query(
    `SELECT
      ea.id,
      ea.telefone,
      c.nome,
      ea.categoria,
      to_char(ea.data_consulta, 'DD/MM/YYYY') AS data_consulta_formatada,
      ea.hora_consulta,
      to_char(ea.criado_em AT TIME ZONE 'UTC', 'DD/MM/YYYY "às" HH24:MI') AS criado_em_formatado
    FROM public.eventos_agenda ea
    -- ea.telefone é gravado "cru" (ex: 11992985426), sem o "55" nem o
    -- sufixo @s.whatsapp.net -- é o formato que o Simples Dental exige
    -- (ver n8n/lumi-workflow.json, tools de agendamento). cliente.telefone
    -- guarda o JID completo do WhatsApp, então reconstrói o formato antes
    -- de casar os dois, senão o JOIN nunca bate e "nome" sempre vem NULL.
    LEFT JOIN public.cliente c ON c.telefone = ('55' || ea.telefone || '@s.whatsapp.net')
    WHERE ea.tipo = $1 AND ea.criado_em >= ${clausulaDesde('$2')}
    ORDER BY ea.criado_em DESC
    LIMIT 50;`,
    [tipoSeguro, janelaSegura]
  );
  return rows;
}

// Drill-down do card "Novos pacientes" -- quem entrou na janela selecionada,
// mais recente primeiro (aqui a ordem por recência importa mais que a
// alfabética do diretório completo em /api/pacientes).
async function buscarDetalheNovosPacientes(janela) {
  const janelaSegura = JANELAS_VALIDAS.includes(janela) ? janela : 'hoje';

  const { rows } = await pool.query(
    `SELECT
      c.id,
      c.nome,
      c.telefone,
      to_char(c.created_at AT TIME ZONE 'UTC', 'DD/MM/YYYY "às" HH24:MI') AS criado_em_formatado
    FROM public.cliente c
    WHERE (c.created_at AT TIME ZONE 'UTC') >= ${clausulaDesde('$1')}
    ORDER BY c.created_at DESC
    LIMIT 50;`,
    [janelaSegura]
  );
  return rows;
}

// Drill-down do card "Mensagens trocadas" -- não lista mensagem por
// mensagem (é muita coisa), lista os pacientes mais ativos no período pra
// depois abrir o preview de UM paciente (buscarMensagensPaciente).
async function buscarDetalheMensagens(janela) {
  const janelaSegura = JANELAS_VALIDAS.includes(janela) ? janela : 'hoje';

  const { rows } = await pool.query(
    `SELECT
      h.session_id AS telefone,
      c.nome,
      count(*)::int AS total_mensagens,
      to_char(max(h.created_at) AT TIME ZONE 'UTC', 'DD/MM/YYYY "às" HH24:MI') AS ultima_mensagem_formatada
    FROM public.n8n_chat_histories h
    LEFT JOIN public.cliente c ON c.telefone = h.session_id
    WHERE h.created_at >= ${clausulaDesde('$1')}
    GROUP BY h.session_id, c.nome
    ORDER BY total_mensagens DESC, max(h.created_at) DESC
    LIMIT 20;`,
    [janelaSegura]
  );
  return rows;
}

// Preview da conversa de UM paciente (últimas N mensagens, mais antiga
// primeiro pra ler de cima pra baixo como um chat). session_id na tabela de
// memória do n8n é sempre o telefone -- ver n8n/lumi-workflow.json.
async function buscarMensagensPaciente(telefone, limite = 20) {
  const telefoneSeguro = (telefone || '').trim();
  const limiteSeguro = Number.isInteger(limite) && limite > 0 && limite <= 100 ? limite : 20;
  if (!telefoneSeguro) return [];

  const { rows } = await pool.query(
    `SELECT
      message->>'type' AS tipo,
      message->>'content' AS conteudo,
      to_char(created_at AT TIME ZONE 'UTC', 'DD/MM/YYYY "às" HH24:MI') AS enviado_em_formatado
    FROM public.n8n_chat_histories
    WHERE session_id = $1
    ORDER BY created_at DESC
    LIMIT $2;`,
    [telefoneSeguro, limiteSeguro]
  );
  return rows.reverse();
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
      to_char(c.last_handoff AT TIME ZONE 'UTC', 'DD/MM/YYYY "às" HH24:MI') AS last_handoff_formatado,
      EXTRACT(EPOCH FROM (now() - (c.last_handoff AT TIME ZONE 'UTC'))) / 3600 AS horas_desde_handoff
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
      to_char(aa.created_at AT TIME ZONE 'UTC', 'DD/MM/YYYY "às" HH24:MI') AS criado_em_formatado,
      EXTRACT(EPOCH FROM (now() - (aa.created_at AT TIME ZONE 'UTC'))) / 3600 AS horas_em_aberto,
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

// Diretório de pacientes, com busca opcional por nome/telefone, em ordem
// alfabética e paginado (380+ pacientes numa lista só era um scroll infinito).
async function buscarPacientes(busca, pagina = 1, porPagina = 10) {
  const termo = (busca || '').trim();
  const paginaSegura = Number.isInteger(pagina) && pagina > 0 ? pagina : 1;
  const porPaginaSeguro = Number.isInteger(porPagina) && porPagina > 0 && porPagina <= 100 ? porPagina : 10;
  const offset = (paginaSegura - 1) * porPaginaSeguro;

  const { rows } = await pool.query(
    `SELECT
      c.id,
      c.nome,
      c.telefone,
      c.email,
      to_char(c.created_at AT TIME ZONE 'UTC', 'DD/MM/YYYY') AS criado_em_formatado,
      c.bot_disabled,
      c.human_assigned,
      c.consentimento_lembrete,
      count(*) OVER()::int AS total_geral
    FROM public.cliente c
    WHERE $1 = '' OR c.nome ILIKE '%' || $1 || '%' OR c.telefone ILIKE '%' || $1 || '%'
    ORDER BY c.nome ASC NULLS LAST, c.id ASC
    LIMIT $2 OFFSET $3;`,
    [termo, porPaginaSeguro, offset]
  );

  const total = rows[0]?.total_geral ?? 0;
  const pacientes = rows.map(({ total_geral, ...resto }) => resto);
  return {
    pacientes,
    total,
    pagina: paginaSegura,
    porPagina: porPaginaSeguro,
    totalPaginas: Math.max(1, Math.ceil(total / porPaginaSeguro)),
  };
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

// Pausa a Lumi pra UM paciente específico (equivalente ao handoff manual,
// como se a equipe tivesse assumido a conversa pelo WhatsApp) -- oposto de
// retomarPaciente. Marca last_handoff também, senão o retorno automático em
// 6h (que compara contra essa coluna) nunca dispararia pra esse paciente,
// já que ficaria NULL.
//
// "now() AT TIME ZONE 'UTC'" (em vez de now() puro): last_handoff é
// "timestamp without time zone" mas guarda hora UTC por baixo (é assim que
// o n8n grava -- ver comentário em db.js). Se gravássemos now() puro aqui,
// a sessão do painel (timezone Brasília) gravaria a hora LOCAL disfarçada
// de "sem fuso", misturando dois formatos na mesma coluna e quebrando a
// leitura (que sempre reinterpreta como UTC). Isso converte pra UTC antes
// de gravar, mantendo o mesmo formato em toda a coluna.
async function pausarPaciente(id) {
  const { rows } = await pool.query(
    `UPDATE public.cliente
     SET bot_disabled = true, human_assigned = true, last_handoff = (now() AT TIME ZONE 'UTC')
     WHERE id = $1 AND bot_disabled = false
     RETURNING id;`,
    [id]
  );
  return rows.length > 0;
}

module.exports = {
  buscarAnalytics,
  buscarDetalheAgendamentos,
  buscarDetalheNovosPacientes,
  buscarDetalheMensagens,
  buscarMensagensPaciente,
  buscarSuspensos,
  buscarPendencias,
  resolverPendencia,
  buscarPacientes,
  buscarStatusGlobal,
  pausarGlobal,
  retomarGlobal,
  retomarPaciente,
  pausarPaciente,
};
