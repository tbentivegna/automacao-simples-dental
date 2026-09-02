module.exports = {
  nome: 'Remarcar consulta já CONFIRMADA no mesmo dia (caso Gabriella, 26/08)',
  descricao:
    'Paciente já tem uma consulta CONFIRMADA (seed com status Confirmada, não só Agendada) e ' +
    'avisa que a rede de apoio furou, pedindo pra remarcar pro mesmo dia mais tarde -- sem nunca ' +
    'dizer "cancelar". Bug real em produção (26/08): a Lumi chamou Cancelar Agendamento em vez de ' +
    'Remarcar, cancelou a consulta e nunca ofereceu horário novo. A trava de código ' +
    '(deveBloquearCancelamentoPorRemarcacao, server.js) foi generalizada 02/09 pra cobrir esse caso ' +
    '(antes só cobria tentativa em_andamento no funil, não consulta já confirmada) -- este cenário ' +
    'protege o comportamento esperado do PROMPT como camada extra, já que o prompt sozinho falhou ' +
    'ao vivo mesmo já tendo a regra explícita.',
  telefonePaciente: '19974129999',
  seedAgendamentos: [
    { nomePaciente: 'Gabriella Ferreira', data: '02/09/2026', hora: '10:30', status: 'Confirmada', observacao: 'Primeira Consulta' },
  ],
  mensagens: [
    'oi, minha rede de apoio furou hoje de manhã, será que dá pra eu remarcar minha consulta pra mais tarde?',
    'podemos remarcar hoje então?',
    'pode ser às 15h30',
    'sim, pode confirmar',
  ],
};
