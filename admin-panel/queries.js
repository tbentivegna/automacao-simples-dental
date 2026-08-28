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

// Analytics: cada granularidade já embute uma janela padrão sensata (em vez
// de expor um seletor de data solto) -- dia mostra o último mês, semana o
// último trimestre, etc. `unit`/`step`/`lookback` só vêm daqui (nunca de
// input do usuário), por isso é seguro interpolar direto no SQL.
const GRANULARIDADES = {
  dia: { unit: 'day', step: '1 day', lookback: '29 days' },
  semana: { unit: 'week', step: '1 week', lookback: '11 weeks' },
  mes: { unit: 'month', step: '1 month', lookback: '11 months' },
  trimestre: { unit: 'quarter', step: '3 months', lookback: '21 months' },
  ano: { unit: 'year', step: '1 year', lookback: '4 years' },
};

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// Tudo antes de 16/08/2026 era ambiente de teste, não conversa/atendimento
// real (pedido do Tiago) -- usado pra "aparar" a página inteira de
// Analytics (tendência, funil de resgate, nuvem de palavras), não só a
// nuvem. Cada uso interpola isso de um jeito diferente (naive-local pra
// bucket de série temporal, timestamptz pra filtro direto), ver os
// comentários nos pontos de uso. É auto-suficiente: pra granularidades
// pequenas (dia/semana) o "piso" para de fazer diferença sozinho assim que
// a janela padrão passar dessa data -- só trimestre/ano continuam limitados
// por mais tempo, o que é o comportamento certo (não tem sentido mostrar
// "1 trimestre" ou "1 ano" cheio de linha zerada de antes do sistema
// existir de verdade).
const DADOS_REAIS_DESDE = '2026-08-16 00:00:00';

// periodoIso vem como "YYYY-MM-DDTHH:MM:SS" (sem fuso, já em hora local --
// ver to_char no SELECT final de buscarAnalyticsTendencia). Extrai ano/mês/
// dia direto da string em vez de deixar o Date reinterpretar como UTC, pelo
// mesmo motivo do comentário sobre AT TIME ZONE lá em cima.
function formatarRotuloPeriodo(periodoIso, granularidade) {
  const [dataParte] = periodoIso.split('T');
  const [ano, mes, dia] = dataParte.split('-').map(Number);
  const anoCurto = String(ano).slice(2);
  switch (granularidade) {
    case 'dia':
    case 'semana':
      return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
    case 'mes':
      return `${MESES_ABREV[mes - 1]}/${anoCurto}`;
    case 'trimestre':
      return `T${Math.floor((mes - 1) / 3) + 1}/${anoCurto}`;
    case 'ano':
      return String(ano);
    default:
      return dataParte;
  }
}

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

// Lista de conversas pra página Mensagens -- sem filtro de janela (ao
// contrário de buscarDetalheMensagens, que é só o drill-down de um card da
// Visão Geral). Traz bot_disabled/human_assigned pra badge de "pausada" e
// quem mandou a última mensagem (indicador de "aguardando resposta" quando
// foi o paciente). Busca opcional por nome/apelido/telefone, mesmo padrão
// ILIKE de buscarPacientes.
async function buscarConversas(termo = '', limite = 50) {
  const termoSeguro = (termo || '').trim();
  const limiteSeguro = Number.isInteger(limite) && limite > 0 && limite <= 100 ? limite : 50;

  const { rows } = await pool.query(
    `SELECT
      h.session_id AS telefone,
      c.nome,
      c.apelido_whatsapp,
      coalesce(c.bot_disabled, false) AS bot_disabled,
      coalesce(c.human_assigned, false) AS human_assigned,
      (SELECT m.message->>'type' FROM public.n8n_chat_histories m
        WHERE m.session_id = h.session_id AND m.message->>'type' IN ('human', 'ai')
          AND coalesce(m.message->>'content', '') NOT IN ('', '[]')
        ORDER BY m.created_at DESC LIMIT 1) AS ultimo_tipo,
      (SELECT m.message->>'content' FROM public.n8n_chat_histories m
        WHERE m.session_id = h.session_id AND m.message->>'type' IN ('human', 'ai')
          AND coalesce(m.message->>'content', '') NOT IN ('', '[]')
        ORDER BY m.created_at DESC LIMIT 1) AS ultima_mensagem,
      to_char(max(h.created_at) AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM/YYYY "às" HH24:MI') AS ultima_em_formatada
    FROM public.n8n_chat_histories h
    LEFT JOIN public.cliente c ON c.telefone = h.session_id
    WHERE h.message->>'type' IN ('human', 'ai')
      AND coalesce(h.message->>'content', '') NOT IN ('', '[]')
      AND (
        $1 = ''
        OR c.nome ILIKE '%' || $1 || '%'
        OR c.apelido_whatsapp ILIKE '%' || $1 || '%'
        OR h.session_id ILIKE '%' || $1 || '%'
      )
    GROUP BY h.session_id, c.nome, c.apelido_whatsapp, c.bot_disabled, c.human_assigned
    ORDER BY max(h.created_at) DESC
    LIMIT $2;`,
    [termoSeguro, limiteSeguro]
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
      -- consulta futura no espelho da agenda (public.consultas, populado
      -- pelo /sincronizar-agenda). Pega inclusive consulta marcada na mão
      -- pela equipe no Simples Dental -- que eventos_agenda não via. Mesma
      -- checagem que "Busca Funil Parado" e "Fecha Funis Com Consulta"
      -- usam pra não mandar resgate pra quem já tem consulta.
      EXISTS (
        SELECT 1 FROM public.consultas ct
        WHERE ct.telefone = f.telefone
          AND ct.inicio >= now()
          AND ct.status NOT IN ('Cancelada pelo paciente','Cancelada pelo profissional','Falta','removido_do_calendario')
      ) AS tem_consulta_futura,
      (SELECT to_char(min(ct.inicio) AT TIME ZONE '${FUSO_CLINICA}', 'DD/MM "às" HH24:MI')
       FROM public.consultas ct
       WHERE ct.telefone = f.telefone
         AND ct.inicio >= now()
         AND ct.status NOT IN ('Cancelada pelo paciente','Cancelada pelo profissional','Falta','removido_do_calendario')
      ) AS proxima_consulta_formatada,
      -- mesma checagem que "Busca Funil Parado" usa pra excluir do envio --
      -- silêncio de verdade nas últimas 4h, não só "sem mensagem desde a
      -- última marcação" (esse segundo critério travava pra sempre depois
      -- de qualquer resposta de follow-up -- bug real corrigido 25/08/2026,
      -- ver fix-resgate-checagem-silencio-real.js; esta cópia no painel
      -- ficou desatualizada até agora, mostrando "já respondeu" mesmo
      -- horas depois de o paciente realmente ter ficado em silêncio).
      NOT EXISTS (
        SELECT 1 FROM public.n8n_chat_histories h
        WHERE h.session_id = f.telefone
          AND h.message->>'type' = 'human'
          AND h.created_at > now() - interval '4 hours'
      ) AS silencio_real_4h,
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

// Contrapartida de pausarPaciente() por telefone (em vez de id) -- usado
// pela página Mensagens depois de um envio pela Evolution API.
//
// Descoberto na prática 25/08/2026: ao contrário de uma resposta digitada
// no WhatsApp do celular (que a Evolution reemite como evento
// "messages.upsert" com fromMe:true, pego pelo node "fromMe" do workflow
// Lumi e tratado automaticamente -- ver Desativar IA / Grava Mensagem
// Equipe), uma mensagem mandada pela API da Evolution NÃO dispara esse
// mesmo webhook (confirmado com um envio de teste real: a mensagem chegou
// no WhatsApp, mas nenhuma execução do workflow Lumi correspondeu a ela, e
// bot_disabled continuou false -- a Lumi seguiu respondendo normalmente
// por cima da mensagem da equipe). Então o painel precisa fazer as duas
// coisas que o n8n faria sozinho nesse outro caminho: pausar E gravar.
async function pausarPacientePorTelefone(telefone) {
  await pool.query(
    `UPDATE public.cliente
     SET bot_disabled = true, human_assigned = true, last_handoff = (now() AT TIME ZONE 'UTC')
     WHERE telefone = $1 AND bot_disabled = false;`,
    [telefone]
  );
}

// Mesmo formato de linha que o node "Grava Mensagem Equipe" do n8n grava --
// tipo 'ai' com o prefixo "[Equipe da clínica]: ", pra ficar indistinguível
// de uma mensagem que o n8n tivesse gravado, e pra buscarMensagensPaciente/
// buscarConversas reconhecerem e estilizarem como bolha da equipe.
async function registrarMensagemEquipe(telefone, texto) {
  await pausarPacientePorTelefone(telefone);
  await pool.query(
    `INSERT INTO public.n8n_chat_histories (session_id, message)
     VALUES ($1, $2::jsonb);`,
    [
      telefone,
      JSON.stringify({
        type: 'ai',
        content: `[Equipe da clínica]: ${texto}`,
        tool_calls: [],
        additional_kwargs: {},
        response_metadata: {},
        invalid_tool_calls: [],
      }),
    ]
  );
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

// Página Analytics -- série histórica dos mesmos indicadores da Visão Geral
// mais o funil de resgate, agrupados numa granularidade só (dia/semana/mês/
// trimestre/ano), cada uma com sua janela padrão (ver GRANULARIDADES). Uma
// query só traz tudo de uma vez (várias métricas) pra trocar de métrica no
// gráfico ser client-side, sem bater na API de novo a cada clique.
async function buscarAnalyticsTendencia(granularidade) {
  const g = GRANULARIDADES[granularidade] ? granularidade : 'mes';
  const { unit, step, lookback } = GRANULARIDADES[g];

  const { rows } = await pool.query(
    `WITH parametros AS (
      SELECT
        GREATEST(
          date_trunc('${unit}', now() AT TIME ZONE '${FUSO_CLINICA}') - interval '${lookback}',
          date_trunc('${unit}', '${DADOS_REAIS_DESDE}'::timestamp)
        ) AS inicio_local,
        date_trunc('${unit}', now() AT TIME ZONE '${FUSO_CLINICA}') AS fim_local
    ),
    serie AS (
      SELECT generate_series(inicio_local, fim_local, interval '${step}') AS periodo
      FROM parametros
    ),
    agendamentos AS (
      SELECT date_trunc('${unit}', ea.criado_em AT TIME ZONE '${FUSO_CLINICA}') AS periodo,
        count(*) FILTER (WHERE ea.tipo = 'criado') AS consultas_criadas,
        count(*) FILTER (WHERE ea.tipo = 'confirmado') AS confirmados,
        count(*) FILTER (WHERE ea.tipo = 'cancelado') AS cancelados,
        count(*) FILTER (WHERE ea.tipo = 'remarcado') AS remarcados,
        count(*) FILTER (WHERE ea.tipo = 'lembrete_enviado') AS lembretes_enviados
      FROM public.eventos_agenda ea, parametros
      WHERE (ea.criado_em AT TIME ZONE '${FUSO_CLINICA}') >= parametros.inicio_local
      GROUP BY 1
    ),
    pacientes AS (
      SELECT date_trunc('${unit}', (c.created_at AT TIME ZONE 'UTC') AT TIME ZONE '${FUSO_CLINICA}') AS periodo,
        count(*) AS novos_pacientes
      FROM public.cliente c, parametros
      WHERE ((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE '${FUSO_CLINICA}') >= parametros.inicio_local
      GROUP BY 1
    ),
    mensagens AS (
      SELECT date_trunc('${unit}', h.created_at AT TIME ZONE '${FUSO_CLINICA}') AS periodo,
        count(*) AS mensagens_trocadas
      FROM public.n8n_chat_histories h, parametros
      WHERE (h.created_at AT TIME ZONE '${FUSO_CLINICA}') >= parametros.inicio_local
      GROUP BY 1
    ),
    pendencias AS (
      SELECT date_trunc('${unit}', (aa.created_at AT TIME ZONE 'UTC') AT TIME ZONE '${FUSO_CLINICA}') AS periodo,
        count(*) AS pendencias_abertas,
        count(*) FILTER (WHERE aa.detail LIKE 'URGÊNCIA%') AS urgencias_abertas
      FROM public.agent_actions aa, parametros
      WHERE ((aa.created_at AT TIME ZONE 'UTC') AT TIME ZONE '${FUSO_CLINICA}') >= parametros.inicio_local
      GROUP BY 1
    ),
    resgates AS (
      SELECT date_trunc('${unit}', f.resgate_enviado_em AT TIME ZONE '${FUSO_CLINICA}') AS periodo,
        count(*) AS tentativas_resgate
      FROM public.funil_agendamento f, parametros
      WHERE f.resgate_enviado_em IS NOT NULL
        AND (f.resgate_enviado_em AT TIME ZONE '${FUSO_CLINICA}') >= parametros.inicio_local
      GROUP BY 1
    ),
    recuperados AS (
      SELECT date_trunc('${unit}', f.concluido_em AT TIME ZONE '${FUSO_CLINICA}') AS periodo,
        count(*) AS recuperados
      FROM public.funil_agendamento f, parametros
      WHERE f.status = 'concluido' AND f.resgate_enviado_em IS NOT NULL AND f.concluido_em IS NOT NULL
        AND (f.concluido_em AT TIME ZONE '${FUSO_CLINICA}') >= parametros.inicio_local
      GROUP BY 1
    )
    SELECT
      to_char(s.periodo, 'YYYY-MM-DD"T"HH24:MI:SS') AS periodo,
      coalesce(ag.consultas_criadas, 0)::int AS consultas_criadas,
      coalesce(ag.confirmados, 0)::int AS confirmados,
      coalesce(ag.cancelados, 0)::int AS cancelados,
      coalesce(ag.remarcados, 0)::int AS remarcados,
      coalesce(ag.lembretes_enviados, 0)::int AS lembretes_enviados,
      coalesce(pc.novos_pacientes, 0)::int AS novos_pacientes,
      coalesce(m.mensagens_trocadas, 0)::int AS mensagens_trocadas,
      coalesce(pd.pendencias_abertas, 0)::int AS pendencias_abertas,
      coalesce(pd.urgencias_abertas, 0)::int AS urgencias_abertas,
      coalesce(rg.tentativas_resgate, 0)::int AS tentativas_resgate,
      coalesce(rc.recuperados, 0)::int AS recuperados
    FROM serie s
    LEFT JOIN agendamentos ag ON ag.periodo = s.periodo
    LEFT JOIN pacientes pc ON pc.periodo = s.periodo
    LEFT JOIN mensagens m ON m.periodo = s.periodo
    LEFT JOIN pendencias pd ON pd.periodo = s.periodo
    LEFT JOIN resgates rg ON rg.periodo = s.periodo
    LEFT JOIN recuperados rc ON rc.periodo = s.periodo
    ORDER BY s.periodo;`
  );

  const buckets = rows.map((r) => ({ ...r, rotulo: formatarRotuloPeriodo(r.periodo, g) }));

  // Cards de resumo do funil de resgate -- tentativas/recuperados usam a
  // mesma janela da granularidade escolhida; em_andamento/expirados são
  // estado atual (não faz sentido "somar" isso ao longo do tempo).
  const { rows: resumoRows } = await pool.query(
    `SELECT
      count(*) FILTER (
        WHERE resgate_enviado_em IS NOT NULL
          AND resgate_enviado_em >= GREATEST(now() - interval '${lookback}', ('${DADOS_REAIS_DESDE}'::timestamp AT TIME ZONE '${FUSO_CLINICA}'))
      )::int AS tentativas_resgate,
      count(*) FILTER (
        WHERE status = 'concluido' AND resgate_enviado_em IS NOT NULL
          AND concluido_em >= GREATEST(now() - interval '${lookback}', ('${DADOS_REAIS_DESDE}'::timestamp AT TIME ZONE '${FUSO_CLINICA}'))
      )::int AS recuperados,
      count(*) FILTER (WHERE status = 'em_andamento')::int AS em_andamento_agora,
      count(*) FILTER (WHERE status = 'expirado')::int AS expirados_agora
    FROM public.funil_agendamento;`
  );
  const resumo = resumoRows[0];
  const taxaRecuperacao = resumo.tentativas_resgate > 0 ? resumo.recuperados / resumo.tentativas_resgate : null;

  // DD/MM/AAAA do primeiro bucket de verdade -- já reflete o piso de
  // DADOS_REAIS_DESDE quando ele for o fator limitante (ver GREATEST em
  // "parametros" acima), sem precisar duplicar a lógica de novo aqui.
  const primeiroBucket = buckets[0]?.periodo;
  const desdeFormatado = primeiroBucket
    ? (([ano, mes, dia]) => `${dia}/${mes}/${ano}`)(primeiroBucket.split('T')[0].split('-'))
    : null;

  return { granularidade: g, buckets, desdeFormatado, resumoOportunidades: { ...resumo, taxa_recuperacao: taxaRecuperacao } };
}

// Stopwords em PT-BR pra nuvem de palavras -- sem isso, as palavras mais
// "faladas" seriam sempre "que", "para", "com"... e a nuvem não diz nada.
const STOPWORDS_PT = new Set(
  `a ao aos aquela aquelas aquele aqueles aquilo as até com como da das de dela
  delas dele deles depois do dos e ela elas ele eles em entre era eram essa
  essas esse esses esta estamos estas este esteja estejam estejamos estes
  esteve estive estivemos estiver estivera estiveram estiverem estivermos
  estivesse estivessem estivéramos estivéssemos estou está estávamos estão eu
  foi fomos for fora foram forem formos fosse fossem fui fôramos fôssemos
  haja hajam hajamos havemos havia hei houve houvemos houver houvera houveram
  houverei houverem houveremos houveria houveriam houvermos houverá houverão
  houveríamos houvesse houvessem houvéramos houvéssemos há hão isso isto já
  lhe lhes mais mas me mesmo meu meus minha minhas muito na nas nem no nos
  nossa nossas nosso nossos num numa não nós o os ou para pela pelas pelo
  pelos por qual quando que quem se seja sejam sejamos sem ser será serão
  serei seremos seria seriam seríamos seu seus somos sou sua suas são só
  também te tem temos tenha tenham tenhamos tenho ter terei teremos teria
  teriam teríamos teu teus teve tinha tinham tive tivemos tiver tivera
  tiveram tiverem tivermos tivesse tivessem tivéramos tivéssemos tu tua tuas
  tém tínhamos um uma você vocês vos à às éramos é foi so sim não oi olá
  ola tudo bem tá ta pra pro tô to né mesma mesmos mesmas ai aí então tbm
  vc vcs qnd pq porque onde aqui ali lá la ok blz obg obrigado obrigada
  agora hoje ontem amanha amanhã aqui dia horas hora minutos min assim sabe
  bom boa gente vou pode poder podem podemos posso quero queria sei vai vão
  ir precisar precisa precisamos preciso ajudar ajuda coisa coisas tudo nada
  algo alguma algum tipo dra doutora aline fica ficar ficou fico ficam duas
  fazer dar sobre deixar vamos tava achei parece pareceu antes menos cima vez
  favor certo espero forma ainda desses dessas nesse nessa prazer qualquer
  disposição verificar chamar gostaria estava estavam`
    .split(/\s+/)
    .filter(Boolean)
);

// Remove URL, prefixos tipo "[Lumi]:"/"[Equipe da clínica]" e blocos JSON
// crus (agent_action que às vezes vaza no texto salvo), aí tokeniza mantendo
// só letras (\p{L} pega acento também, então "não" continua "não" e não vira
// "no").
function tokenizarTexto(texto) {
  return (texto || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\{[\s\S]*?\}/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((palavra) => palavra.length >= 3 && !STOPWORDS_PT.has(palavra));
}

// Brasil não observa mais horário de verão desde 2019 -- América/São_Paulo é
// sempre UTC-3, então é seguro fixar o offset aqui em vez de precisar de
// suporte a timezone no JS puro. Usado pra mostrar a data real usada como
// piso (pode ser o piso fixo, ou a janela normal, o que for mais recente).
function calcularDesdeNuvem() {
  const piso = new Date(`${DADOS_REAIS_DESDE.replace(' ', 'T')}-03:00`);
  const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return trintaDiasAtras > piso ? trintaDiasAtras : piso;
}

// origem: 'paciente' (mensagens do paciente), 'lumi' (respostas da IA) ou
// 'ambos'. Últimos 30 dias, com o mesmo piso em 16/08/2026 (ver
// DADOS_REAIS_DESDE) usado no resto da página Analytics.

async function buscarNuvemPalavras(origem) {
  const tipoSql =
    origem === 'lumi' ? "= 'ai'" : origem === 'ambos' ? "IN ('human', 'ai')" : "= 'human'";

  const { rows } = await pool.query(
    `SELECT message->>'content' AS texto
     FROM public.n8n_chat_histories
     WHERE (message->>'type') ${tipoSql}
       AND created_at >= GREATEST(
         now() - interval '30 days',
         ('${DADOS_REAIS_DESDE}'::timestamp AT TIME ZONE '${FUSO_CLINICA}')
       )
       AND message->>'content' IS NOT NULL;`
  );

  const contagem = new Map();
  for (const { texto } of rows) {
    for (const palavra of tokenizarTexto(texto)) {
      contagem.set(palavra, (contagem.get(palavra) || 0) + 1);
    }
  }

  const palavras = [...contagem.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([palavra, contagem]) => ({ palavra, contagem }));

  const desdeFormatado = calcularDesdeNuvem().toLocaleDateString('pt-BR', { timeZone: FUSO_CLINICA });

  return {
    origem: ['paciente', 'lumi', 'ambos'].includes(origem) ? origem : 'paciente',
    desdeFormatado,
    palavras,
  };
}

// Expediente da clínica (dias/horários, duração da consulta, referência do
// sábado quinzenal) -- linha única em public.configuracao_horarios, lida
// também pelo server.js da ponte de automação (com cache de 60s lá). Sem
// linha ainda (banco não migrado) retorna null -- o front trata isso como
// "config ainda não inicializada".
async function buscarConfiguracaoHorarios() {
  // sabado_data_referencia::text evita que o driver `pg` converta a coluna
  // `date` num objeto Date ancorado no fuso do processo Node (ver mesmo
  // comentário em server.js/buscarConfiguracaoHorarios) -- como texto, o
  // valor "AAAA-MM-DD" chega intacto pro <input type="date"> do front.
  const { rows } = await pool.query(
    `SELECT horarios, duracao_consulta_minutos, sabado_data_referencia::text
     FROM public.configuracao_horarios
     WHERE id = 1;`
  );
  if (rows.length === 0) return null;
  return {
    horarios: rows[0].horarios,
    duracaoConsultaMinutos: rows[0].duracao_consulta_minutos,
    sabadoDataReferencia: rows[0].sabado_data_referencia,
  };
}

// Validação (formato HH:MM, duração, data) já foi feita na rota antes de
// chegar aqui -- esta função só grava.
async function salvarConfiguracaoHorarios({ horarios, duracaoConsultaMinutos, sabadoDataReferencia }) {
  await pool.query(
    `UPDATE public.configuracao_horarios
     SET horarios = $1, duracao_consulta_minutos = $2, sabado_data_referencia = $3, atualizado_em = now()
     WHERE id = 1;`,
    [JSON.stringify(horarios), duracaoConsultaMinutos, sabadoDataReferencia]
  );
}

module.exports = {
  buscarAnalytics,
  buscarDetalheAgendamentos,
  buscarDetalheNovosPacientes,
  buscarDetalheMensagens,
  buscarMensagensPaciente,
  buscarConversas,
  registrarMensagemEquipe,
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
  buscarAnalyticsTendencia,
  buscarNuvemPalavras,
  buscarConfiguracaoHorarios,
  salvarConfiguracaoHorarios,
};
