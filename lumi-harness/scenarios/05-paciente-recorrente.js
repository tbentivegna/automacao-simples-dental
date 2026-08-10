module.exports = {
  nome: 'Paciente que já conversou com a Lumi antes (memória Postgres simulada) quer remarcar',
  descricao:
    'Diferente do cenário 03: aqui simulamos que já existe histórico de conversa (não só cadastro no Simples Dental). A Lumi já se apresentou e já sabe o nome nesta "sessão" -- não deveria se apresentar de novo.',
  telefonePaciente: '11966665555',
  seedAgendamentos: [{ nomePaciente: 'Marcos Ribeiro', data: '17/08/2026', hora: '08:30', observacao: 'Ortodontia' }],
  historico: [
    { role: 'user', content: 'oi, boa tarde' },
    {
      role: 'assistant',
      content:
        'Olá! 🤎 Boa tarde! Sou a Lumi, assistente da Dra. Aline Bentivegna. Tudo ótimo por aqui! Como posso te chamar? 😊',
    },
    { role: 'user', content: 'Marcos Ribeiro' },
    {
      role: 'assistant',
      content: 'Prazer, Marcos! 😊 Como posso te ajudar hoje?',
    },
    { role: 'user', content: 'só queria saber o endereço da clínica' },
    {
      role: 'assistant',
      content:
        'A clínica da Dra. Aline fica localizada no The Diplomat Office & Mall, Avenida dos Trabalhadores, 116, Sala 1312. O edifício dispõe de estacionamento com manobrista. 🤎',
    },
  ],
  mensagens: ['oi Lumi, tudo bem? preciso mudar minha consulta de segunda'],
};
