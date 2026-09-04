module.exports = {
  nome: 'Criar (não Confirmar) Agendamento quando o paciente diz "pode confirmar" (caso GPT-5.4-mini, 03/09)',
  descricao:
    'Reproduz o bug real achado testando GPT-5.4-mini em DEV: paciente JÁ CADASTRADO (encontrado:true, mas ' +
    'sem nenhum agendamento futuro -- mesma forma do caso real do Tiago) escolhe um horário novo (sem ID de ' +
    'agendamento nenhum pra esse horário) e, quando a Lumi pergunta "Posso confirmar esse agendamento para ' +
    'você?", responde "Pode confirmar sim por favor" -- a palavra "confirmar" no português cotidiano não tem ' +
    'nada a ver com a ferramenta técnica "Confirmar Agendamento" (que exige um ID real de um agendamento JÁ ' +
    'existente). A Lumi DEVE chamar Criar Agendamento aqui, nunca Confirmar Agendamento -- e nunca inventar ' +
    'um ID (ex: usar o próprio id da tool_call como se fosse idAgendamento).',
  telefonePaciente: '11977778899',
  // Consulta antiga/já ocorrida -- garante encontrado:true (paciente já
  // cadastrado) sem deixar nenhum agendamento FUTURO no caminho (mesma
  // forma do caso real: "encontrado":true,"agendamentos":[]).
  seedAgendamentos: [
    { nomePaciente: 'Roberto Almeida', data: '10/08/2026', hora: '09:00', status: 'Compareceu' },
  ],
  historico: [
    { role: 'user', content: 'Oi, boa tarde' },
    { role: 'assistant', content: 'Boa tarde! 😊 Como posso te chamar?' },
    { role: 'user', content: 'Roberto Almeida' },
    { role: 'assistant', content: 'Boa tarde, Roberto! 😊 Como posso te ajudar hoje?' },
  ],
  mensagens: [
    'quero marcar uma consulta de invisalign',
    'de manhã, sexta-feira',
    'pode ser o primeiro',
    'Pode confirmar sim por favor',
  ],
};
