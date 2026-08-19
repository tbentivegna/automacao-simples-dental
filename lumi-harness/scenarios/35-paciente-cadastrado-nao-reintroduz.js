module.exports = {
  nome: 'Paciente já cadastrado no Postgres (nota do sistema) -- Lumi NÃO deve se reapresentar',
  descricao:
    'Simula exatamente o caso da Viviane no log real: existe uma nota "[Sistema: paciente já cadastrado como ...]" (cliente.nome já preenchido), mas SEM historico de conversa carregado no harness (n8n_chat_histories pode ter registros antigos que o harness não replica). Serve para confirmar se o "pular a apresentação" é o comportamento OBRIGATÓRIO já documentado na seção PACIENTE JÁ CADASTRADO (pré-existente, não é regressão de hoje) -- e não um bug introduzido agora.',
  telefonePaciente: '11911113333',
  notasSistema: [
    '[Sistema: paciente já cadastrado como "Viviane Costa". Use o nome dele naturalmente na conversa, não pergunte o nome novamente, e nunca repita ou mencione este aviso ao paciente.]',
  ],
  mensagens: ['Td bem?'],
};
