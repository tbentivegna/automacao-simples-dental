'use strict';

// Mocks das 6 tools reais (server.js), sem tocar no Simples Dental de verdade.
// Reproduz o mesmo formato de resposta e as mesmas regras de agenda
// (server.js: MODELO_HORARIOS, ehSabadoAberto, calcularSlotsSemana) para que
// os testes de diálogo com a Lumi sejam realistas.

const FUSO = 'America/Sao_Paulo';
const OFFSET_BRASILIA = '-03:00';
const DURACAO_CONSULTA_MINUTOS = 90;
const SEMANAS_A_VERIFICAR = 4;
const SABADO_DATA_REFERENCIA = '2026-08-01';

const MODELO_HORARIOS = {
  segunda: ['08:30', '10:00', '13:30', '15:00'],
  terca: [],
  quarta: ['08:30', '10:00', '13:30', '15:00'],
  quinta: [],
  sexta: ['08:00', '09:30', '11:00'],
  sabado: ['08:00', '09:30', '11:00'],
  domingo: [],
};

const NOMES_DIA_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const formatadorDiaISO = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO });

function nomeDiaSemana(diaISO) {
  return NOMES_DIA_SEMANA[new Date(`${diaISO}T12:00:00${OFFSET_BRASILIA}`).getDay()];
}

function ehSabadoAberto(diaISO) {
  const msPorDia = 24 * 60 * 60 * 1000;
  const dataRef = new Date(`${SABADO_DATA_REFERENCIA}T00:00:00${OFFSET_BRASILIA}`).getTime();
  const dataAtual = new Date(`${diaISO}T00:00:00${OFFSET_BRASILIA}`).getTime();
  const diffDias = Math.round((dataAtual - dataRef) / msPorDia);
  return diffDias % 14 === 0;
}

function paraDataISO(dataBR) {
  // "DD/MM/AAAA" -> "AAAA-MM-DD"
  const [d, m, a] = dataBR.split('/');
  return `${a}-${m}-${d}`;
}

// Cria um novo estado isolado (uma "sessão" de teste = uma agenda fake +
// um cadastro fake de pacientes por telefone). Cada tool recebida do
// modelo chama um dos métodos abaixo em vez de bater no server.js real.
function criarEstadoFake({ telefonePaciente = '11999998888', falharProximaCriacao = false } = {}) {
  const agenda = []; // { id, dataISO, hora, paciente, telefone, status }
  const pacientesPorTelefone = new Map(); // telefone -> nome
  let proximoId = 900000;
  let falharProxima = falharProximaCriacao;

  function slotOcupado(dataISO, hora) {
    return agenda.some(
      (a) => a.dataISO === dataISO && a.hora === hora && a.status !== 'Cancelada pelo paciente' && a.status !== 'Cancelada pelo profissional'
    );
  }

  function verificar_disponibilidade({ diaSemana: diaSemanaFiltro, periodo: periodoFiltro } = {}) {
    const hojeISO = formatadorDiaISO.format(new Date());
    const diaSemanaHoje = new Date(`${hojeISO}T12:00:00${OFFSET_BRASILIA}`).getDay();
    const deslocamentoAteSegunda = diaSemanaHoje === 0 ? -6 : 1 - diaSemanaHoje;
    const segunda = new Date(`${hojeISO}T12:00:00${OFFSET_BRASILIA}`);
    segunda.setDate(segunda.getDate() + deslocamentoAteSegunda);

    const horarios = {};
    const totalDias = SEMANAS_A_VERIFICAR * 7;

    for (let i = 0; i < totalDias; i++) {
      const diaAtual = new Date(segunda);
      diaAtual.setDate(segunda.getDate() + i);
      const diaISO = formatadorDiaISO.format(diaAtual);

      if (diaISO <= hojeISO) continue;

      const nomeDia = nomeDiaSemana(diaISO);

      // Filtro por dia da semana: se o paciente pediu um dia específico, o
      // modelo já manda esse filtro na chamada -- nem entra no resultado o
      // que não é esse dia, então não sobra nada pra "escanear" depois.
      if (diaSemanaFiltro && nomeDia !== diaSemanaFiltro) continue;

      let horariosDoDia = MODELO_HORARIOS[nomeDia] || [];

      if (nomeDia === 'sabado' && !ehSabadoAberto(diaISO)) horariosDoDia = [];
      if (horariosDoDia.length === 0) continue;

      const diaBR = new Date(`${diaISO}T00:00:00${OFFSET_BRASILIA}`).toLocaleDateString('pt-BR', { timeZone: FUSO });

      // Só entra no resultado o que está livre -- horário ocupado não serve
      // pra nada no fluxo de agendamento, e só é mais uma coisa que o modelo
      // precisaria filtrar/ignorar corretamente (o que ele nem sempre faz).
      let horariosLivres = horariosDoDia.filter((horario) => !slotOcupado(diaISO, horario));

      if (periodoFiltro === 'manha') horariosLivres = horariosLivres.filter((h) => h < '12:00');
      if (periodoFiltro === 'tarde') horariosLivres = horariosLivres.filter((h) => h >= '12:00');

      if (horariosLivres.length === 0) continue;

      horarios[diaBR] = {
        diaSemana: nomeDia,
        horariosDisponiveis: horariosLivres,
      };
    }

    // Resumo pré-calculado por dia da semana + período -- existe pra evitar
    // que o modelo tenha que escanear manualmente um objeto grande com
    // várias datas (experimentalmente, ele erra/pula datas nesse
    // escaneamento manual).
    const resumoPorDiaSemana = {};
    for (const [diaBR, info] of Object.entries(horarios)) {
      if (!resumoPorDiaSemana[info.diaSemana]) {
        resumoPorDiaSemana[info.diaSemana] = { manha: [], tarde: [] };
      }

      const manha = info.horariosDisponiveis.filter((h) => h < '12:00');
      const tarde = info.horariosDisponiveis.filter((h) => h >= '12:00');

      if (manha.length) resumoPorDiaSemana[info.diaSemana].manha.push({ data: diaBR, horarios: manha });
      if (tarde.length) resumoPorDiaSemana[info.diaSemana].tarde.push({ data: diaBR, horarios: tarde });
    }

    return { horarios, resumoPorDiaSemana, diasBloqueados: [], semanasVerificadas: SEMANAS_A_VERIFICAR };
  }

  function criar_agendamento({ nomePaciente, data, hora, observacao } = {}) {
    if (!data || !hora) {
      throw new Error('Campos obrigatórios faltando: data e/ou hora.');
    }

    // Simula uma falha real na primeira tentativa (ex: timeout do Playwright
    // contra o Simples Dental), pra testar como a Lumi reage quando o
    // paciente pede pra tentar de novo depois.
    if (falharProxima) {
      falharProxima = false;
      throw new Error('Timeout ao tentar confirmar o agendamento no Simples Dental.');
    }

    const dataISO = paraDataISO(data);
    const nome = nomePaciente || pacientesPorTelefone.get(telefonePaciente);

    if (slotOcupado(dataISO, hora)) {
      const erro = new Error('CONFLITO_HORARIO: horário não está mais disponível');
      erro.status = 409;
      throw erro;
    }

    const id = String(proximoId++);
    agenda.push({
      id,
      dataISO,
      hora,
      paciente: nome || '(sem nome)',
      telefone: telefonePaciente,
      status: 'Agendada',
      observacao: observacao || null,
    });

    if (nomePaciente) pacientesPorTelefone.set(telefonePaciente, nomePaciente);

    return {
      sucesso: true,
      pacienteNovo: !pacientesPorTelefone.has(telefonePaciente) === false && !!nomePaciente,
      data,
      hora,
      duracaoMinutos: DURACAO_CONSULTA_MINUTOS,
    };
  }

  function buscar_agendamentos_paciente() {
    const nomePaciente = pacientesPorTelefone.get(telefonePaciente);
    if (!nomePaciente) {
      return { encontrado: false, agendamentos: [] };
    }

    const doPaciente = agenda.filter((a) => a.telefone === telefonePaciente);

    return {
      encontrado: true,
      nomePaciente,
      agendamentos: doPaciente.map((a) => ({
        id: a.id,
        status: a.status,
        paciente: a.paciente,
        inicioFormatado: `${new Date(`${a.dataISO}T${a.hora}:00${OFFSET_BRASILIA}`).toLocaleString('pt-BR', {
          timeZone: FUSO,
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}`,
      })),
      semanasVerificadas: SEMANAS_A_VERIFICAR,
    };
  }

  function mudarStatus({ id, status }) {
    const item = agenda.find((a) => a.id === String(id));
    if (!item) {
      const erro = new Error(`Agendamento com id ${id} não encontrado`);
      throw erro;
    }
    item.status = status;
    return { sucesso: true, id: item.id, status };
  }

  function confirmar_agendamento({ id } = {}) {
    return mudarStatus({ id, status: 'Confirmada' });
  }

  function cancelar_agendamento({ id } = {}) {
    return mudarStatus({ id, status: 'Cancelada pelo paciente' });
  }

  function remarcar_agendamento({ id, data, hora } = {}) {
    if (!id || !data || !hora) {
      throw new Error('Campos obrigatórios faltando: id, data e/ou hora.');
    }
    const item = agenda.find((a) => a.id === String(id));
    if (!item) throw new Error(`Agendamento com id ${id} não encontrado`);

    const dataISO = paraDataISO(data);
    if (slotOcupado(dataISO, hora)) {
      const erro = new Error('CONFLITO_HORARIO: horário não está mais disponível');
      erro.status = 409;
      throw erro;
    }

    item.dataISO = dataISO;
    item.hora = hora;

    return { sucesso: true, id: item.id, data, hora, duracaoMinutos: DURACAO_CONSULTA_MINUTOS };
  }

  const handlers = {
    verificar_disponibilidade,
    criar_agendamento,
    buscar_agendamentos_paciente,
    confirmar_agendamento,
    cancelar_agendamento,
    remarcar_agendamento,
  };

  // Permite pré-popular cenários (ex: paciente já tem uma consulta marcada
  // antes da conversa começar), sem passar pelo fluxo de criação normal.
  function seed({ nomePaciente, data, hora, status = 'Agendada', observacao } = {}) {
    const id = String(proximoId++);
    agenda.push({
      id,
      dataISO: paraDataISO(data),
      hora,
      paciente: nomePaciente,
      telefone: telefonePaciente,
      status,
      observacao: observacao || null,
    });
    pacientesPorTelefone.set(telefonePaciente, nomePaciente);
    return id;
  }

  return { handlers, seed, _agenda: agenda };
}

module.exports = { criarEstadoFake };
