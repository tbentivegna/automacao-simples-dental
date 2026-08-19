module.exports = {
  nome: 'Paciente adulto novo no Simples Dental -- deve coletar cadastro completo antes de agendar',
  descricao:
    'Testa a funcionalidade nova: Busca Agendamentos do Paciente retorna encontrado:false (telefone nunca visto), então a Lumi deve pedir data de nascimento, CPF, CEP+número e e-mail antes de chamar Cria Agendamento -- e passar tudo isso nos parâmetros novos da tool.',
  telefonePaciente: '11977776666',
  mensagens: [
    'oi, boa tarde',
    'queria marcar uma consulta, vocês tem horário essa semana à tarde?',
    'Gabriela Souza',
    'nasci em 15/03/1994, meu CPF é 123.456.789-00, meu email é gabriela.souza@example.com, CEP 13334-360, número 100',
    'queria fazer uma limpeza',
    'pode ser o primeiro horário mesmo',
    'pode confirmar sim',
  ],
};
