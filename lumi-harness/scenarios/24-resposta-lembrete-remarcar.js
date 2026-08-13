module.exports = {
  nome: 'Resposta curta a um lembrete de consulta (pede pra remarcar)',
  descricao:
    'Paciente já tem uma consulta não confirmada (seed) e responde pedindo pra remarcar, ' +
    'sem repetir data/hora -- simula reação a um lembrete enviado pelo workflow separado. ' +
    'A Lumi deve achar a consulta via Busca Agendamentos do Paciente, oferecer novos ' +
    'horários (Verifica Disponibilidade) e só remarcar depois da escolha explícita do paciente.',
  telefonePaciente: '11977778888',
  seedAgendamentos: [
    { nomePaciente: 'Rafael Duarte', data: '14/08/2026', hora: '15:00', observacao: 'Ortodontia' },
  ],
  mensagens: [
    'oi, não vou conseguir ir amanhã, dá pra mudar pra outro dia?',
    'pode ser quarta de manhã',
    'sim, pode ser esse horário mesmo',
  ],
};
