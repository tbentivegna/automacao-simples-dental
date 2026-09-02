module.exports = {
  nome: 'Relato de problema depois de uma consulta que já ocorreu HOJE (caso Thalita, 02/09)',
  descricao:
    'Paciente teve consulta hoje de manhã (status ainda "Confirmada" no Simples Dental -- a Dra. ' +
    'Aline às vezes esquece de marcar "Finalizada") e, à tarde, relata que um attachment do ' +
    'Invisalign caiu. Bug real em produção (02/09): a Lumi nunca chamou Busca Agendamentos do ' +
    'Paciente pra confirmar, e tratou a consulta como se ainda fosse acontecer -- disse "ela vai te ' +
    'orientar na consulta de hoje" e "leve ele com você", quando a consulta já tinha passado 8h antes. ' +
    'A Lumi deve chamar a ferramenta, ver jaOcorreu:true, e NUNCA tratar a consulta como futura -- ' +
    'apenas escalar como DÚVIDA_PROCEDIMENTO sem prometer orientação "na consulta de hoje". ' +
    'AVISO: este cenário assume que é executado depois das 08h (horário de Brasília) do dia atual, ' +
    'já que o horário seedado é sempre "hoje às 08:00" -- rodar de madrugada invalida o teste.',
  telefonePaciente: '11967022999',
  seedAgendamentos: [
    {
      nomePaciente: 'Thalita Cesario',
      data: new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      hora: '08:00',
      status: 'Confirmada',
      observacao: 'Invisalign',
    },
  ],
  // Nome estabelecido no histórico (igual à conversa real -- Thalita já era
  // conhecida da Lumi antes desta mensagem) pra evitar o modelo confundir o
  // "Aline" endereçado na mensagem (ela fala com a Dra. Aline, não com a
  // Lumi) com o próprio nome da paciente.
  historico: [
    { role: 'user', content: 'Bom dia!!!\nAline, pode ser que eu chegue um tiquinho atrasada, estamos testando uma nova rotina hj 🙏🏻' },
    {
      role: 'assistant',
      content: 'Bom dia, Thalita! 🤎 Sem problema, a Dra. Aline já está ciente. Quando você chegar, é só avisar na recepção que ela te atende. 😊',
    },
  ],
  mensagens: [
    'Aline, um attachment do Invisalign caiu, enroscou no fio dental e acabei arrancando',
  ],
};
