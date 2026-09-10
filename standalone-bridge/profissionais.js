'use strict';

// CRUD de public.profissionais (+ public.profissional_horarios), usado
// pelo painel administrativo (Configurações). Não é ferramenta da Lumi.
//
// Invariantes:
//  - `nome` é único (chave natural do seed também).
//  - No máximo um `padrao`. Setar padrao=true em um tira dos outros (na
//    mesma transação). Não dá pra desativar o padrão nem tirar o padrão
//    dele sem passar pra outro.

const { pool, limparCacheProfissionais } = require('./db');

const DIAS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];

function normalizarEspecialidades(v) {
  if (Array.isArray(v)) return v.map((e) => String(e).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((e) => e.trim()).filter(Boolean);
  return [];
}

// { segunda: ["08:30", ...], ... } -> valida forma e HH:MM; devolve objeto
// só com os 7 dias (dia ausente = []).
function normalizarHorarios(h) {
  if (!h || typeof h !== 'object') return null;
  const out = {};
  for (const dia of DIAS) {
    const lista = Array.isArray(h[dia]) ? h[dia] : [];
    for (const hora of lista) {
      if (!/^\d{2}:\d{2}$/.test(String(hora))) {
        const e = new Error(`Horário inválido em ${dia}: "${hora}" (use HH:MM).`);
        e.code = 'DADOS';
        throw e;
      }
    }
    out[dia] = [...new Set(lista.map(String))].sort();
  }
  return out;
}

function erro(code, msg) {
  const e = new Error(msg);
  e.code = code;
  return e;
}

async function listarTodos() {
  const { rows } = await pool.query(
    `SELECT id, nome, especialidades, especialidade_principal, aceita_primeira_consulta,
            ativo, padrao, cor, ordem, observacoes
     FROM public.profissionais
     ORDER BY ordem, nome`
  );
  const ids = rows.map((r) => r.id);
  const horariosPorId = {};
  if (ids.length) {
    const ph = await pool.query(
      `SELECT profissional_id, horarios, duracao_consulta_minutos, sabado_data_referencia::text
       FROM public.profissional_horarios WHERE profissional_id = ANY($1::uuid[])`,
      [ids]
    );
    for (const r of ph.rows) {
      horariosPorId[r.profissional_id] = {
        horarios: r.horarios,
        duracaoConsultaMinutos: r.duracao_consulta_minutos,
        sabadoDataReferencia: r.sabado_data_referencia || null,
      };
    }
  }
  return rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    especialidades: r.especialidades || [],
    especialidadePrincipal: r.especialidade_principal || null,
    aceitaPrimeiraConsulta: r.aceita_primeira_consulta,
    ativo: r.ativo,
    padrao: r.padrao,
    cor: r.cor || null,
    ordem: r.ordem,
    observacoes: r.observacoes || null,
    expedienteProprio: horariosPorId[r.id] || null,
  }));
}

async function comTransacao(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    limparCacheProfissionais();
  }
}

// Aplica/remove o expediente próprio. horarios === undefined -> não mexe;
// null/false -> remove (passa a herdar configuracao_horarios); objeto ->
// upsert.
async function aplicarExpediente(client, profId, { horarios, duracaoConsultaMinutos, sabadoDataReferencia }) {
  if (horarios === undefined) return;
  if (!horarios) {
    await client.query('DELETE FROM public.profissional_horarios WHERE profissional_id = $1', [profId]);
    return;
  }
  const norm = normalizarHorarios(horarios);
  await client.query(
    `INSERT INTO public.profissional_horarios (profissional_id, horarios, duracao_consulta_minutos, sabado_data_referencia)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (profissional_id) DO UPDATE SET
       horarios = EXCLUDED.horarios,
       duracao_consulta_minutos = EXCLUDED.duracao_consulta_minutos,
       sabado_data_referencia = EXCLUDED.sabado_data_referencia,
       atualizado_em = now()`,
    [profId, JSON.stringify(norm), Number.isFinite(duracaoConsultaMinutos) ? duracaoConsultaMinutos : null, sabadoDataReferencia || null]
  );
}

async function criar(dados = {}) {
  const nome = String(dados.nome || '').trim();
  if (!nome) throw erro('DADOS', 'nome é obrigatório.');

  return comTransacao(async (client) => {
    const dup = await client.query('SELECT 1 FROM public.profissionais WHERE lower(nome) = lower($1)', [nome]);
    if (dup.rowCount) throw erro('DADOS', `Já existe um profissional com o nome "${nome}".`);

    const padrao = !!dados.padrao;
    if (padrao) await client.query('UPDATE public.profissionais SET padrao = false, atualizado_em = now() WHERE padrao');

    const { rows } = await client.query(
      `INSERT INTO public.profissionais
         (nome, especialidades, especialidade_principal, aceita_primeira_consulta, ativo, padrao, cor, ordem, observacoes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        nome,
        normalizarEspecialidades(dados.especialidades),
        (dados.especialidadePrincipal || '').trim() || null,
        dados.aceitaPrimeiraConsulta !== undefined ? !!dados.aceitaPrimeiraConsulta : true,
        dados.ativo !== undefined ? !!dados.ativo : true,
        padrao,
        (dados.cor || '').trim() || null,
        Number.isFinite(dados.ordem) ? dados.ordem : 0,
        (dados.observacoes || '').trim() || null,
      ]
    );
    await aplicarExpediente(client, rows[0].id, dados);
    return { id: rows[0].id, sucesso: true };
  });
}

async function atualizar(id, dados = {}) {
  if (!id) throw erro('DADOS', 'id é obrigatório.');

  return comTransacao(async (client) => {
    const atualRes = await client.query('SELECT * FROM public.profissionais WHERE id = $1', [id]);
    if (atualRes.rowCount === 0) throw erro('NAO_ENCONTRADO', `Nenhum profissional com id ${id}.`);
    const atual = atualRes.rows[0];

    // regras do padrão
    const querPadrao = dados.padrao === true;
    const tiraPadrao = dados.padrao === false;
    if (atual.padrao && tiraPadrao) {
      throw erro('DADOS', 'Não dá pra tirar o padrão deste sem passar pra outro. Defina outro profissional como padrão.');
    }
    const querDesativar = dados.ativo === false;
    if ((atual.padrao || querPadrao) && querDesativar) {
      throw erro('DADOS', 'O profissional padrão não pode ser desativado. Defina outro como padrão antes.');
    }

    if (dados.nome !== undefined) {
      const nome = String(dados.nome).trim();
      if (!nome) throw erro('DADOS', 'nome não pode ficar vazio.');
      const dup = await client.query('SELECT 1 FROM public.profissionais WHERE lower(nome) = lower($1) AND id <> $2', [nome, id]);
      if (dup.rowCount) throw erro('DADOS', `Já existe outro profissional com o nome "${nome}".`);
    }

    if (querPadrao && !atual.padrao) {
      await client.query('UPDATE public.profissionais SET padrao = false, atualizado_em = now() WHERE padrao');
    }

    const campos = {
      nome: dados.nome !== undefined ? String(dados.nome).trim() : undefined,
      especialidades: dados.especialidades !== undefined ? normalizarEspecialidades(dados.especialidades) : undefined,
      especialidade_principal: dados.especialidadePrincipal !== undefined ? ((dados.especialidadePrincipal || '').trim() || null) : undefined,
      aceita_primeira_consulta: dados.aceitaPrimeiraConsulta !== undefined ? !!dados.aceitaPrimeiraConsulta : undefined,
      ativo: dados.ativo !== undefined ? !!dados.ativo : undefined,
      padrao: dados.padrao !== undefined ? !!dados.padrao : undefined,
      cor: dados.cor !== undefined ? ((dados.cor || '').trim() || null) : undefined,
      ordem: Number.isFinite(dados.ordem) ? dados.ordem : undefined,
      observacoes: dados.observacoes !== undefined ? ((dados.observacoes || '').trim() || null) : undefined,
    };
    const sets = [];
    const params = [];
    for (const [col, val] of Object.entries(campos)) {
      if (val === undefined) continue;
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    }
    if (sets.length) {
      params.push(id);
      await client.query(`UPDATE public.profissionais SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $${params.length}`, params);
    }

    await aplicarExpediente(client, id, dados);
    return { id, sucesso: true };
  });
}

module.exports = { listarTodos, criar, atualizar };
