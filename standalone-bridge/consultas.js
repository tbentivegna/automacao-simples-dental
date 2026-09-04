'use strict';

// CRUD direto em public.consultas -- aqui ela é a fonte de verdade da
// agenda (não um espelho, como no server.js/raiz -- ver comentário na
// migration 011_consultas.sql, escrito antes de "standalone" existir
// como ideia). Sem Playwright, sem API externa: cada função aqui é só
// SQL + os mesmos cálculos de horário puros que server.js/raiz já usa
// (reaproveitados via tempo.js).

const crypto = require('crypto');
const {
  pool,
  registrarEventoAgenda,
  fecharFunil,
  buscarConfiguracaoHorarios,
} = require('./db');
const {
  paraDataISO,
  jidDeLocal,
  somenteDigitos,
  calcularSlotsSemana,
  agruparPorDiaSemana,
  formatadorDiaISO,
  formatarCompromissos,
  FUSO,
  OFFSET_BRASILIA,
} = require('./tempo');

const SEMANAS_A_VERIFICAR = Number(process.env.SEMANAS_A_VERIFICAR || 4);
const STATUS_QUE_NAO_OCUPAM = [
  'Cancelada pelo paciente',
  'Cancelada pelo profissional',
  'Falta',
  'removido_do_calendario',
];

// Mesma lista de STATUS_VALIDOS do server.js/raiz e STATUS_CONSULTA do
// painel administrativo (admin-panel/public/assets/app.js) -- usada só
// por mudarStatusAgendamento, pra rejeitar valor inválido/digitado errado
// antes de gravar no banco (a raiz já validava isso, aqui não validava
// nada até agora).
const STATUS_VALIDOS = [
  'Agendada',
  'Confirmada',
  'Em atendimento',
  'Falta',
  'Cancelada pelo paciente',
  'Cancelada pelo profissional',
];

async function verificarDisponibilidade({ diaSemana, periodo } = {}) {
  const configuracaoHorarios = await buscarConfiguracaoHorarios();
  const semanas = SEMANAS_A_VERIFICAR;

  const fimJanela = new Date();
  fimJanela.setDate(fimJanela.getDate() + semanas * 7 + 1);

  const { rows } = await pool.query(
    `SELECT extract(epoch from inicio) * 1000 AS inicio, extract(epoch from fim) * 1000 AS fim
     FROM public.consultas
     WHERE inicio < $1
       AND fim > now()
       AND NOT (status = ANY ($2::text[]))`,
    [fimJanela.toISOString(), STATUS_QUE_NAO_OCUPAM]
  );
  const compromissos = rows.map((r) => ({ inicio: Number(r.inicio), fim: Number(r.fim) }));

  // Sem conceito de "bloqueio de dia inteiro" externo aqui (era um
  // artefato do calendário do Simples Dental, tipo folga/feriado marcado
  // na UI de lá) -- fora de escopo desta 1ª versão. Se precisar, dá pra
  // adicionar uma tabela `bloqueios_agenda` própria depois.
  const diasBloqueados = new Set();

  const horarios = calcularSlotsSemana(
    compromissos,
    semanas,
    diasBloqueados,
    diaSemana || null,
    periodo || null,
    configuracaoHorarios
  );

  return {
    horarios,
    resumoPorDiaSemana: agruparPorDiaSemana(horarios),
    diasBloqueados: Array.from(diasBloqueados),
    semanasVerificadas: semanas,
  };
}

// pacienteNovo: sem uma tabela de paciente própria ainda (fora de escopo
// desta 1ª versão -- ver README), a melhor aproximação disponível é
// perguntar "esse telefone já tem alguma consulta registrada aqui,
// qualquer status?". Se não, trata como novo (pede cadastro completo no
// prompt); se sim, trata como já conhecido.
async function ehPacienteNovo(telefoneJid) {
  const r = await pool.query('SELECT 1 FROM public.consultas WHERE telefone = $1 LIMIT 1', [telefoneJid]);
  return r.rowCount === 0;
}

async function criarAgendamento({
  telefone,
  nomePaciente,
  data,
  hora,
  duracaoMinutos,
  observacao,
  categoria,
  rotulo,
  dataNascimentoPaciente,
  cpfPaciente,
  nomeResponsavel,
} = {}) {
  if (!telefone || !data || !hora) {
    throw new Error('Campos obrigatórios faltando: telefone, data e hora são necessários.');
  }
  if (!nomePaciente) {
    // Diferente do server.js/raiz (que só exige nomePaciente quando o
    // Simples Dental não encontra o telefone já cadastrado), standalone
    // não tem cadastro prévio nenhum pra consultar -- todo agendamento
    // precisa do nome.
    throw new Error('nomePaciente é obrigatório.');
  }

  const jid = jidDeLocal(telefone);
  const config = await buscarConfiguracaoHorarios();
  const duracao = Number(duracaoMinutos || config.duracaoConsultaMinutos);

  const dataISO = paraDataISO(data);
  const inicio = new Date(`${dataISO}T${hora}:00${OFFSET_BRASILIA}`);
  const fim = new Date(inicio.getTime() + duracao * 60 * 1000);

  const pacienteNovo = await ehPacienteNovo(jid);

  // Checa conflito de verdade na hora de criar (não só confiar no que
  // Verifica Disponibilidade retornou segundos antes) -- outra chamada
  // pode ter ocupado o horário no meio do caminho.
  const conflito = await pool.query(
    `SELECT 1 FROM public.consultas
     WHERE inicio < $1 AND fim > $2
       AND NOT (status = ANY ($3::text[]))
     LIMIT 1`,
    [fim.toISOString(), inicio.toISOString(), STATUS_QUE_NAO_OCUPAM]
  );
  if (conflito.rowCount > 0) {
    throw new Error('CONFLITO_HORARIO: esse horário já foi ocupado.');
  }

  const agendamentoId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO public.consultas
       (agendamento_id, paciente_nome, inicio, fim, status, telefone, rotulo, origem)
     VALUES ($1, $2, $3, $4, 'Agendada', $5, $6, 'bot')`,
    [agendamentoId, nomePaciente.trim(), inicio.toISOString(), fim.toISOString(), jid, rotulo || null]
  );

  await registrarEventoAgenda({ tipo: 'criado', telefone: jid, categoria, data, hora });
  await fecharFunil({ telefone: jid, status: 'concluido' });

  // Vínculo responsável -> dependente, mesma tabela que server.js/raiz já
  // usa (schema-agnóstica, não é específica do Simples Dental).
  if (nomeResponsavel) {
    try {
      await pool.query(
        `INSERT INTO public.paciente_dependente
           (responsavel_telefone, dependente_nome, dependente_nascimento, dependente_cpf)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (responsavel_telefone, dependente_nome) DO UPDATE SET
           dependente_nascimento = COALESCE(EXCLUDED.dependente_nascimento, public.paciente_dependente.dependente_nascimento),
           dependente_cpf        = COALESCE(EXCLUDED.dependente_cpf, public.paciente_dependente.dependente_cpf)`,
        [
          jid,
          nomePaciente.trim(),
          dataNascimentoPaciente ? paraDataISO(dataNascimentoPaciente) : null,
          cpfPaciente ? somenteDigitos(cpfPaciente) : null,
        ]
      );
    } catch (erro) {
      console.error('[criarAgendamento] falha ao gravar paciente_dependente (não afeta o agendamento):', erro.message);
    }
  }

  // Mesmo contrato de retorno do server.js/raiz -- de propósito NÃO
  // inclui o id do agendamento (o fluxo real também não devolve; quem
  // precisa do id busca depois via Busca Agendamentos do Paciente).
  return {
    sucesso: true,
    pacienteNovo,
    data,
    hora,
    duracaoMinutos: duracao,
  };
}

async function buscarAgendamentosPaciente({ telefone, semanas, nomePaciente } = {}) {
  if (!telefone) {
    throw new Error('Campo obrigatório faltando: telefone.');
  }
  const jid = jidDeLocal(telefone);
  const totalSemanas = Number(semanas || SEMANAS_A_VERIFICAR);

  // Mesmo critério do server.js/raiz: a busca cobre desde o INÍCIO do dia
  // de hoje (não só "a partir de agora") -- uma consulta de hoje de manhã,
  // mesmo já tendo passado, ainda deve aparecer (é o caso Thalita, ver
  // jaOcorreu abaixo).
  const inicioJanela = new Date(`${formatadorDiaISO.format(new Date())}T00:00:00${OFFSET_BRASILIA}`);
  const fimJanela = new Date();
  fimJanela.setDate(fimJanela.getDate() + totalSemanas * 7 + 1);

  const params = [jid, inicioJanela.toISOString(), fimJanela.toISOString()];
  let filtroNome = '';
  if (nomePaciente) {
    filtroNome = 'AND paciente_nome ILIKE $4';
    params.push(`%${nomePaciente.trim()}%`);
  }

  const { rows } = await pool.query(
    `SELECT agendamento_id AS id, paciente_nome AS paciente, status,
            extract(epoch from inicio) * 1000 AS inicio, extract(epoch from fim) * 1000 AS fim
     FROM public.consultas
     WHERE telefone = $1 AND inicio >= $2 AND inicio < $3 ${filtroNome}
     ORDER BY inicio ASC
     LIMIT 20`,
    params
  );

  if (rows.length === 0) {
    return { encontrado: false, agendamentos: [] };
  }

  const agora = Date.now();
  const agendamentos = rows.map((r) => ({
    id: r.id,
    status: r.status,
    paciente: r.paciente,
    // jaOcorreu: mesmo campo/racional do server.js/raiz (caso Thalita) --
    // calculado aqui, não deixado pro modelo comparar data sozinho.
    jaOcorreu: Number(r.fim) < agora,
    inicioFormatado: new Date(Number(r.inicio)).toLocaleString('pt-BR', {
      timeZone: FUSO,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    fimFormatado: new Date(Number(r.fim)).toLocaleString('pt-BR', {
      timeZone: FUSO,
      hour: '2-digit',
      minute: '2-digit',
    }),
  }));

  return {
    encontrado: true,
    nomePaciente: rows[0].paciente,
    agendamentos,
    semanasVerificadas: totalSemanas,
  };
}

async function mudarStatusAgendamento({ id, status, telefone } = {}) {
  if (!id || !status) {
    throw new Error('Campos obrigatórios faltando: id e status são necessários.');
  }
  if (!STATUS_VALIDOS.includes(status)) {
    throw new Error(`Status inválido: "${status}". Valores aceitos: ${STATUS_VALIDOS.join(', ')}`);
  }

  const r = await pool.query(
    `UPDATE public.consultas SET status = $2, atualizado_em = now()
     WHERE agendamento_id = $1
     RETURNING agendamento_id`,
    [id, status]
  );
  if (r.rowCount === 0) {
    throw new Error(`Não foi encontrado nenhum agendamento com id ${id}.`);
  }

  // Só Confirmada/Cancelada* têm tipo correspondente em eventos_agenda
  // (usado pelo Analytics) -- mesmo critério do server.js/raiz.
  const tipoEvento = status === 'Confirmada' ? 'confirmado' : status.startsWith('Cancelada') ? 'cancelado' : null;
  if (tipoEvento) {
    await registrarEventoAgenda({ tipo: tipoEvento, telefone: telefone ? jidDeLocal(telefone) : null });
  }

  return { sucesso: true, id, status };
}

async function remarcarAgendamento({ id, data, hora, duracaoMinutos, observacao, telefone } = {}) {
  if (!id || !data || !hora) {
    throw new Error('Campos obrigatórios faltando: id, data e hora são necessários.');
  }

  const config = await buscarConfiguracaoHorarios();
  const duracao = Number(duracaoMinutos || config.duracaoConsultaMinutos);
  const dataISO = paraDataISO(data);
  const inicio = new Date(`${dataISO}T${hora}:00${OFFSET_BRASILIA}`);
  const fim = new Date(inicio.getTime() + duracao * 60 * 1000);

  const conflito = await pool.query(
    `SELECT 1 FROM public.consultas
     WHERE agendamento_id <> $1 AND inicio < $2 AND fim > $3
       AND NOT (status = ANY ($4::text[]))
     LIMIT 1`,
    [id, fim.toISOString(), inicio.toISOString(), STATUS_QUE_NAO_OCUPAM]
  );
  if (conflito.rowCount > 0) {
    throw new Error('CONFLITO_HORARIO: esse horário já foi ocupado.');
  }

  // Volta pra 'Agendada' -- diferente do Simples Dental (onde remarcar
  // mantém o status anterior), aqui é uma decisão deliberada: o novo
  // horário ainda não foi confirmado pelo paciente, mesmo que o antigo
  // já tivesse sido. Reavaliar se isso incomodar na prática.
  const r = await pool.query(
    `UPDATE public.consultas SET inicio = $2, fim = $3, status = 'Agendada', atualizado_em = now()
     WHERE agendamento_id = $1
     RETURNING agendamento_id`,
    [id, inicio.toISOString(), fim.toISOString()]
  );
  if (r.rowCount === 0) {
    throw new Error(`Não foi encontrado nenhum agendamento com id ${id}.`);
  }

  const jid = telefone ? jidDeLocal(telefone) : null;
  await registrarEventoAgenda({ tipo: 'remarcado', telefone: jid, data, hora });
  if (jid) await fecharFunil({ telefone: jid, status: 'concluido' });

  return { sucesso: true, id, data, hora, duracaoMinutos: duracao };
}

// Usada pela página Agenda do painel administrativo (não é ferramenta da
// Lumi) -- lista TODOS os compromissos das próximas N semanas, inclusive
// cancelados (a Agenda é uma visão completa; quem decide esconder ou não
// é o front, mesmo critério do listarAgendaSemana da raiz). Sem
// rotuloCor -- essa coluna não existe em public.consultas (ver
// 011_consultas.sql); o painel já trata isso como opcional.
async function listarAgendaSemana({ semanas } = {}) {
  const totalSemanas = Math.min(4, Math.max(1, Number(semanas) || SEMANAS_A_VERIFICAR));

  const inicioJanela = new Date(`${formatadorDiaISO.format(new Date())}T00:00:00${OFFSET_BRASILIA}`);
  const fimJanela = new Date(inicioJanela);
  fimJanela.setDate(fimJanela.getDate() + totalSemanas * 7 + 1);

  const { rows } = await pool.query(
    `SELECT agendamento_id AS id, paciente_nome AS paciente, status, rotulo,
            extract(epoch from inicio) * 1000 AS inicio, extract(epoch from fim) * 1000 AS fim
     FROM public.consultas
     WHERE inicio >= $1 AND inicio < $2
     ORDER BY inicio ASC`,
    [inicioJanela.toISOString(), fimJanela.toISOString()]
  );

  const compromissos = rows.map((r) => ({
    id: r.id,
    inicio: Number(r.inicio),
    fim: Number(r.fim),
    status: r.status,
    paciente: r.paciente,
    rotulo: r.rotulo,
  }));

  return { semanasVerificadas: totalSemanas, compromissos: formatarCompromissos(compromissos) };
}

// Usada pela página Agenda do painel administrativo. Diferente do Simples
// Dental (rótulo precisa bater com um valor pré-cadastrado, autocomplete),
// aqui é texto livre -- sem validação de formato.
async function mudarRotuloAgendamento({ id, rotulo, telefone } = {}) {
  if (!id || !rotulo) {
    throw new Error('Campos obrigatórios faltando: id e rotulo são necessários.');
  }

  const r = await pool.query(
    `UPDATE public.consultas SET rotulo = $2, atualizado_em = now()
     WHERE agendamento_id = $1
     RETURNING agendamento_id`,
    [id, rotulo]
  );
  if (r.rowCount === 0) {
    throw new Error(`Não foi encontrado nenhum agendamento com id ${id}.`);
  }

  return { sucesso: true, id, rotulo };
}

module.exports = {
  verificarDisponibilidade,
  criarAgendamento,
  buscarAgendamentosPaciente,
  mudarStatusAgendamento,
  remarcarAgendamento,
  listarAgendaSemana,
  mudarRotuloAgendamento,
};
