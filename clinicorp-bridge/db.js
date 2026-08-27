'use strict';

// Escrita no mesmo Postgres/schema que o server.js da raiz (Simples Dental)
// já usa -- eventos_agenda (Analytics), funil_agendamento (resgate),
// agendamento_telefone (lembretes). Portado de server.js linhas ~32-127.
// Nenhuma mudança de schema: o painel admin e os workflows de resgate/
// lembrete funcionam pra uma clínica Clinicorp sem saber a diferença.
//
// Mantenha em sincronia manual com o original se a lógica de lá mudar.

const { Pool } = require('pg');
const { paraDataISO, somenteDigitos } = require('./tempo');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    })
  : null;

if (!pool) {
  console.warn('[db] DATABASE_URL não configurada -- eventos de agenda/funil não serão registrados (analytics e resgate ficarão sem dados).');
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

// Só é chamada a partir de /verificar-disponibilidade -- sempre marca (ou
// promove) a tentativa pra etapa "horario_oferecido".
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

// Fecha a tentativa em_andamento pro telefone (agendamento confirmado --
// não faz mais sentido mandar resgate pra essa tentativa).
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

// Mapeia agendamento (Clinicorp) -> telefone, pro workflow de lembretes
// conseguir descobrir quem avisar. No Clinicorp isso é menos crítico que
// no Simples Dental (o paciente já tem telefone cadastrado via patient/get/
// create), mas mantido pra reaproveitar o mesmo mecanismo de lembrete já
// existente sem duplicar lógica lá.
async function salvarTelefoneAgendamento({ agendamentoId, telefone }) {
  if (!pool || !agendamentoId || !telefone) return;
  try {
    await pool.query(
      `INSERT INTO public.agendamento_telefone (agendamento_id, telefone, atualizado_em)
       VALUES ($1, $2, now())
       ON CONFLICT (agendamento_id) DO UPDATE SET telefone = EXCLUDED.telefone, atualizado_em = now()`,
      [String(agendamentoId), somenteDigitos(telefone)]
    );
  } catch (erro) {
    console.error('[agendamentoTelefone] falha ao salvar mapeamento (não afeta a resposta ao paciente):', erro.message);
  }
}

module.exports = {
  pool,
  registrarEventoAgenda,
  abrirOuAtualizarFunil,
  fecharFunil,
  salvarTelefoneAgendamento,
};
