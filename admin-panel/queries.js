'use strict';

const { pool } = require('./db');

const JANELAS_VALIDAS = ['hoje', 'ultimas_24h', 'ultima_semana', 'ultimo_mes', 'tudo'];
const TIPOS_AGENDAMENTO_VALIDOS = ['criado', 'confirmado', 'cancelado', 'remarcado', 'lembrete_enviado'];

// db.js já fixa a sessão do pool pra 'America/Sao_Paulo' (ver comentário lá),
// então to_char() de uma coluna "with time zone" de verdade já sai certo por
// padrão -- mas usamos AT TIME ZONE explícito mesmo assim, pra não depender
// silenciosamente desse hook em nenhum lugar. ATENÇÃO: cliente.created_at,
// cliente.last_handoff e agent_actions.created_at são "timestamp without
// time zone" mas guardam hora UTC por baixo (gravadas pelo n8n) -- SEMPRE
// reinterpretar com "(coluna AT TIME ZONE 'UTC')" ANTES de converter pro
// fuso da clínica, senão a comparação/formatação erra em 3h (ver db.js).
const FUSO_CLINICA = 'America/Sao_Paulo';

// Mesmo CASE usado em buscarAnalytics, só que como função pra reaproveitar
// nas queries de detalhe (drill-down dos cards da Visão Geral) sem duplicar
// o texto em cada uma. `parametro` é o placeholder posicional ($1, $2...).
function clausulaDesde(parametro) {
  return `CASE ${parametro}
      WHEN 'hoje' THEN date_trunc('day', now() AT TIME ZONE '${FUSO_CLINICA}') AT TIME ZONE '${FUSO_CLINICA}'
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
        WHEN 'hoje' THEN date_trunc('day', now() AT TIME ZONE '${FUSO_CLINICA}') AT TIME ZONE '${FUSO_CLINICA}'
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
      c.apelido_whatsapp,
      ea.categoria,
      to_char(ea.data_consulta, 'DD/MM/YYYY') AS data_consulta_formatada,
      ea.hora_consulta,
      to_char(ea.criado_em AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY "às" HH24:MI') AS criado_em_formatado
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
      c.apelido_whatsapp,
      c.telefone,
      to_char((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY "às" HH24:MI') AS criado_em_formatado
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
      c.apelido_whatsapp,
      count(*)::int AS total_mensagens,
      to_char(max(h.created_at) AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY "às" HH24:MI') AS ultima_mensagem_formatada
    FROM public.n8n_chat_histories h
    LEFT JOIN public.cliente c ON c.telefone = h.session_id
    WHERE h.created_at >= ${clausulaDesde('$1')}
      AND h.message->>'type' IN ('human', 'ai')
      AND coalesce(h.message->>'content', '') NOT IN ('', '[]')
    GROUP BY h.session_id, c.nome, c.apelido_whatsapp
    ORDER BY max(h.created_at) DESC, total_mensagens DESC
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
      message->'tool_calls'->0->>'name' AS tool_chamada,
      to_char(created_at AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY "às" HH24:MI') AS enviado_em_formatado
    FROM public.n8n_chat_histories
    WHERE session_id = $1
      AND message->>'type' IN ('human', 'ai')
      AND (
        coalesce(message->>'content', '') NOT IN ('', '[]')
        OR message->'tool_calls'->0->>'name' IS NOT NULL
      )
    ORDER BY created_at DESC, id DESC
    LIMIT $2;`,
    [telefoneSeguro, limiteSeguro]
  );
  return rows;
}

// Pacientes com a Lumi desativada (atendimento humano assumido). Ordenado
// do mais parado pro mais recente -- é o que mais precisa de atenção.
async function buscarSuspensos() {
  const { rows } = await pool.query(
    `SELECT
      c.id,
      c.nome,
      c.apelido_whatsapp,
      c.telefone,
      c.human_assigned,
      to_char((c.last_handoff AT TIME ZONE 'UTC') AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY "às" HH24:MI') AS last_handoff_formatado,
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
      c.apelido_whatsapp AS paciente_apelido_whatsapp,
      aa.action,
      aa.domain,
      aa.detail,
      aa.status,
      aa.assigned_to,
      to_char((aa.created_at AT TIME ZONE 'UTC') AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY "às" HH24:MI') AS criado_em_formatado,
      EXTRACT(EPOCH FROM (now() - (aa.created_at AT TIME ZONE 'UTC'))) / 3600 AS horas_em_aberto,
      (aa.detail LIKE 'URGÊNCIA%') AS urgente
    FROM public.agent_actions aa
    LEFT JOIN public.cliente c ON c.telefone = aa.from_phone
    WHERE aa.resolved_at IS NULL
    ORDER BY urgente DESC, aa.created_at ASC;`
  );
  return rows;
}

// Sugestões pro autocomplete do campo "Paciente" ao criar pendência manual
// -- só dispara com 2+ caracteres, retorna poucos resultados. Não é pra
// travar quem quer digitar algo que não é paciente nenhum (ex: "Comprar
// botox"), só ajudar a achar rápido quando for o caso.
async function buscarSugestoesPacientes(termo) {
  const termoSeguro = (termo || '').trim();
  if (termoSeguro.length < 2) return [];
  const { rows } = await pool.query(
    `SELECT nome, apelido_whatsapp, telefone
     FROM public.cliente
     WHERE nome ILIKE '%' || $1 || '%'
        OR apelido_whatsapp ILIKE '%' || $1 || '%'
        OR telefone ILIKE '%' || $1 || '%'
     ORDER BY nome ASC NULLS LAST
     LIMIT 8;`,
    [termoSeguro]
  );
  return rows;
}

// Pendência criada manualmente pela equipe (ex: secretária), pra situação
// que não passou pela Lumi -- mesma tabela/formato das automáticas, só
// com action fixo "OUTROS" (não tenta adivinhar categoria) e domain
// "Geral". from_phone é NOT NULL na tabela; sem paciente informado, usa um
// marcador em vez de travar a criação.
async function criarPendenciaManual({ paciente, detalhe }) {
  const fromPhone = (paciente || '').trim() || '(pendência manual, sem paciente vinculado)';
  // created_at é "timestamp without time zone" mas o resto do banco guarda
  // hora UTC nela (ver FUSO_CLINICA acima) -- o DEFAULT now() da coluna,
  // se deixado agir sozinho, gravaria hora BRT (sessão deste pool está em
  // America/Sao_Paulo, ver db.js), quebrando a leitura em buscarPendencias.
  // Escreve explícito com a mesma conversão que pausarPaciente() já usa.
  const { rows } = await pool.query(
    `INSERT INTO public.agent_actions (from_phone, action, domain, detail, created_at)
     VALUES ($1, 'OUTROS', 'Geral', $2, (now() AT TIME ZONE 'UTC'))
     RETURNING id;`,
    [fromPhone, detalhe]
  );
  return rows[0];
}

// Oportunidades do funil de resgate (funil_agendamento) -- tentativas
// "em_andamento" primeiro (precisam de atenção), depois resgate_enviado,
// depois concluido/expirado por último (histórico). ultima_mensagem_paciente
// é a mesma usada pra montar a mensagem de resgate na etapa "interesse" --
// mostrar aqui deixa claro pro painel o que gerou a oportunidade.
async function buscarOportunidades() {
  const { rows } = await pool.query(
    `SELECT
      f.id,
      f.telefone,
      coalesce(c.nome, c.apelido_whatsapp) AS nome,
      (c.nome IS NOT NULL) AS nome_confirmado,
      f.etapa,
      f.status,
      to_char(f.iniciado_em AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY "às" HH24:MI') AS iniciado_em_formatado,
      to_char(f.ultima_interacao_em AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY "às" HH24:MI') AS ultima_interacao_formatado,
      EXTRACT(EPOCH FROM (now() - f.ultima_interacao_em)) / 3600 AS horas_desde_ultima_interacao,
      (f.resgate_enviado_em IS NOT NULL) AS resgate_enviado,
      to_char(f.resgate_enviado_em AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY "às" HH24:MI') AS resgate_enviado_formatado,
      -- se a equipe já assumiu essa conversa (bot_disabled), o resgate
      -- automático não entra -- não pode interromper/contradizer um
      -- atendimento humano em andamento. Mesma checagem que "Busca Funil
      -- Parado" usa pra excluir do envio.
      coalesce(c.bot_disabled, false) AS atendimento_humano_ativo,
      -- mesma checagem que "Busca Funil Parado" usa pra excluir do envio --
      -- se o paciente já respondeu depois da última marcação, o resgate
      -- automático não vai disparar, mesmo com status ainda em_andamento.
      EXISTS (
        SELECT 1 FROM public.n8n_chat_histories h
        WHERE h.session_id = f.telefone
          AND h.message->>'type' = 'human'
          AND h.created_at > f.ultima_interacao_em
      ) AS paciente_ja_respondeu_depois,
      -- mesmo filtro de "mensagem com conteúdo de verdade" (>15 chars) que
      -- o workflow de resgate usa pra montar a mensagem -- assim o painel
      -- mostra a mesma coisa que vai ser citada pro paciente, e não uma
      -- resposta curta tipo "sim"/"ok"/"limpeza" sem contexto.
      (SELECT h.message->>'content' FROM public.n8n_chat_histories h
       WHERE h.session_id = f.telefone AND h.message->>'type' = 'human'
         AND char_length(h.message->>'content') > 15
       ORDER BY h.created_at DESC LIMIT 1) AS ultima_mensagem_paciente
    FROM public.funil_agendamento f
    LEFT JOIN public.cliente c ON c.telefone = f.telefone
    ORDER BY
      CASE f.status WHEN 'em_andamento' THEN 0 WHEN 'resgate_enviado' THEN 1 ELSE 2 END,
      f.ultima_interacao_em DESC
    LIMIT 100;`
  );
  return rows;
}

// Reabre manualmente uma tentativa que já teve resgate enviado (sem
// resposta) ou expirou -- volta pra em_andamento, limpa a trava de resgate
// (resgate_enviado_em) e reseta ultima_interacao_em pra agora, então o
// cron de resgate só volta a considerar essa tentativa depois do limiar de
// silêncio normal (4h) -- não dispara na hora, só reabre a "fila".
// Só reativa se ainda estiver resgate_enviado/expirado -- não mexe em
// em_andamento (já está ativa) nem em concluido (já converteu).
async function reativarOportunidade(id) {
  const { rows } = await pool.query(
    `UPDATE public.funil_agendamento
     SET status = 'em_andamento',
         resgate_enviado_em = NULL,
         ultima_interacao_em = now()
     WHERE id = $1 AND status IN ('resgate_enviado', 'expirado')
     RETURNING id;`,
    [id]
  );
  return rows.length > 0;
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
      c.apelido_whatsapp,
      c.telefone,
      c.email,
      to_char((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY') AS criado_em_formatado,
      c.bot_disabled,
      c.human_assigned,
      c.consentimento_lembrete,
      count(*) OVER()::int AS total_geral
    FROM public.cliente c
    WHERE $1 = ''
      OR c.nome ILIKE '%' || $1 || '%'
      OR c.apelido_whatsapp ILIKE '%' || $1 || '%'
      OR c.telefone ILIKE '%' || $1 || '%'
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
      to_char(pausado_em AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY "às" HH24:MI') AS pausado_em_formatado,
      retomado_por,
      to_char(retomado_em AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY "às" HH24:MI') AS retomado_em_formatado
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

// Ajuste manual do consentimento de lembrete -- a secretária pode ligar/
// desligar direto no painel quando o próprio paciente pedir por telefone/
// presencial, sem precisar que ele repita o pedido pra Lumi no WhatsApp.
// Mesmo efeito da tool "Registrar Consentimento Lembrete" que a Lumi usa.
async function definirConsentimentoPaciente(id, consentimento) {
  const { rows } = await pool.query(
    `UPDATE public.cliente
     SET consentimento_lembrete = $2, consentimento_lembrete_em = now()
     WHERE id = $1
     RETURNING id;`,
    [id, consentimento]
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
  criarPendenciaManual,
  buscarOportunidades,
  reativarOportunidade,
  buscarSugestoesPacientes,
  buscarPacientes,
  buscarStatusGlobal,
  pausarGlobal,
  retomarGlobal,
  retomarPaciente,
  pausarPaciente,
  definirConsentimentoPaciente,
};
