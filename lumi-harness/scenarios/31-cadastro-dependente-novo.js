module.exports = {
  nome: 'Consulta para filho(a), paciente novo no Simples Dental -- cadastro completo da criança + responsável',
  descricao:
    'Combina CONSULTA PARA DEPENDENTE com CADASTRO DE PACIENTE NOVO: além de nome+data de nascimento da criança (já exigido hoje), a Lumi precisa coletar os dados completos do responsável (nome, data de nascimento, CPF, endereço, e-mail) antes de chamar Cria Agendamento. CPF da criança é propositalmente omitido -- o prompt diz pra não insistir nesse caso.',
  telefonePaciente: '11955554444',
  mensagens: [
    'oi, tudo bem?',
    'Fernanda Lima',
    'quero marcar uma consulta pro meu filho',
    'o nome dele é Pedro Lima, nasceu em 10/04/2016',
    'meus dados: nasci em 22/07/1988, CPF 987.654.321-00, email fernanda.lima@example.com, CEP 13334-360, número 250',
    'ele nunca fez consulta antes, o motivo é avaliação ortodôntica',
    'pode ser de manhã',
    'pode ser o primeiro horário',
    'pode confirmar sim',
  ],
};
