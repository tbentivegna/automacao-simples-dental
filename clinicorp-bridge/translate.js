'use strict';

// Funções puras (sem rede, sem banco) que traduzem entre o formato de
// resposta que o Clinicorp devolve e o formato que o workflow n8n / prompt
// da Lumi já espera (o MESMO formato que server.js da raiz, Simples
// Dental, já devolve hoje -- ver server.js linhas 296-461, 589-618).
//
// Testável com fixtures, sem precisar de credencial real do Clinicorp.
// Toda fixture abaixo vem só dos EXEMPLOS da documentação Swagger
// (https://sistema.clinicorp.com/api-docs/), NUNCA de uma chamada real --
// marcado explicitamente. Ver README.md antes de confiar nisto em prod.

const { nomeDiaSemana } = require('./tempo');

// --- Disponibilidade ---
// Entrada: resposta de GET /appointment/get_avaliable_days (array de dias).
// Saída: { horarios, resumoPorDiaSemana, diasBloqueados, semanasVerificadas }
// -- mesmíssimo formato que server.js/verificarDisponibilidade devolve hoje.
function traduzirDisponibilidade(diasClinicorp, { diaSemanaFiltro, periodoFiltro, semanasVerificadas } = {}) {
  const horarios = {};

  for (const dia of diasClinicorp || []) {
    const diaISO = dia.jsonDate;
    if (!diaISO) continue;

    const diaSemana = nomeDiaSemana(diaISO);
    if (diaSemanaFiltro && diaSemana !== diaSemanaFiltro) continue;

    let horariosDoDia = (dia.AvailableTimes || []).map((h) => h.from).filter(Boolean);
    if (periodoFiltro === 'manha') horariosDoDia = horariosDoDia.filter((h) => h < '12:00');
    if (periodoFiltro === 'tarde') horariosDoDia = horariosDoDia.filter((h) => h >= '12:00');
    if (horariosDoDia.length === 0) continue;

    const diaBR = `${String(dia.day).padStart(2, '0')}/${String(dia.month).padStart(2, '0')}/${dia.year}`;
    horarios[diaBR] = { diaSemana, horariosDisponiveis: horariosDoDia };
  }

  return {
    horarios,
    resumoPorDiaSemana: agruparPorDiaSemana(horarios),
    // NÃO VERIFICADO: get_avaliable_days pode simplesmente OMITIR dias sem
    // vaga (em vez de listar com AvailableTimes vazio) -- nesse caso não
    // há como distinguir "bloqueado" de "não verificado" sem cruzar com
    // outro endpoint. Fica vazio até confirmar contra uma resposta real.
    diasBloqueados: [],
    semanasVerificadas: semanasVerificadas ?? null,
  };
}

// Porta de server.js:445-461 (agruparPorDiaSemana), sem nenhuma mudança --
// lógica 100% independente de qual backend gerou `horarios`.
function agruparPorDiaSemana(horariosPorData) {
  const resumo = {};
  for (const [diaBR, info] of Object.entries(horariosPorData)) {
    if (!resumo[info.diaSemana]) resumo[info.diaSemana] = { manha: [], tarde: [] };
    const manha = info.horariosDisponiveis.filter((h) => h < '12:00');
    const tarde = info.horariosDisponiveis.filter((h) => h >= '12:00');
    if (manha.length) resumo[info.diaSemana].manha.push({ data: diaBR, horarios: manha });
    if (tarde.length) resumo[info.diaSemana].tarde.push({ data: diaBR, horarios: tarde });
  }
  return resumo;
}

// --- Agendamento ---
// Entrada: um item de GET /patient/list_appointments
// ({id, AtomicDate, date, PatientName, fromTime, toTime}).
// Saída: mesmo formato que formatarCompromissos (server.js:589-618)
// devolve por item -- {id, inicioFormatado, fimFormatado, status, paciente}.
// NÃO VERIFICADO: list_appointments não devolve `status` no exemplo do
// Swagger -- sem chamada real não dá pra saber se cancelado/confirmado
// aparece aqui ou só via get_appointment. Fica null até confirmar.
function traduzirAgendamento(agendamentoClinicorp) {
  const a = agendamentoClinicorp || {};
  const dataFormatada = a.date ? new Date(a.date).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;
  return {
    id: a.id,
    inicioFormatado: dataFormatada && a.fromTime ? `${dataFormatada} ${a.fromTime}` : dataFormatada,
    fimFormatado: a.toTime || null,
    status: a.Status || null, // ver nota acima
    paciente: a.PatientName || null,
    rotulo: null, // Clinicorp não tem conceito equivalente ao "rótulo" do Simples Dental
  };
}

function traduzirListaAgendamentos(lista) {
  return (lista || []).map(traduzirAgendamento);
}

// --- Fixtures (só documentação, nunca resposta real -- ver aviso no topo) ---
const FIXTURES_NAO_VERIFICADAS = {
  getAvaliableDays: [
    {
      Date: 'YYYY-MM-DD',
      Week: 'Quarta-Feira',
      DayWeek: '3 (Quarta-Feira)',
      day: 31,
      month: 12,
      year: 2024,
      jsonDate: '2024-12-31',
      AvailableTimes: [{ from: '08:00', to: '08:30' }],
    },
  ],
  patientListAppointments: [
    { id: 4791226171916288, AtomicDate: 20250501, date: '2025-05-01T18:02:36.132Z', PatientName: 'Nome do Paciente', fromTime: '10:00', toTime: '10:30' },
  ],
};

module.exports = {
  traduzirDisponibilidade,
  agruparPorDiaSemana,
  traduzirAgendamento,
  traduzirListaAgendamentos,
  FIXTURES_NAO_VERIFICADAS,
};
