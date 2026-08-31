module.exports = {
  nome: 'Paciente pede consentimento de lembrete por conta própria (sem a Lumi ter perguntado)',
  descricao:
    'Reproduz o caso real que falhou em produção (ainda válido no modelo opt-out atual): o ' +
    'paciente já tem uma consulta marcada (seed) e, sem a Lumi ter avisado nada sobre ' +
    'lembrete nesta conversa, ele mesmo pede pra confirmar/ativar o consentimento. A Lumi ' +
    'precisa tratar isso como oportunidade de avisar (é automático por padrão) e chamar a ' +
    'ferramenta Registrar Consentimento Lembrete com "sim" -- nunca dizer que "já está ' +
    'registrado" sem ter chamado a ferramenta.',
  telefonePaciente: '11966665555',
  seedAgendamentos: [
    { nomePaciente: 'Tiago Bentivegna', data: '14/08/2026', hora: '08:00', status: 'Agendada', observacao: 'Primeira Consulta' },
  ],
  mensagens: [
    'Lumi, confirma pra mim que meu consentimento está registrado por favor? Quero receber lembrete da minha consulta',
  ],
};
