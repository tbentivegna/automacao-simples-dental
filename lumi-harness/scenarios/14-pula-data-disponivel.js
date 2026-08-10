module.exports = {
  nome: 'Reprodução do bug real: pula quarta-feira 19/08 de manhã (disponível) e só oferece 26/08+',
  descricao:
    'Agenda: quarta 12/08 está TOTALMENTE ocupada de manhã (08:30 e 10:00 tomados). Quarta 19/08 está livre. Testa se a Lumi enxerga 19/08 corretamente ou pula direto pra datas mais distantes.',
  telefonePaciente: '11900001111',
  seedAgendamentos: [
    { nomePaciente: 'Outro Paciente', data: '12/08/2026', hora: '08:30', observacao: 'Ocupado' },
    { nomePaciente: 'Outro Paciente', data: '12/08/2026', hora: '10:00', observacao: 'Ocupado' },
  ],
  mensagens: [
    'olá bom dia',
    'Queria marcar uma consulta com a Dra Aline.',
    'Henrique Batista',
    'Quero harmonizacao facial',
    'de manha',
    'Não tem de quarta-feira?',
    'procure a próxima quarta-feira livre.. só posso de quarta!',
  ],
};
