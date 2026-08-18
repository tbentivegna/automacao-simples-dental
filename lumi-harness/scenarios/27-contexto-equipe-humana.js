module.exports = {
  nome: 'Lumi retoma depois de a equipe humana ter atendido (contexto no histórico)',
  descricao:
    'Simula o que passa a existir no n8n_chat_histories depois do handoff: mensagens ' +
    'marcadas com "[Equipe da clínica]:" (escritas pela secretária, não pela Lumi) e as ' +
    'respostas do paciente durante esse período. A Lumi deve respeitar o que a equipe já ' +
    'combinou (não remarcar por conta própria, não repetir, não contradizer) e não deve ' +
    'citar o marcador nem dizer "vejo aqui que a equipe te respondeu".',
  telefonePaciente: '11944443333',
  seedAgendamentos: [
    { nomePaciente: 'Tiago Bentivegna', data: '17/08/2026', hora: '13:30', status: 'Agendada', observacao: 'HOF - Toxina Botulínica' },
  ],
  historico: [
    { role: 'user', content: 'Oi, queria marcar uma consulta de harmonização' },
    {
      role: 'assistant',
      content:
        'Olá, Tiago! 🤎 Sou a Lumi, concierge digital da Dra. Aline Bentivegna. Vou verificar os horários disponíveis pra você. Prefere manhã ou tarde?',
    },
    { role: 'user', content: 'Tarde de preferência' },
    {
      role: 'assistant',
      content:
        '[Equipe da clínica]: Oi Tiago, aqui é a Camila, secretária da Dra. Aline. Consegui encaixar você na segunda, 17/08, às 13:30 — já deixei reservado no sistema.',
    },
    { role: 'user', content: 'Perfeito, obrigado!' },
    {
      role: 'assistant',
      content:
        '[Equipe da clínica]: Combinado! E já anotei aqui que você pediu pra chegar 10 minutos antes pra preencher a ficha.',
    },
  ],
  mensagens: ['Oi, só confirmando: que horas mesmo é minha consulta e o que eu preciso levar?'],
};
