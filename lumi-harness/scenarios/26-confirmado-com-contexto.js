module.exports = {
  nome: 'Resposta curta ("Confirmado!") quando a consulta já foi marcada nesta mesma conversa',
  descricao:
    'Reproduz o caso real que falhou em produção: a consulta foi agendada mais cedo na ' +
    'MESMA conversa (está no histórico), depois chega um lembrete e o paciente responde só ' +
    '"Confirmado!". A Lumi "lembra" da consulta pela conversa e tende a responder direto sem ' +
    'chamar nenhuma ferramenta -- precisa chamar Busca Agendamentos do Paciente + Confirmar ' +
    'Agendamento mesmo assim.',
  telefonePaciente: '11955554444',
  seedAgendamentos: [
    { nomePaciente: 'Tiago Bentivegna', data: '14/08/2026', hora: '08:00', observacao: 'HOF - Toxina Botulínica' },
  ],
  historico: [
    { role: 'user', content: 'Ola! Quero marcar uma consulta pra colocar botox' },
    {
      role: 'assistant',
      content:
        'Olá, Tiago! 🤎 Sou a Lumi, concierge virtual da Dra. Aline Bentivegna. A Dra. Aline atua com Harmonização Orofacial (HOF), que inclui a aplicação de toxina botulínica. Para agendarmos, vou verificar os horários disponíveis. Você prefere manhã ou tarde? 😊',
    },
    { role: 'user', content: 'Prefiro de manhã' },
    {
      role: 'assistant',
      content:
        'Tiago, temos disponível sexta-feira, 14/08, às 08:00, 09:30 ou 11:00. Qual desses horários funciona melhor para você? 😊',
    },
    { role: 'user', content: 'Pode ser às 8h de sexta feira por favor' },
    {
      role: 'assistant',
      content:
        'Perfeito, Tiago! O horário de sexta-feira, 14/08, às 08:00 está disponível. 😊 Antes de concluir, só preciso te informar que o valor da Primeira Consulta é de R$ 250,00, com pagamento no dia do atendimento. Posso confirmar esse agendamento para você?',
    },
    { role: 'user', content: 'Pode sim' },
    {
      role: 'assistant',
      content:
        'Perfeito, Tiago! 😊 Sua consulta ficou agendada para sexta-feira, 14/08, às 08:00. O consultório fica na Clínica Elevato, R. Ildefonso Stehle, 1035 - Cidade Nova I, Indaiatuba - SP. Posso te avisar por WhatsApp um dia antes e no dia da sua consulta, como lembrete? 😊',
    },
    { role: 'user', content: 'Pode sim!' },
    {
      role: 'assistant',
      content: 'Ótimo, Tiago! Seu consentimento para receber lembretes foi registrado. 😊',
    },
  ],
  mensagens: ['Confirmado!'],
};
