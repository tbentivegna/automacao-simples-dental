module.exports = {
  nome: 'Paciente novo NÃO oferece nenhum dado espontaneamente -- a Lumi precisa perguntar ativamente',
  descricao:
    'Teste mais rigoroso que o 30: a paciente só dá nome e demonstra intenção de agendar, sem citar data de nascimento/CPF/endereço/e-mail em nenhum momento. Verifica se a Lumi pergunta ativamente pela lista de dados (em vez de só aceitar passivamente se alguém oferecesse). Cenário curto de propósito -- o que importa é a resposta logo após a 3ª mensagem.',
  telefonePaciente: '11933332222',
  mensagens: [
    'oi, boa tarde',
    'Juliana Prado',
    'queria marcar uma primeira consulta, vocês tem horário amanhã?',
    'pode ser as 08:30',
    'pode confirmar sim',
  ],
};
