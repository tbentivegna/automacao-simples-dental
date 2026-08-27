'use strict';

// Verificação rápida das funções puras de translate.js contra as fixtures
// documentadas (NÃO contra o Clinicorp real -- ver aviso em translate.js).
// Não é um framework de teste (o repo não usa nenhum) -- roda e imprime
// PASS/FALHA, mesmo espírito do lumi-harness/run.js.
//
// Uso: node clinicorp-bridge/translate.selfcheck.js

const { traduzirDisponibilidade, traduzirListaAgendamentos, FIXTURES_NAO_VERIFICADAS } = require('./translate');

let falhas = 0;
function checar(descricao, condicao) {
  if (condicao) {
    console.log(`  OK   ${descricao}`);
  } else {
    console.error(`  FALHOU ${descricao}`);
    falhas++;
  }
}

console.log('=== traduzirDisponibilidade ===');
const disponibilidade = traduzirDisponibilidade(FIXTURES_NAO_VERIFICADAS.getAvaliableDays, { semanasVerificadas: 4 });
checar('gera 1 entrada em horarios (31/12/2024)', Object.keys(disponibilidade.horarios).length === 1);
checar('diaSemana calculado corretamente (2024-12-31 é terça)', disponibilidade.horarios['31/12/2024']?.diaSemana === 'terca');
checar('horariosDisponiveis contém o horário do fixture', disponibilidade.horarios['31/12/2024']?.horariosDisponiveis.includes('08:00'));
checar('resumoPorDiaSemana agrupa por período (manhã)', disponibilidade.resumoPorDiaSemana.terca?.manha.length === 1);
checar('semanasVerificadas repassado', disponibilidade.semanasVerificadas === 4);

console.log('\n=== traduzirDisponibilidade (filtro de período que não bate) ===');
const semTarde = traduzirDisponibilidade(FIXTURES_NAO_VERIFICADAS.getAvaliableDays, { periodoFiltro: 'tarde' });
checar('filtro de período exclui corretamente quando não há horário de tarde', Object.keys(semTarde.horarios).length === 0);

console.log('\n=== traduzirListaAgendamentos ===');
const agendamentos = traduzirListaAgendamentos(FIXTURES_NAO_VERIFICADAS.patientListAppointments);
checar('traduz 1 agendamento', agendamentos.length === 1);
checar('mantém o id original', agendamentos[0].id === 4791226171916288);
checar('paciente mapeado de PatientName', agendamentos[0].paciente === 'Nome do Paciente');
checar('inicioFormatado inclui a hora', agendamentos[0].inicioFormatado?.includes('10:00'));

console.log(`\n${falhas === 0 ? 'Tudo OK' : `${falhas} verificação(ões) falharam`} -- lembre: fixtures são só documentação, não resposta real do Clinicorp.`);
process.exit(falhas === 0 ? 0 : 1);
