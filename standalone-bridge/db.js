'use strict';

// Pool Postgres + funções de funil/analytics/configuração -- copiadas de
// server.js (raiz), mesmo padrão de duplicação de clinicorp-bridge/db.js.
// Diferença real em relação aos outros dois bridges: aqui public.consultas
// é a FONTE DE VERDADE da agenda (não um espelho), então não existe
// agendamento_telefone/paciente_dependente-via-nome-ambíguo -- o telefone
// já vem certo desde a criação, sem precisar resolver depois.

const { Pool } = require('pg');
const { paraDataISO, telefoneLocal } = require('./tempo');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    })
  : null;

if (!pool) {
  console.warn('[db] DATABASE_URL não configurada -- este serviço não funciona sem banco (aqui a agenda MORA no Postgres, não é só analytics).');
}

// Nunca deve derrubar o fluxo principal: uma falha aqui só é logada.
async function registrarEventoAgenda({ tipo, telefone, categoria, data, hora }) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO public.eventos_agenda (tipo, telefone, categoria, data_consulta, hora_consulta)
       VALUES ($1, $2, $3, $4, $5)`,
      [tipo, telefone || null, categoria || null, data ? paraDataISO(data) : null, hora || null]
    );
  } catch (erro) {
    console.error('[eventosAgenda] falha ao registrar evento (não afeta a resposta ao paciente):', erro.message);
  }
}

// Nunca deve derrubar o fluxo principal: uma falha aqui só é logada.
async function abrirOuAtualizarFunil({ telefone, instancia, etapa = 'horario_oferecido' }) {
  if (!pool || !telefone) return;
  try {
    const atualizado = await pool.query(
      `UPDATE public.funil_agendamento
       SET ultima_interacao_em = now(), etapa = $2
       WHERE telefone = $1 AND status = 'em_andamento'`,
      [telefone, etapa]
    );
    if (atualizado.rowCount === 0) {
      await pool.query(
        `INSERT INTO public.funil_agendamento (telefone, instancia, etapa)
         VALUES ($1, $2, $3)`,
        [telefone, instancia || null, etapa]
      );
    }
  } catch (erro) {
    console.error('[funilAgendamento] falha ao abrir/atualizar tentativa (não afeta a resposta ao paciente):', erro.message);
  }
}

// Nunca deve derrubar o fluxo principal: uma falha aqui só é logada.
async function fecharFunil({ telefone, status }) {
  if (!pool || !telefone) return;
  try {
    await pool.query(
      `UPDATE public.funil_agendamento
       SET status = $2, concluido_em = now()
       WHERE telefone = $1 AND status = 'em_andamento'`,
      [telefone, status]
    );
  } catch (erro) {
    console.error('[funilAgendamento] falha ao fechar tentativa (não afeta a resposta ao paciente):', erro.message);
  }
}

// Guard do fix 2b (28/08, generalizado 02/09) -- ver comentário completo
// em server.js (raiz). Copiado sem alteração: protege contra cancelar um
// agendamento "no susto" no meio de uma remarcação, mesmo quando não há
// tentativa em_andamento no funil (ex: consulta já confirmada sendo
// remanejada ao vivo). Fail-open: qualquer erro/infra ausente => false.
async function deveBloquearCancelamentoPorRemarcacao(telefoneLocalTexto) {
  if (!pool || !telefoneLocalTexto) return false;
  const jid = '55' + require('./tempo').somenteDigitos(telefoneLocalTexto) + '@s.whatsapp.net';
  try {
    const msgs = await pool.query(
      `SELECT message->>'content' AS c
       FROM public.n8n_chat_histories
       WHERE session_id = $1 AND message->>'type' = 'human'
       ORDER BY created_at DESC
       LIMIT 6`,
      [jid]
    );
    const texto = msgs.rows.map((r) => (r.c || '').toLowerCase()).join('\n');
    const pediuCancelarExplicito =
      /\bcancel|desmarc|desist|n[aã]o quero mais|n[aã]o vou (mais )?(poder )?(ir|comparecer)|(remover|tirar|excluir) (a |minha )?consulta/.test(
        texto
      );
    if (pediuCancelarExplicito) return false;

    const remarcando = await pool.query(
      `SELECT 1 FROM public.funil_agendamento
       WHERE telefone = $1 AND status = 'em_andamento'
         AND ultima_interacao_em > now() - interval '2 hours'
       LIMIT 1`,
      [jid]
    );
    if (remarcando.rowCount > 0) return true;

    const pediuRemarcar =
      /\bremarc|mudar (o )?hor[áa]rio|outro hor[áa]rio|trocar (o )?dia|mais tarde|mais cedo|reagendar/.test(texto);
    return pediuRemarcar;
  } catch (erro) {
    console.error('[cancelarAgendamento] guard de remarcação falhou -- deixando passar:', erro.message);
    return false;
  }
}

// Cache de 60s (mesmo padrão de server.js/raiz) -- evita bater no Postgres
// em toda chamada de disponibilidade/agendamento.
let cacheConfiguracaoHorarios = { expiraEm: 0, dados: null };

const MODELO_HORARIOS_PADRAO = {
  segunda: ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30', '16:30'],
  terca: [],
  quarta: ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30', '16:30'],
  quinta: [],
  sexta: ['08:00', '09:00', '10:00'],
  sabado: ['08:00', '09:00', '10:00'],
  domingo: [],
};
const DURACAO_CONSULTA_MINUTOS_PADRAO = Number(process.env.DURACAO_CONSULTA_MINUTOS || 60);
const SABADO_DATA_REFERENCIA_PADRAO = process.env.SABADO_DATA_REFERENCIA || null;

// Config real do expediente mora em public.configuracao_horarios (editável
// no painel admin, mesma tabela que server.js/raiz usa -- singleton
// compartilhado entre clínicas seria errado em multi-tenant real, mas cada
// clínica standalone tem seu PRÓPRIO banco isolado, então não há conflito).
async function buscarConfiguracaoHorarios() {
  if (cacheConfiguracaoHorarios.dados && cacheConfiguracaoHorarios.expiraEm > Date.now()) {
    return cacheConfiguracaoHorarios.dados;
  }

  const padrao = {
    modeloHorarios: MODELO_HORARIOS_PADRAO,
    duracaoConsultaMinutos: DURACAO_CONSULTA_MINUTOS_PADRAO,
    sabadoDataReferencia: SABADO_DATA_REFERENCIA_PADRAO,
  };

  if (!pool) return padrao;

  try {
    const { rows } = await pool.query(
      "SELECT horarios, duracao_consulta_minutos, sabado_data_referencia::text FROM public.configuracao_horarios WHERE id = 1"
    );
    if (rows.length === 0) return padrao;

    const dados = {
      modeloHorarios: rows[0].horarios,
      duracaoConsultaMinutos: rows[0].duracao_consulta_minutos,
      sabadoDataReferencia: rows[0].sabado_data_referencia || null,
    };
    cacheConfiguracaoHorarios = { expiraEm: Date.now() + 60_000, dados };
    return dados;
  } catch (erro) {
    console.error('[configuracaoHorarios] falha ao ler configuração do banco, usando valores padrão:', erro.message);
    return padrao;
  }
}

module.exports = {
  pool,
  registrarEventoAgenda,
  abrirOuAtualizarFunil,
  fecharFunil,
  deveBloquearCancelamentoPorRemarcacao,
  buscarConfiguracaoHorarios,
};
