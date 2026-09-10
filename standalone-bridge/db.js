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

// Nunca deve derrubar o fluxo principal: uma falha aqui só é logada. Cobre
// 'em_andamento' E 'resgate_enviado' -- mesmo bug real corrigido em
// server.js/raiz 08/09/2026: o WHERE só cobria 'em_andamento', então assim
// que o resgate já tinha sido mandado o UPDATE virava no-op silencioso
// pra qualquer telefone (inclusive a própria Lumi fechando o agendamento
// dela mesma logo depois do resgate) -- funil ficava "zumbi" até expirar.
async function fecharFunil({ telefone, status }) {
  if (!pool || !telefone) return;
  try {
    await pool.query(
      `UPDATE public.funil_agendamento
       SET status = $2, concluido_em = now()
       WHERE telefone = $1 AND status IN ('em_andamento', 'resgate_enviado')`,
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
// em toda chamada de disponibilidade/agendamento. Chaveado por
// profissional (ou 'clinica' pro expediente singleton).
const cacheConfiguracaoHorarios = new Map(); // chave -> { expiraEm, dados }
let cacheProfissionais = { expiraEm: 0, dados: null };

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
//
// Multi-profissional: se `profissionalId` for passado E houver uma linha
// em public.profissional_horarios pra ele, essa linha vence, campo a
// campo, sobre o singleton (NULL na linha do profissional => herda o
// singleton). Sem profissionalId, ou sem linha própria => só o singleton,
// exatamente como antes.
async function buscarConfiguracaoHorarios(profissionalId) {
  const chave = profissionalId || 'clinica';
  const emCache = cacheConfiguracaoHorarios.get(chave);
  if (emCache && emCache.expiraEm > Date.now()) return emCache.dados;

  const padrao = {
    modeloHorarios: MODELO_HORARIOS_PADRAO,
    duracaoConsultaMinutos: DURACAO_CONSULTA_MINUTOS_PADRAO,
    sabadoDataReferencia: SABADO_DATA_REFERENCIA_PADRAO,
  };

  if (!pool) return padrao;

  try {
    const { rows } = await pool.query(
      'SELECT horarios, duracao_consulta_minutos, sabado_data_referencia::text FROM public.configuracao_horarios WHERE id = 1'
    );
    const base = rows.length
      ? {
          modeloHorarios: rows[0].horarios,
          duracaoConsultaMinutos: rows[0].duracao_consulta_minutos,
          sabadoDataReferencia: rows[0].sabado_data_referencia || null,
        }
      : { ...padrao };

    let dados = base;
    if (profissionalId) {
      try {
        const ph = await pool.query(
          'SELECT horarios, duracao_consulta_minutos, sabado_data_referencia::text FROM public.profissional_horarios WHERE profissional_id = $1',
          [profissionalId]
        );
        if (ph.rows.length) {
          dados = {
            modeloHorarios: ph.rows[0].horarios || base.modeloHorarios,
            duracaoConsultaMinutos: ph.rows[0].duracao_consulta_minutos ?? base.duracaoConsultaMinutos,
            sabadoDataReferencia: ph.rows[0].sabado_data_referencia || base.sabadoDataReferencia,
          };
        }
      } catch (erro) {
        // tabela ainda não existe (migration 014 não rodou) -> só o singleton
        if (!/relation .*profissional_horarios.* does not exist/i.test(erro.message)) {
          console.error('[configuracaoHorarios] falha ao ler expediente do profissional:', erro.message);
        }
      }
    }

    cacheConfiguracaoHorarios.set(chave, { expiraEm: Date.now() + 60_000, dados });
    return dados;
  } catch (erro) {
    console.error('[configuracaoHorarios] falha ao ler configuração do banco, usando valores padrão:', erro.message);
    return padrao;
  }
}

// Lista os profissionais ativos. Vazio quando: a tabela não existe
// (migration 014 não rodou) OU nenhum foi cadastrado -- nos dois casos o
// resto do sistema opera em "agenda única", exatamente como antes.
async function listarProfissionais() {
  if (cacheProfissionais.dados && cacheProfissionais.expiraEm > Date.now()) return cacheProfissionais.dados;
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, especialidades, especialidade_principal, aceita_primeira_consulta, padrao, cor, ordem
       FROM public.profissionais
       WHERE ativo
       ORDER BY ordem, nome`
    );
    const dados = rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      especialidades: r.especialidades || [],
      especialidadePrincipal: r.especialidade_principal || null,
      aceitaPrimeiraConsulta: r.aceita_primeira_consulta,
      padrao: r.padrao,
      cor: r.cor || null,
      ordem: r.ordem,
    }));
    cacheProfissionais = { expiraEm: Date.now() + 60_000, dados };
    return dados;
  } catch (erro) {
    if (!/relation .*profissionais.* does not exist/i.test(erro.message)) {
      console.error('[profissionais] falha ao listar, tratando como agenda única:', erro.message);
    }
    return [];
  }
}

// Resolve qual profissional escopar numa operação de agenda.
//  - profissionalId explícito -> valida contra a lista de ativos
//  - senão especialidade -> se casar com EXATAMENTE um ativo, usa ele
//  - senão -> o padrão
//  - retorna null quando não há profissionais cadastrados (agenda única)
async function resolverProfissionalParaAgenda({ profissionalId, especialidade } = {}) {
  const lista = await listarProfissionais();
  if (!lista.length) return null;

  if (profissionalId) {
    return lista.find((p) => p.id === profissionalId) || null;
  }
  if (especialidade) {
    const alvo = String(especialidade).trim().toLowerCase();
    const casam = lista.filter((p) =>
      (p.especialidades || []).some((e) => String(e).toLowerCase().includes(alvo) || alvo.includes(String(e).toLowerCase()))
    );
    if (casam.length === 1) return casam[0];
  }
  return lista.find((p) => p.padrao) || null;
}

module.exports = {
  pool,
  registrarEventoAgenda,
  abrirOuAtualizarFunil,
  fecharFunil,
  deveBloquearCancelamentoPorRemarcacao,
  buscarConfiguracaoHorarios,
  listarProfissionais,
  resolverProfissionalParaAgenda,
};
