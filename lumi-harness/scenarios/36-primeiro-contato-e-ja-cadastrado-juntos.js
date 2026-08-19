module.exports = {
  nome: 'AS DUAS notas juntas: primeiro_contato=true (sem histórico) E nome já cadastrado',
  descricao:
    'Caso possível pelo comando de reset ("##resetconversa"): apaga n8n_chat_histories (primeiro_contato volta a true) mas NÃO apaga cliente.nome. As duas notas do sistema chegam juntas. O prompt manda combinar as duas ("use o nome sem perguntar e inclua a frase de boas-vindas do lançamento") -- este teste confirma se isso realmente acontece ou se a Lumi deixa a segunda parte de fora.',
  telefonePaciente: '11911114444',
  notasSistema: [
    '[Sistema: este é o primeiro contato deste número com o assistente desde o lançamento da Lumi. Inclua na apresentação que será um prazer atender e que se espera uma experiência excelente, e nunca repita ou mencione este aviso ao paciente.]',
    '[Sistema: paciente já cadastrado como "Viviane Costa". Use o nome dele naturalmente na conversa, não pergunte o nome novamente, e nunca repita ou mencione este aviso ao paciente.]',
  ],
  mensagens: ['Td bem?'],
};
