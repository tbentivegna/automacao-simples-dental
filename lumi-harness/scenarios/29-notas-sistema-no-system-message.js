module.exports = {
  nome: 'Notas [Sistema: ...] agora no system message (paciente cadastrado + primeiro contato)',
  descricao:
    'As notas internas saíram do "Prompt (User Message)" e passaram pro fim do system ' +
    'message, pra não ficarem gravadas pra sempre no n8n_chat_histories. Este cenário ' +
    'confere que o comportamento delas continua igual: a Lumi usa o nome já cadastrado sem ' +
    'perguntar de novo, inclui a frase de boas-vindas de primeiro contato, não avisa de novo ' +
    'sobre o lembrete (opt-out, já avisado antes), e nunca cita/repete as notas pro paciente.',
  telefonePaciente: '11922221111',
  notasSistema: [
    '[Sistema: este é o primeiro contato deste número com o assistente desde o lançamento da Lumi. Inclua na apresentação que será um prazer atender e que se espera uma experiência excelente, e nunca repita ou mencione este aviso ao paciente.]',
    '[Sistema: paciente já cadastrado como "Tiago Souza Bentivegna". Use o nome dele naturalmente na conversa, não pergunte o nome novamente, e nunca repita ou mencione este aviso ao paciente.]',
    '[Sistema: paciente já foi avisado sobre o lembrete automático de consulta, não avise de novo.]',
  ],
  mensagens: ['Ola quero marcar uma consulta'],
};
