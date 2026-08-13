module.exports = {
  nome: 'Consentimento de lembrete (agenda -> Lumi pergunta -> paciente aceita)',
  descricao:
    'Depois de confirmar um agendamento novo, a Lumi deve perguntar se pode mandar ' +
    'lembrete por WhatsApp e, ao receber a resposta, emitir o agent_action ' +
    'REGISTRAR_CONSENTIMENTO_LEMBRETE com detail "sim".',
  telefonePaciente: '11999997777',
  mensagens: [
    'oi, boa tarde',
    'queria marcar uma consulta, vocês tem horário essa semana à tarde?',
    'Marina Costa',
    'queria fazer uma limpeza',
    'pode ser o primeiro horário mesmo',
    'pode confirmar sim',
    'pode sim, pode mandar',
  ],
};
