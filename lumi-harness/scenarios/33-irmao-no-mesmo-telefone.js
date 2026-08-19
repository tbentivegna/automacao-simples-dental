module.exports = {
  nome: 'Família com mais de um filho no mesmo telefone -- irmã nova precisa de cadastro próprio',
  descricao:
    'Pedro Lima já é paciente cadastrado (seedAgendamentos) nesse telefone. A mãe agora pede consulta para a OUTRA filha, Julia, que nunca foi atendida. Testa se Busca Agendamentos do Paciente desambigua corretamente por nome (Julia deve dar encontrado:false mesmo com Pedro já cadastrado no mesmo telefone) e se a Lumi cadastra Julia como paciente própria, não confunde com o irmão nem com a mãe.',
  telefonePaciente: '11922221111',
  seedAgendamentos: [{ nomePaciente: 'Pedro Lima', data: '17/08/2026', hora: '08:30', observacao: 'Ortodontia' }],
  mensagens: [
    'oi, boa tarde',
    'Camila Lima',
    'quero marcar uma consulta pra minha outra filha, a Julia',
    'Julia Lima, nasceu em 05/09/2018',
    'ela nunca fez consulta antes, quero uma avaliação ortodôntica pra ela também',
    'meus dados: nasci em 12/02/1985, CPF 111.222.333-44, email camila.lima@example.com, CEP 13334-360, número 88',
    'pode ser de manhã',
    'pode ser o primeiro horário',
    'pode confirmar sim',
  ],
};
