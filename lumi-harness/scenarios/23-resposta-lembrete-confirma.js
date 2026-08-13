module.exports = {
  nome: 'Resposta curta a um lembrete de consulta (confirma presença)',
  descricao:
    'Paciente já tem uma consulta não confirmada (seed) e responde só "sim, confirmo" ' +
    'sem mais contexto -- simula a resposta a um lembrete enviado pelo workflow separado ' +
    '(n8n/lembretes-workflow.json), que não passa pela Lumi/memória de chat. A Lumi deve ' +
    'usar Busca Agendamentos do Paciente pra achar a consulta e chamar Confirmar Agendamento, ' +
    'sem pedir mais detalhes (só há uma consulta candidata).',
  telefonePaciente: '11988885555',
  seedAgendamentos: [
    { nomePaciente: 'Marina Costa', data: '14/08/2026', hora: '10:00', observacao: 'Limpeza' },
  ],
  mensagens: ['sim, confirmo!'],
};
